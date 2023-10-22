import {
  RecursiveCharacterTextSplitterParams,
  TextSplitter,
  TextSplitterChunkHeaderOptions,
} from "../text_splitter.js";
import { Document } from "../document.js";
import { addToBuilder, getLengthNoWhitespace, preSplitSol, willFillChunkSize } from "./utils.js";

// recursive splitter

// - splits on separators from top to bottom
// - if split fills the chunk size, it chooses the next separator until it doesn't fill the chunk
// ~- if the chunk is too small, it will merge the chunks~
// - option to not count whitespace in front of / end of lines
// ~- adds overlap from the previous chunk after getting initial chunks~ - separator split should be enough

// sol splitter - splits on comments first, then separators

export type TextSplitterRecursiveType = "sol" | "md" | "custom";

export type TextSplitterRecursiveParams = Pick<
  RecursiveCharacterTextSplitterParams,
  "chunkSize" | "chunkOverlap"
> & {
  // by default, we don't count whitespace in front of / end of lines towards the chunk size
  type: TextSplitterRecursiveType; // if defined, don't need to set separators for md and sol
  countWhiteSpace?: boolean;
  separators?: RegExp[]
  debug?: boolean
}

export class TextSplitterRecursive
  extends TextSplitter
  implements TextSplitterRecursiveParams {

  countWhiteSpace: boolean = false;
  separators: RegExp[] = []
  type: TextSplitterRecursiveType = "custom";
  debug: boolean = false

  constructor(fields?: Partial<TextSplitterRecursiveParams>) {
    super(fields);
    this.countWhiteSpace = fields?.countWhiteSpace ?? false;
    this.type = fields?.type ?? "custom";
    this.debug = fields?.debug ?? false

    if (!fields?.separators && fields?.type !== "custom") {
      if (fields?.type === "sol") {
        this.separators = solSeparators;
      }
      else if (fields?.type === "md") {
        this.separators = mdSeparators;
      }
    }
    else {
      this.separators = fields?.separators ?? []
    }

    if (this.type === "custom" && this.separators.length < 1) throw new Error("Please use md or sol separator or include custom separators")
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
    const splitOnSeparator = (
      text: string,
      separator: RegExp,
      builder: Document[]
    ): Document[] => {
      let currentSeparatorIndex = this.separators.indexOf(separator)
      let separatorChunks: string[] = []

      separatorChunks = splitAndMergeSmallChunks(text, separator)

      for (let i = 0; i < separatorChunks.length; i++) {
        let chunk = separatorChunks[i];
        let chunkWillFillChunkSize = this.willFillChunkSize(chunk, []); // splitAndMerge uses [] as builder

        if (chunkWillFillChunkSize) {
          if (i === 0) {
            // continue splitting the first chunk
            splitOnSeparator(chunk, this.separators[currentSeparatorIndex + 1], builder);
          }
          else {
            // 0+ chunk splitting start with the clean separator array 
            splitOnSeparator(chunk, this.separators[0], builder);
          }
        }
        else {
          if (this.debug) console.log(`separator: ${separator}`)
          // add the doc if fits to chunk size
          lineCounter = addToBuilder(builder, chunk, this.debug, lineCounter);
        }
      }

      return builder;
    };

    // if split chunk is smaller than chunk size, merge it with the next one
    const splitAndMergeSmallChunks = (text: string, separator: RegExp) => {
      let split = text.split(separator);
      let builder = [] as string[]
      let results = [] as string[]

      for (let i = 0; i < split.length; i++) {
        builder.push(split[i])

        if (this.willFillChunkSize(builder.join(""), [])) {
          if (builder.length > 1) {
            results.push(builder.slice(0, -1).join(""))
            builder = [builder[builder.length - 1]]
          }
          else {
            results.push(builder.join(""))
            builder = []
          }
        }
      }

      if (builder.length > 0) {
        results.push(builder.join(""))
      }

      return results
    }

    let lineCounter = 1;
    let builder: Document[] = [];

    if (this.type === "sol") {
      let preSplit = preSplitSol(text, this.chunkSize, this.chunkOverlap)

      for (let i = 0; i < preSplit.length; i++) {
        let chunkBuilder = [] as Document[]
        let chunk = preSplit[i]

        let docs = splitOnSeparator(chunk, this.separators[0], chunkBuilder);
        // let withOverlap = this.addOverlapFromPreviousChunks(docs);
        builder.push(...docs)
      }
    }
    else {
      let docs = splitOnSeparator(text, this.separators[0], builder);
      // let withOverlap = this.addOverlapFromPreviousChunks(docs);
      return docs;
    }

    return builder;
  }

  // @param builder - first chunks does not add overlap 
  willFillChunkSize(chunk: string, builder: any[]) {
    return willFillChunkSize(chunk, builder, this.chunkSize, this.chunkOverlap)
  }

  protected addOverlapFromPreviousChunks(builder: Document[]) {
    if (builder.length <= 1) return builder;

    for (let i = 1; i < builder.length; i++) {
      let currLines = builder[i].pageContent.split("\n");

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

const baseSeparators = [
  // split on \n and keep the \n separator
  /(?<=\n)/,
  /(?<=\s)/,
]

// this does not include the \n. It can be used to join lines later with included \n
const newLineRegex = (regex: string) => {
  return new RegExp(`(?<=\n)(?=(\s+|)${regex})`, "g")
}

export const solSeparators = [
  // Split along compiler informations definitions
  newLineRegex("pragma "),
  newLineRegex("using "),

  // Split along contract definitions
  newLineRegex("contract "),
  newLineRegex("interface "),
  newLineRegex("library "),
  // Split along method definitions
  newLineRegex("constructor "),
  newLineRegex("type "),
  newLineRegex("function "),
  newLineRegex("event "),
  newLineRegex("modifier "),
  newLineRegex("error "),
  newLineRegex("struct "),
  newLineRegex("enum "),
  // Split along control flow statements
  newLineRegex("if "),
  newLineRegex("for "),
  newLineRegex("while "),
  newLineRegex("do "),
  newLineRegex("assembly "),
  // Split by the normal type of lines
  ...baseSeparators
];

export const mdSeparators = [
  // First, try to split along Markdown headings
  newLineRegex("# "),
  newLineRegex("## "),
  newLineRegex("### "),
  newLineRegex("#### "),
  newLineRegex("##### "),
  newLineRegex("###### "),
  // Note the alternative syntax for headings (below) is not handled here
  // Heading level 2
  // ---------------
  // End of code block
  newLineRegex("```\n\n"),
  // Horizontal lines
  newLineRegex("\\*{3}\n\n"),
  newLineRegex("---\n\n"),
  newLineRegex("___\n\n"),
  // Note that this splitter doesn't handle horizontal lines defined
  // by *three or more* of ***, ---, or ___, but this is not handled
  ...baseSeparators,
];
