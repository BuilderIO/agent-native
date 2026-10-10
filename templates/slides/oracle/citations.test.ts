import { describe, expect, it } from "vitest";

import { titleCitations } from "./citations";

describe("titleCitations counts only test titles", () => {
  it("reads a citation from an it() title", () => {
    expect(
      titleCitations(
        `it("moves the box (oracle 4.8)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual(["4.8"]);
  });

  it("reads a citation from a title that wraps onto the next line", () => {
    const source = [
      "it(",
      '  "moves the box (oracle 4.8)",',
      "  () => {},",
      ");",
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["4.8"]);
  });

  it("reads a citation from a describe() title", () => {
    expect(
      titleCitations(
        `describe("handles (oracle H.1)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual(["H.1"]);
  });

  it("reads a citation from an it.each() title", () => {
    const source = [
      "it.each([1, 2])(",
      '  "resizes %s (oracle 10.1)",',
      "  (n) => {},",
      ");",
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["10.1"]);
  });

  it("reads every id in one title", () => {
    expect(
      titleCitations(
        `it("wraps (oracle 1.2, oracle 2.1)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual(["1.2", "2.1"]);
  });

  it("reads a gap id from a title", () => {
    expect(
      titleCitations(
        `it("aligns (oracle G.align-objects)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual(["G.align-objects"]);
  });

  it("ignores a citation inside an assertion message", () => {
    expect(
      titleCitations(
        `it("keeps the box", () => { expect(v, "see oracle 1.1").toBe(1); });`,
        "a.test.ts",
      ),
    ).toEqual([]);
  });

  it("ignores a citation in a comment", () => {
    expect(
      titleCitations(
        `// oracle 1.1 is covered elsewhere\nit("keeps the box", () => {});`,
        "a.test.ts",
      ),
    ).toEqual([]);
  });

  it("ignores a citation in a plain string constant", () => {
    expect(titleCitations(`const note = "oracle 1.1";`, "a.test.ts")).toEqual(
      [],
    );
  });

  it("ignores a citation in a test body", () => {
    expect(
      titleCitations(
        `it("does a thing", () => { expect(v).toBe("oracle 3.6"); });`,
        "a.test.ts",
      ),
    ).toEqual([]);
  });
});
