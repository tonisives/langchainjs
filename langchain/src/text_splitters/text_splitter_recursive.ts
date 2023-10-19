import {
  RecursiveCharacterTextSplitterParams,
  TextSplitter,
  TextSplitterChunkHeaderOptions,
} from "../text_splitter.js";
import { Document } from "../document.js";
import { getLengthNoWhitespace } from "./utils.js";

// recursive splitter

// - splits on separators from top to bottom
// - if split fills the chunk size, it chooses the next separator until it doesn't fill the chunk
// - if the chunk is too small, it will merge the chunks
// - option to not count whitespace in front of / end of lines
// - adds overlap from the previous chunk after getting initial chunks

export type TextSplitterRecursiveParams = Pick<
  RecursiveCharacterTextSplitterParams,
  "chunkSize" | "chunkOverlap"
> & {
  // by default, we don't count whitespace in front of / end of lines towards the chunk size
  countWhiteSpace?: boolean;
  separators: RegExp[]
}

export class TextSplitterRecursive
  extends TextSplitter
  implements TextSplitterRecursiveParams {

  countWhiteSpace: boolean = false;
  separators: RegExp[] = []

  constructor(fields?: Partial<TextSplitterRecursiveParams>) {
    super(fields);
    this.countWhiteSpace = fields?.countWhiteSpace ?? false;
    this.separators = fields?.separators ?? []
    this.separators = [...this.separators, ...baseSeparators]
  }

  async createDocuments(
    texts: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadatas: Record<string, any>[] = [],
    // not implemented
    _chunkHeaderOptions: TextSplitterChunkHeaderOptions = {}
  ): Promise<Document[]> {
    let builder = [] as Document[][];

    for (const text of texts) {
      let docs = await this._splitText(text);
      builder.push(
        docs.map((it) => ({
          ...it,
          metadata: {
            ...it.metadata,
            ...metadatas[builder.length],
          },
        }))
      );
    }

    return builder.flat();
  }

  async splitText(text: string): Promise<string[]> {
    let docs = await this._splitText(text);
    return docs.map((doc) => doc.pageContent);
  }

  private async _splitText(text: string): Promise<Document[]> {
    const addDoc = (
      builder: Document[],
      pageContent: string,
      lineCounter: number
    ) => {
      builder.push({
        pageContent: pageContent,
        metadata: {
          loc: {
            lines: {
              from: lineCounter - pageContent.length,
              to: lineCounter - 1,
            },
          },
        },
      });
    };

    const splitOnComments = (
      text: string,
    ): string[][] => {
      let builder = [] as string[][]
      let split = text.split("\n")

      const isBlockCommentStart = (line: string) => line.match(/^(\s+|)\/\*/)

      let isSlashComment = (line: string) => line.match(/^(\s+|)\/{3}/)

      // split according to comments. if the block doesn't fill chunkSize, then ignore splitting for those comments

      let blockBuilder = [] as string[]
      let prevSlashComment = false

      for (let i = 0; i < split.length; i++) {
        let line = split[i]
        blockBuilder.push(line)
        let isSlashCommentLine = isSlashComment(line)

        if (isSlashCommentLine && !prevSlashComment) {
          let block = blockBuilder.slice(0, -1)
          builder.push(block)
          blockBuilder = [line]
          prevSlashComment = true
        }
        else if (isBlockCommentStart(line)) {
          let block = blockBuilder.slice(0, -1)
          builder.push(block)
          blockBuilder = [line]
        }

        if (prevSlashComment && !isSlashCommentLine) {
          prevSlashComment = false
        }
      }

      if (blockBuilder.length > 0) {
        builder.push(blockBuilder)
      }

      return builder
    }

    const splitOnSeparator = (
      text: string,
      separator: RegExp,
      builder: Document[]
    ): Document[] => {
      let currentSeparatorIndex = this.separators.indexOf(separator)
      let separatorChunks: string[] = []

      if (separator === solCommentsSeparator) {
        separatorChunks = splitOnComments(text).map(it => it.join("\n"))
        separator = this.separators[currentSeparatorIndex + 1]
      }
      else {
        separatorChunks = text.split(separator);
      }

      console.log(`separator: ${separator}`)//\nchunks: ${separatorChunks.join("\n")}`)

      for (let i = 0; i < separatorChunks.length; i++) {
        let chunk = separatorChunks[i];
        console.log(`chunk: ${chunk}`);


        let overLapReduce = (builder.length > 0 ? this.chunkOverlap : 0)

        let chunkWillFillChunkSize =
          this.getLengthNoWhitespace(chunk.split("\n")) >
          (this.chunkSize - overLapReduce);

        if (chunkWillFillChunkSize) {
          return splitOnSeparator(chunk, this.separators[currentSeparatorIndex + 1], builder);
        }
        else {
          // add the doc if fits to chunk size
          addDoc(builder, chunk, text.split("\n").length);
        }
      }

      return builder;
    };

    let builder: Document[] = [];
    let docs = splitOnSeparator(text, this.separators[0], builder);
    let withOverlap = this.addOverlapFromPreviousChunks(docs);

    return withOverlap;
  }


  protected addOverlapFromPreviousChunks(builder: Document[]) {
    if (builder.length <= 1) return builder;

    for (let i = 1; i < builder.length; i++) {
      let currLines = builder[i].pageContent.split("\n");

      // let currLength = this.getLengthNoWhitespace(currLines);
      // console.log(`curr:\n${currLines.join("\n")} \nlength: ${currLength}`);

      let prevChunkLines = builder[i - 1].pageContent.split("\n");
      let addedLines = this.getLinesFromPrevChunks(prevChunkLines, currLines);

      addedLines = addedLines.reverse();
      let newContent = [...addedLines, ...currLines].join("\n");

      builder[i] = {
        pageContent: newContent,
        metadata: {
          ...builder[i].metadata,
          loc: {
            lines: {
              from: builder[i].metadata.loc.lines.from - addedLines.length,
              to: builder[i].metadata.loc.lines.to,
            },
          },
        },
      };
    }

    return builder;
  }

  protected getLinesFromPrevChunks(
    prevChunkLines: string[],
    currLines: string[],
  ) {
    let addedLines = [] as string[];

    for (let j = prevChunkLines.length - 1; j >= 0; j--) {
      let prevLine = prevChunkLines[j];
      addedLines.push(prevLine);
      let newLength = this.getLengthNoWhitespace([...addedLines, ...currLines]);

      if (newLength > this.chunkSize) {
        // only take a slice from the lastly added line
        let lastAddedLine = addedLines[addedLines.length - 1]
        if (!this.countWhiteSpace) lastAddedLine = lastAddedLine.trim()
        let overflow = newLength - this.chunkSize
        let sliceAmount = lastAddedLine.length - overflow

        if (sliceAmount <= 0) {
          // whole new line is overflown
          addedLines = addedLines.slice(0, -1)
          // debug(addedLines, currLines, this.chunkSize)
          break
        }

        let slice = lastAddedLine.slice(-sliceAmount)
        addedLines[addedLines.length - 1] = slice
        // debug(addedLines, currLines, this.chunkSize)
        break;
      }
    }

    return addedLines;
  }

  protected getLengthNoWhitespace(lines: string[]) {
    if (this.countWhiteSpace) return lines.join("\n").length;
    return getLengthNoWhitespace(lines)
  };
}

const solCommentsSeparator = /solComments/

export const solSeparators = [
  solCommentsSeparator,
  // Split along compiler informations definitions
  /\n(\s+|)pragma /,
  /\n(\s+|)pragma /,
  /\n(\s+|)using /,
  /\n(\s+|)using /,

  // Split along contract definitions
  /\n(\s+|)contract /,
  /\n(\s+|)interface /,
  /\n(\s+|)library /,
  // Split along method definitions
  /\n(\s+|)constructor /,
  /\n(\s+|)type /,
  /\n(\s+|)function /,
  /\n(\s+|)event /,
  /\n(\s+|)modifier /,
  /\n(\s+|)error /,
  /\n(\s+|)struct /,
  /\n(\s+|)enum /,
  // Split along control flow statements
  /\n(\s+|)if /,
  /\n(\s+|)for /,
  /\n(\s+|)while /,
  /\n(\s+|)do while /,
  /\n(\s+|)assembly /,
  // Split by the normal type of lines
  /\n\n/,
];

export const mdSeparators = [
  // First, try to split along Markdown headings
  /\n(\s+|)# /,
  /\n(\s+|)## /,
  /\n(\s+|)### /,
  /\n(\s+|)#### /,
  /\n(\s+|)##### /,
  /\n(\s+|)###### /,
  // Note the alternative syntax for headings (below) is not handled here
  // Heading level 2
  // ---------------
  // End of code block
  /```\n\n/,
  // Horizontal lines
  /\n(\s+|)\n\*\*\*\n\n/,
  /\n(\s+|)\n---\n\n/,
  /\n(\s+|)\n___\n\n/,
  // Note that this splitter doesn't handle horizontal lines defined
  // by *three or more* of ***, ---, or ___, but this is not handled
  /\n(\s+|)\n/,
];

const baseSeparators = [
  /\n(\s+|)", "/,
]