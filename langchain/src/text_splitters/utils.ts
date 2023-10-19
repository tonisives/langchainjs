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
