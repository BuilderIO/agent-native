import { describe, expect, it } from "vitest";

import { docToNfm, nfmToDoc, canonicalizeNfm } from "../../../shared/nfm";

function toggleDoc(summary: string, headingLevel = 0) {
  return {
    type: "doc",
    content: [
      {
        type: "notionToggle",
        attrs: { summary, headingLevel, open: true, color: null },
        content: [{ type: "paragraph" }],
      },
    ],
  } as any;
}

describe("bug A repro", () => {
  it("heading toggle trailing backslash", () => {
    const doc = toggleDoc("b\\", 2);
    const nfm = docToNfm(doc);
    console.log("NFM:", JSON.stringify(nfm));
    const doc2 = nfmToDoc(nfm);
    console.log("DOC2:", JSON.stringify(doc2));
  });

  it("details toggle trailing backslash (windows path)", () => {
    const doc = toggleDoc("C:\\path\\", 0);
    const nfm = docToNfm(doc);
    console.log("NFM:", JSON.stringify(nfm));
    const doc2 = nfmToDoc(nfm);
    console.log("DOC2:", JSON.stringify(doc2));
  });

  it("details toggle with attr-lookalike text", () => {
    const doc = toggleDoc('hello {color="red"}', 0);
    const nfm = docToNfm(doc);
    console.log("NFM:", JSON.stringify(nfm));
    const doc2 = nfmToDoc(nfm);
    console.log("DOC2:", JSON.stringify(doc2));
  });

  it("heading toggle with attr-lookalike text", () => {
    const doc = toggleDoc('hello {color="red"}', 2);
    const nfm = docToNfm(doc);
    console.log("NFM:", JSON.stringify(nfm));
    const doc2 = nfmToDoc(nfm);
    console.log("DOC2:", JSON.stringify(doc2));
  });

  it("details toggle with backticks", () => {
    const doc = toggleDoc("some `code` here", 0);
    const nfm = docToNfm(doc);
    console.log("NFM:", JSON.stringify(nfm));
    const doc2 = nfmToDoc(nfm);
    console.log("DOC2:", JSON.stringify(doc2));
  });

  it("heading toggle with backticks", () => {
    const doc = toggleDoc("some `code` here", 2);
    const nfm = docToNfm(doc);
    console.log("NFM:", JSON.stringify(nfm));
    const doc2 = nfmToDoc(nfm);
    console.log("DOC2:", JSON.stringify(doc2));
  });

  it("heading toggle where summary itself contains toggle=true lookalike", () => {
    const doc = toggleDoc('weird {toggle="true"}', 2);
    const nfm = docToNfm(doc);
    console.log("NFM:", JSON.stringify(nfm));
    const doc2 = nfmToDoc(nfm);
    console.log("DOC2:", JSON.stringify(doc2));
  });

  it("heading toggle with trailing double backslash (already even)", () => {
    const doc = toggleDoc("b\\\\", 2);
    const nfm = docToNfm(doc);
    console.log("NFM:", JSON.stringify(nfm));
    const doc2 = nfmToDoc(nfm);
    console.log("DOC2:", JSON.stringify(doc2));
  });

  it("notion canonical: keeps inline formatting in details summary intact", () => {
    const nfm = [
      "<details>",
      "<summary>**bold** [link](https://x) `code`</summary>",
      "\tBody",
      "</details>",
    ].join("\n");
    console.log("CANON:", JSON.stringify(canonicalizeNfm(nfm)));
    expect(canonicalizeNfm(nfm)).toBe(nfm);
  });

  it("notion canonical: toggle heading with bold", () => {
    const nfm = ['# **bold** title {toggle="true"}', "\tChild"].join("\n");
    console.log("CANON:", JSON.stringify(canonicalizeNfm(nfm)));
    expect(canonicalizeNfm(nfm)).toBe(nfm);
  });

  it("notion canonical: already-escaped literal summary", () => {
    const nfm = [
      "<details>",
      "<summary>\\*not bold\\*</summary>",
      "\tBody",
      "</details>",
    ].join("\n");
    console.log("CANON:", JSON.stringify(canonicalizeNfm(nfm)));
    expect(canonicalizeNfm(nfm)).toBe(nfm);
  });
});
