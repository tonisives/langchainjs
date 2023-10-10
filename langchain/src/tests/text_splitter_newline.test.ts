import { expect, test } from "@jest/globals";
import { Document } from "../document.js";
import fs from "fs";
import { TextSplitterNewLine, getLengthNoWhitespace } from "../text_splitter_newline.js";

test("overlap and lines sol", async () => {
  const splitter = new TextSplitterNewLine({
    chunkSize: 550,
    chunkOverlap: 200,
  });
  let text = fs.readFileSync("./src/tests/samples/sample.sol").toString();

  const docs = await splitter.createDocuments([text], undefined, undefined);

  printResultToFile("sample.sol", docs);

  for (let i = 1; i < docs.length; i++) {
    let prev = docs[i - 1];
    let curr = docs[i];

    expect(prev.metadata.loc.lines.from).toBeLessThanOrEqual(
      curr.metadata.loc.lines.from
    );
    let prevLastLine = prev.pageContent.split("\n").at(-1)!;
    expect(
      curr.pageContent.split("\n").some((it) => it.startsWith(prevLastLine))
    ).toBe(true);
  }

  expect(docs.at(-1)?.metadata.loc.lines.to).toBe(text.split("\n").length);
  verifyMiddleChunksWithCorrectLength(docs, 550);
});

test("overlap and lines md", async () => {
  const splitter = new TextSplitterNewLine({
    chunkSize: 550,
    chunkOverlap: 200,
  });

  let text = fs.readFileSync("./src/tests/samples/sample.md").toString();
  const docs = await splitter.createDocuments([text], undefined, undefined);
  printResultToFile("sample.md", docs);

  for (let i = 1; i < docs.length; i++) {
    let prev = docs[i - 1];
    let curr = docs[i];

    expect(prev.metadata.loc.lines.from).toBeLessThanOrEqual(
      curr.metadata.loc.lines.from
    );
  }

  expect(docs.at(-1)?.metadata.loc.lines.to).toBe(text.split("\n").length);
});

test("adds a slice of line if overlap line too long", async () => {
  const splitter = new TextSplitterNewLine({
    chunkSize: 550,
    chunkOverlap: 200,
  });

  let text = fs.readFileSync("./src/tests/samples/sample.md").toString();
  const docs = await splitter.createDocuments([text], undefined, undefined);

  verifyMiddleChunksWithCorrectLength(docs, 550);
});

const verifyMiddleChunksWithCorrectLength = (docs: Document[], chunkSize: number) => {
  for (let i = 1; i < docs.length - 1; i++) {
    let curr = docs[i];
    let length = getLengthNoWhitespace(curr.pageContent.split("\n"));
    let distFromSize = Math.abs(length - chunkSize);
    // since we don't match whitespace, then deviation is acceptable
    expect(distFromSize).toBeLessThanOrEqual(5);
  }
}

const printResultToFile = (fileName: string, docs: Document[]) => {
  let file = "";
  for (const doc of docs) {
    let metadata = doc.metadata;
    let content = doc.pageContent;
    file += `${JSON.stringify(metadata, null, 2)}\n${content}\n`;
  }

  fs.mkdirSync("./src/tests/results", { recursive: true });
  fs.writeFileSync(`./src/tests/results/${fileName}.txt`, file);
};
