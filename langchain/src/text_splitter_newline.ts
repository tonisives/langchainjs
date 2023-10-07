import { RecursiveCharacterTextSplitterParams, TextSplitter, TextSplitterChunkHeaderOptions } from "./text_splitter.js";
import { Document } from "./document.js";

export type TextSplitterNewLineParams = Pick<RecursiveCharacterTextSplitterParams, "chunkSize" | "chunkOverlap">;

export class TextSplitterNewLine
  extends TextSplitter
  implements TextSplitterNewLineParams {
  constructor(fields?: Partial<TextSplitterNewLineParams>) {
    super(fields);
  }

  async createDocuments(
    texts: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadatas: Record<string, any>[] = [],
    // not implemented
    _chunkHeaderOptions: TextSplitterChunkHeaderOptions = {}
  ): Promise<Document[]> {
    let builder = [] as Document[][]

    for (const text of texts) {
      let docs = await this._splitText(text)
      builder.push(docs.map(it => ({
        ...it,
        metadata: {
          ...it.metadata,
          ...metadatas[builder.length]
        }
      })))
    }

    return builder.flat()
  }

  async splitText(text: string): Promise<string[]> {
    let docs = await this._splitText(text)
    return docs.map(doc => doc.pageContent)
  }

  private async _splitText(text: string): Promise<Document[]> {
    const addDoc = (builder: Document[], pageContent: string[], lineCounter: number) => {
      builder.push({
        pageContent: pageContent.join("\n"),
        metadata: {
          loc: {
            lines: {
              from: lineCounter - pageContent.length,
              to: lineCounter - 1
            }
          }
        }
      })
    }

    const getLengthNoWhitespace = (lines: string[]) => {
      return lines.reduce((acc, curr) => acc + curr.trim().length, 0)
    }

    const getDocsFromText = (text: string) => {
      let builder: Document[] = []
      let lines = text.split("\n")

      let pageContent = [] as string[]
      let lineCounter = 0

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        lineCounter++

        let currentPageContent = pageContent.join("\n")
        let lineWillFillChunk = getLengthNoWhitespace([...pageContent, line]) > (this.chunkSize - this.chunkOverlap)

        // if line + overlap is longer than the chunk, it will be added in next loop with overflown size
        if (lineWillFillChunk && pageContent.length > 0) {
          if (currentPageContent.trim().length > 0) addDoc(builder, pageContent, lineCounter)
          pageContent = []
        }

        pageContent.push(line)

        if (i === lines.length - 1) {
          lineCounter++
          addDoc(builder, pageContent, lineCounter)
        }
      }

      return builder
    }

    let docs = getDocsFromText(text)
    let withOverlap = this.addOverlapFromPreviousChunks(docs);

    return withOverlap
  }

  private addOverlapFromPreviousChunks(builder: Document[]) {
    if (builder.length <= 1) return builder

    for (let i = 1; i < builder.length; i++) {
      let prevChunkLines = builder[i - 1].pageContent.split("\n");

      let addedLines = [] as string[]

      for (let j = prevChunkLines.length - 1; j > 0; j--) {
        let prevLine = prevChunkLines[j];
        if (addedLines.join("\n").length + prevLine.length > this.chunkOverlap) {
          break;
        }

        addedLines.push(prevLine);
      }

      addedLines = addedLines.reverse();

      builder[i] = {
        pageContent: `${addedLines.join("\n")}\n${builder[i].pageContent}`,
        metadata: {
          ...builder[i].metadata,
          loc: {
            lines: {
              from: builder[i].metadata.loc.lines.from - addedLines.length,
              to: builder[i].metadata.loc.lines.to
            }
          }
        }
      }
    }

    return builder
  }
}