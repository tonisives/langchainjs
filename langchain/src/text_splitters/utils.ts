import { Document } from "../document.js";
import chalk from "chalk";

export const getLengthNoWhitespace = (lines: string[]) => {
  return lines.reduce((acc, curr) => acc + curr.trim().length, 0) + lines.length - 1;
}

// @ts-ignore
export const debugFillChunks = (addedLines: string[], currLines: string[], chunkSize: number) => {
  // debug
  let fullDoc = [...addedLines, ...currLines].join("\n")
  let fullDocLength = getLengthNoWhitespace([...addedLines, ...currLines])
  console.log(`newLength full ${fullDoc.length} no whitespace ${fullDocLength}`);
}

export const debugDocBuilder = (docs: Document[]) => {
  let fullDoc = docs.map(d => d.pageContent).join("\n")
  console.log(`current doc builder\n${chalk.yellow(fullDoc)}`)
}

export const addToBuilder = (
  builder: Document[],
  pageContent: string,
  log: boolean,
  lineCounter: number
): number => {
  if (log) console.log(`adding to builder:\n${chalk.blue(pageContent)}`);

  let lineCount = pageContent.split("\n").length - 1

  builder.push({
    pageContent: pageContent,
    metadata: {
      loc: {
        lines: {
          from: lineCounter,
          to: lineCounter + lineCount,
        },
      },
    },
  });

  lineCounter += lineCount;

  // if (log) debugDocBuilder(builder);

  return lineCounter
};

export const willFillChunkSize = (chunk: string, builder: any[], chunkSize: number, chunkOverlap: number) => {
  let overLapReduce = (builder.length > 0 ? chunkOverlap : 0);

  let chunkWillFillChunkSize = getLengthNoWhitespace(chunk.split("\n")) >
    (chunkSize - overLapReduce);
  return chunkWillFillChunkSize;
}

// split on /// and block comments and fill the chunk size. leftover is added to the next chunk 
// and split recursively later
export const preSplitSol = (text: string, chunkSize: number, chunkOverlap: number): string[] => {
  let commentChunks = splitOnSolComments(text).map(it => it.join(""))

  let builder = [] as string[]

  for (let i = 0; i < commentChunks.length; i++) {
    let chunk = commentChunks[i]
    let chunkWillFillChunkSize = willFillChunkSize(chunk, [], chunkSize, chunkOverlap);

    if (chunkWillFillChunkSize) {
      let split = chunk.split("\n")
      let blockBuilder = [] as string[]

      for (let j = 0; j < split.length; j++) {
        let line = split[j]
        blockBuilder.push(line)
        let newLength = getLengthNoWhitespace(blockBuilder)

        if (newLength > chunkSize) {
          let block = blockBuilder.slice(0, -1)
          // need to add \n for the first comment split only
          builder.push(block.join("\n"))

          // push rest of the lines to the next chunk
          let rest = split.slice(j)
          let restChunk = "\n" + rest.join("\n")
          builder.push(restChunk)
          break
        }
      }
    }
    else {
      builder.push(chunk)
    }
  }

  return builder
}

export const splitOnSolComments = (
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

  builder = builder.map(it => it.map(it => it + "\n"))

  // remove last \n for the last item
  if (builder.length > 0) {
    let last = builder[builder.length - 1]
    last[last.length - 1] = last[last.length - 1].slice(0, -1)
  }

  return builder
}