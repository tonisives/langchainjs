import {
  RecursiveCharacterTextSplitterParams,
  TextSplitter,
  TextSplitterChunkHeaderOptions,
} from "./text_splitter.js";
import { Document } from "./document.js";

export type TextSplitterNewLineParams = Pick<
  RecursiveCharacterTextSplitterParams,
  "chunkSize" | "chunkOverlap"
> & {
  // by default, we don't count whitespace in front of / end of lines towards the chunk size
  countWhiteSpace?: boolean;
}

export class TextSplitterNewLine
  extends TextSplitter
  implements TextSplitterNewLineParams {

  countWhiteSpace: boolean = false;

  constructor(fields?: Partial<TextSplitterNewLineParams>) {
    super(fields);
    this.countWhiteSpace = fields?.countWhiteSpace ?? false;
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
      pageContent: string[],
      lineCounter: number
    ) => {
      builder.push({
        pageContent: pageContent.join("\n"),
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

    const getDocsFromText = (text: string) => {
      let builder: Document[] = [];
      let lines = text.split("\n");

      let pageContent = [] as string[];
      let lineCounter = 0;

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        lineCounter++;

        let currentPageContent = pageContent.join("\n");
        let lineWillFillChunk =
          this.getLengthNoWhitespace([...pageContent, line]) >
          this.chunkSize - this.chunkOverlap;

        // if line + overlap is longer than the chunk, it will be added in next loop with overflown size
        if (lineWillFillChunk && pageContent.length > 0) {
          if (currentPageContent.trim().length > 0)
            addDoc(builder, pageContent, lineCounter);
          pageContent = [];
        }

        pageContent.push(line);

        if (i === lines.length - 1) {
          lineCounter++;
          addDoc(builder, pageContent, lineCounter);
        }
      }

      return builder;
    };

    let docs = getDocsFromText(text);
    let withOverlap = this.addOverlapFromPreviousChunks(docs);

    return withOverlap;
  }

  private addOverlapFromPreviousChunks(builder: Document[]) {
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

  getLinesFromPrevChunks(
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

  getLengthNoWhitespace(lines: string[]) {
    if (this.countWhiteSpace) return lines.join("\n").length;
    return getLengthNoWhitespace(lines)
  };
}

export const getLengthNoWhitespace = (lines: string[]) => {
  return lines.reduce((acc, curr) => acc + curr.trim().length, 0) + lines.length - 1;
}

// @ts-ignore
const debug = (addedLines: string[], currLines: string[], chunkSize: number) => {
  // debug
  let fullDoc = [...addedLines, ...currLines].join("\n")
  let fullDocLength = getLengthNoWhitespace([...addedLines, ...currLines])
  console.log(`newLength full ${fullDoc.length} no whitespace ${fullDocLength}`);
}
