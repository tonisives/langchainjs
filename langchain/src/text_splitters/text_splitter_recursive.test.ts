import { expect, test } from "@jest/globals";
import { Document } from "../document.js";
import fs from "fs";
import { getLengthNoWhitespace, preSplitSol, splitOnSolComments } from "./utils.js";
import { TextSplitterRecursive } from "./text_splitter_recursive.js";

test.skip("splits full contract", async () => {
  const splitter = new TextSplitterRecursive({
    chunkSize: 550,
    chunkOverlap: 0,
    type: "sol",
  });
  let text = fs.readFileSync("./src/text_splitters/tests/samples/sample.sol").toString();

  const docs = await splitter.createDocuments([text], undefined, undefined);

  printResultToFile("sample.sol", docs, "recursive");

  for (let i = 1; i < docs.length; i++) {
    let prev = docs[i - 1];
    let curr = docs[i];

    expect(prev.metadata.loc.lines.from).toBeLessThanOrEqual(
      curr.metadata.loc.lines.from
    );
  }

  expect(docs.at(-1)?.metadata.loc.lines.to).toBe(text.split("\n").length);
  verifyMiddleChunksWithCorrectLength(docs, 550, 550 * 0.2);
});

test("splits long if case", async () => {
  // verify long block is split correctly on separators (`if`) and the original text is preserved 1:1
  const splitter = new TextSplitterRecursive({
    chunkSize: 550,
    chunkOverlap: 0,
    type: "sol",
  });
  let text = fs.readFileSync("./src/text_splitters/tests/samples/sample-long-if.sol").toString();

  const docs = await splitter.createDocuments([text], undefined, undefined);

  printResultToFile("sample-long-if.sol", docs, "recursive");

  let allLines = ""

  for (let i = 0; i < docs.length; i++) {
    let curr = docs[i];

    if (i > 0) {
      let prev = docs[i - 1];
      expect(prev.metadata.loc.lines.from).toBeLessThanOrEqual(
        curr.metadata.loc.lines.from
      );
    }

    allLines += curr.pageContent
  }

  expect(allLines).toBe(text)

  expect(docs.at(-1)?.metadata.loc.lines.to).toBe(text.split("\n").length);
  verifyMiddleChunksWithCorrectLength(docs, 550, 550 * 0.2);
})

test("pre split sol", async () => {
  let text = fs.readFileSync("./src/text_splitters/tests/samples/sample.sol").toString();
  let split = preSplitSol(text, 550, 0)
  let joined = split.join("\n")
  expect(joined).toBe(text)
})

test("split on comments", async () => {
  let text = fs.readFileSync("./src/text_splitters/tests/samples/sample.sol").toString();
  let split = splitOnSolComments(text)
  let joined = split.map(s => s.join("\n")).join("\n")
  expect(joined).toBe(text)
})

/* test("overlap and lines md", async () => {
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
}); */

const verifyMiddleChunksWithCorrectLength = (docs: Document[], chunkSize: number, deviation = 5) => {
  // deviation: on character split needs to be precise(5)
  // on new lines, we can expect deviation of ~20% from the target chunk size (not precise to character)

  for (let i = 1; i < docs.length - 1; i++) {
    let curr = docs[i];
    let length = getLengthNoWhitespace(curr.pageContent.split("\n"));
    let distFromSize = Math.abs(length - chunkSize);
    // since we don't match whitespace, then deviation is acceptable
    expect(distFromSize).toBeLessThanOrEqual(deviation);
  }
}

const printResultToFile = (fileName: string, docs: Document[], version: string = "v1") => {
  let file = "";
  for (const doc of docs) {
    let metadata = doc.metadata;
    let content = doc.pageContent;
    file += `${JSON.stringify(metadata, null, 2)}\n${content}\n`;
  }

  fs.mkdirSync("./src/tests/text_splitters/results", { recursive: true });
  fs.writeFileSync(`./src/tests/text_splitters/results/${fileName.split(".")[1]}-${version}.txt`, file);
};
