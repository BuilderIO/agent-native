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

  it("does not read a citation from a describe() title, because a suite is not a test", () => {
    expect(
      titleCitations(
        `describe("handles (oracle H.1)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual([]);
  });

  it("does not count a suite citation when the suite holds no runnable test", () => {
    const source = [
      `describe("empty (oracle H.2)", () => {});`,
      `describe("skipped (oracle H.3)", () => {`,
      `  it.todo("moves");`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("reads a citation from a test inside a describe", () => {
    const source = [
      `describe("group", () => {`,
      `  it("moves the box (oracle H.4)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["H.4"]);
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

  it("ignores a citation on it.skip, it.todo and it.skipIf, which do not run", () => {
    const source = [
      `it.skip("moves (oracle 1.1)", () => {});`,
      `it.todo("resizes (oracle 1.2)");`,
      `it.skipIf(true)("snaps (oracle 1.3)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("ignores tests inside a skipped suite", () => {
    const source = [
      `describe.skip("group", () => {`,
      `  it("moves (oracle 2.1)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("ignores a citation on a skipped each() table", () => {
    const source = [
      "it.skip.each([1, 2])(",
      '  "resizes %s (oracle 10.1)",',
      "  (n) => {},",
      ");",
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("still counts concurrent and fails declarations when nothing is focused", () => {
    const source = [
      `it.concurrent("snaps (oracle 4.9)", () => {});`,
      `it.fails("crops (oracle 3.6)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["4.9", "3.6"]);
  });

  it("counts only the focused test in a file that focuses one", () => {
    const source = [
      `it.only("moves (oracle 4.8)", () => {});`,
      `it("snaps (oracle 4.9)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["4.8"]);
  });

  it("counts every test inside a focused suite", () => {
    const source = [
      `describe.only("group", () => {`,
      `  it("moves (oracle 5.1)", () => {});`,
      `});`,
      `it("snaps (oracle 5.2)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["5.1"]);
  });

  it("ignores a test declared inside an uncalled function", () => {
    const source = [
      `function unused() {`,
      `  it("moves (oracle 1.1)", () => {});`,
      `}`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("ignores a test declared inside a helper that is only defined, not registered", () => {
    const source = [
      `const registerCases = () => {`,
      `  it("snaps (oracle 1.2)", () => {});`,
      `};`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("counts a test declared in a describe callback, however deeply it is nested", () => {
    const source = [
      `describe("outer", () => {`,
      `  describe("inner", () => {`,
      `    it("moves (oracle 1.3)", () => {});`,
      `  });`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["1.3"]);
  });

  it("ignores a test inside an if branch, which may never register", () => {
    const source = [
      `if (false) {`,
      `  it("moves (oracle 1.4)", () => {});`,
      `}`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("ignores a test inside a loop, which registers only for some inputs", () => {
    const source = [
      `for (const name of ["a"]) {`,
      `  it("snaps (oracle 1.5)", () => {});`,
      `}`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("ignores a citation on an each table with no cases", () => {
    expect(
      titleCitations(
        `it.each([])("moves %s (oracle 1.6)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual([]);
  });

  it("ignores a citation on an each table it cannot read as literal cases", () => {
    expect(
      titleCitations(
        `it.each(shapes)("moves %s (oracle 1.7)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual([]);
  });

  it("counts a citation on an each table with literal cases", () => {
    expect(
      titleCitations(
        `it.each(["a", "b"])("moves %s (oracle 1.8)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual(["1.8"]);
  });

  it("counts a citation on an each table written as a const assertion", () => {
    expect(
      titleCitations(
        `it.each([["a"], ["b"]] as const)("moves %s (oracle 1.9)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual(["1.9"]);
  });

  it("ignores a table whose spread may expand to no cases", () => {
    expect(
      titleCitations(
        `it.each([...[]])("moves %s (oracle 1.1)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual([]);
  });

  it("ignores a test nested inside another test, which Vitest does not register", () => {
    const source = [
      `it("outer", () => {`,
      `  it("moves (oracle 1.2)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("ignores ordinary tests when a focused test is declared anywhere, even unreachably", () => {
    const source = [
      `if (false) {`,
      `  it.only("never runs (oracle 1.3)", () => {});`,
      `}`,
      `it("snaps (oracle 1.4)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });
});
