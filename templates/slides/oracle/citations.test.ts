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

  it("counts ordinary tests when a focused test sits in a branch that never runs", () => {
    const source = [
      `if (false) {`,
      `  it.only("never runs (oracle 1.3)", () => {});`,
      `}`,
      `it("snaps (oracle 1.4)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["1.4"]);
  });

  it("ignores ordinary tests when a focused test sits in a branch that always runs", () => {
    const source = [
      `if (true) {`,
      `  it.only("runs (oracle 1.3)", () => {});`,
      `}`,
      `it("snaps (oracle 1.4)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("ignores ordinary tests when a focused test sits behind a condition it cannot read", () => {
    const source = [
      `if (flag) {`,
      `  it.only("maybe (oracle 1.3)", () => {});`,
      `}`,
      `it("snaps (oracle 1.4)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("counts a test that skipIf enables with a literal false", () => {
    expect(
      titleCitations(
        `it.skipIf(false)("moves (oracle 1.5)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual(["1.5"]);
  });

  it("counts a test that runIf enables with a literal true", () => {
    expect(
      titleCitations(
        `it.runIf(true)("snaps (oracle 1.6)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual(["1.6"]);
  });

  it("ignores a conditional test whose condition is not a literal", () => {
    expect(
      titleCitations(
        `it.runIf(flag)("crops (oracle 1.7)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual([]);
  });

  it("ignores tests after a suite callback that may return early", () => {
    const source = [
      `describe("group", () => {`,
      `  if (flag) return;`,
      `  it("moves (oracle 2.1)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("reads a test in a JSX test file", () => {
    expect(
      titleCitations(
        `it("renders (oracle 2.2)", () => { const el = <div />; });`,
        "a.test.jsx",
      ),
    ).toEqual(["2.2"]);
  });

  it("counts a citation on a tagged-template each table with cases", () => {
    const source = [
      "it.each`",
      "  a | b",
      "  ${1} | ${2}",
      '`("moves (oracle 2.3)", () => {});',
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["2.3"]);
  });

  it("ignores a citation on a tagged-template each table with no cases", () => {
    expect(
      titleCitations(
        'it.each`\n  a | b\n`("moves (oracle 2.4)", () => {});',
        "a.test.ts",
      ),
    ).toEqual([]);
  });

  it("counts a citation on an it.for table with cases", () => {
    expect(
      titleCitations(
        `it.for([[1], [2]])("moves %s (oracle 2.5)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual(["2.5"]);
  });

  it("keeps reading after a break that belongs to a loop", () => {
    const source = [
      `describe("group", () => {`,
      `  for (const x of [1, 2]) { if (x) break; }`,
      `  it("moves (oracle 3.1)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["3.1"]);
  });

  it("reads a suite declared with suite from vitest", () => {
    const source = [
      `import { suite } from "vitest";`,
      `suite("group", () => { it("moves (oracle 3.2)", () => {}); });`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["3.2"]);
  });

  it("reads a test declared through an aliased vitest import", () => {
    const source = [
      `import { it as check } from "vitest";`,
      `check("moves (oracle 3.3)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["3.3"]);
  });

  it("reads a test declared through a vitest namespace import", () => {
    const source = [
      `import * as v from "vitest";`,
      `v.it("moves (oracle 3.4)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["3.4"]);
  });

  it("ignores a sibling of an it.only inside a focused suite", () => {
    const source = [
      `describe.only("group", () => {`,
      `  it.only("moves (oracle 3.5)", () => {});`,
      `  it("snaps (oracle 3.6)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["3.5"]);
  });

  it("keeps reading after a return inside a class method", () => {
    const source = [
      `describe("group", () => {`,
      `  class Helper { value() { return 1; } }`,
      `  it("moves (oracle 4.1)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["4.1"]);
  });

  it("ignores a direct each call that has no table", () => {
    expect(
      titleCitations(`it.each("moves (oracle 6.1)", () => {});`, "a.test.ts"),
    ).toEqual([]);
  });

  it("ignores a direct for call that has no table", () => {
    expect(
      titleCitations(`it.for("moves (oracle 6.2)", () => {});`, "a.test.ts"),
    ).toEqual([]);
  });

  it("ignores a test through a locally declared function that shadows the global", () => {
    const source = [
      `function it(name: string, fn: () => void) {}`,
      `it("moves (oracle 6.3)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("keeps reading after a return inside an object-literal method", () => {
    const source = [
      `describe("group", () => {`,
      `  const helper = { run() { return; } };`,
      `  it("moves (oracle 6.4)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["6.4"]);
  });

  it("ignores a test through a shorthand destructured name that shadows the global", () => {
    const source = [
      `const ctx = { it: (name: string, fn: () => void) => fn };`,
      `const { it } = ctx;`,
      `it("moves (oracle 7.1)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("ignores a call through a nested binding that shadows an imported vitest function", () => {
    const source = [
      `import { it } from "vitest";`,
      `describe("group", () => {`,
      `  const it = (name: string) => name;`,
      `  it("moves (oracle 7.2)");`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("counts a top-level test when an unrelated helper parameter shares its name", () => {
    const source = [
      `function helper(it: string) { return it; }`,
      `it("moves (oracle 8.1)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["8.1"]);
  });

  it("counts a test in one suite when a sibling suite declares the same name", () => {
    const source = [
      `describe("a", () => { const it = 1; });`,
      `describe("b", () => { it("moves (oracle 8.2)", () => {}); });`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["8.2"]);
  });

  it("counts a real focus when a helper parameter shares its name", () => {
    const source = [
      `function helper(it: string) { return it; }`,
      `it.only("moves (oracle 8.4)", () => {});`,
      `it("snaps (oracle 8.5)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["8.4"]);
  });

  it("ignores a test through a var that hoists out of a nested block", () => {
    const source = [
      `describe("group", () => {`,
      `  if (flag) { var it = 1; }`,
      `  it("moves (oracle 8.6)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("counts a handler wrapped in parentheses or a type cast, which runs after focus is decided", () => {
    const source = [
      `it("moves (oracle 8.16)", (() => { it.only("never runs", () => {}); }));`,
      `it("resizes (oracle 8.17)", ((() => { it.only("never runs", () => {}); }) as () => void));`,
      `it("snaps (oracle 8.18)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([
      "8.16",
      "8.17",
      "8.18",
    ]);
  });

  it("keeps a focus in a table that a test declaration evaluates at collection", () => {
    const source = [
      `it.each([1, (it.only("focused", () => {}), 2)])("moves %s (oracle 8.10)", () => {});`,
      `it("snaps (oracle 8.11)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("keeps a focus in a skipIf condition that Vitest evaluates at collection", () => {
    const source = [
      `it.skipIf((it.only("focused", () => {}), false))("moves (oracle 8.12)", () => {});`,
      `it("snaps (oracle 8.13)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("keeps a focus in a title expression that Vitest evaluates at collection", () => {
    const source = [
      `it((() => { it.only("focused", () => {}); return "moves (oracle 8.14)"; })(), () => {});`,
      `it("snaps (oracle 8.15)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("counts a focus called through a computed string member or a cast object", () => {
    const source = [
      `it["only"]("focused (oracle 9.4)", () => {});`,
      `(it as any).only("cast (oracle 9.6)", () => {});`,
      `it("snaps (oracle 9.5)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.4", "9.6"]);
  });

  it("counts a focus written as an optional chain or a template-keyed member", () => {
    const source = [
      `it?.only("optional (oracle 9.8)", () => {});`,
      'it[`only`]("template (oracle 9.10)", () => {});',
      `it("snaps (oracle 9.9)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.8", "9.10"]);
  });

  it("counts a test through a module const that stands for a vitest function", () => {
    const source = [
      `const t = it;`,
      `t.only("aliased focus (oracle 9.12)", () => {});`,
      `it("snaps (oracle 9.13)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.12"]);
  });

  it("counts a focus through a const that holds a vitest method", () => {
    const source = [
      `const focus = it.only;`,
      `focus("focus alias (oracle 9.14)", () => {});`,
      `it("snaps (oracle 9.15)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.14"]);
  });

  it("does not read an alias that a nested parameter shadows", () => {
    const source = [
      `const t = it;`,
      `function helper(t: { only(n: string, f: () => void): void }) { t.only("never (oracle 9.16)", () => {}); }`,
      `it("moves (oracle 9.17)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.17"]);
  });

  it("counts a parenthesized callee and an optional-chained table", () => {
    const source = [
      `(it)("parens (oracle 9.18)", () => {});`,
      `it?.each([1])("table %s (oracle 9.19)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.18", "9.19"]);
  });

  it("follows an alias made from an earlier alias", () => {
    const source = [
      `const base = it;`,
      `const focus = base.only;`,
      `focus("chained focus (oracle 9.20)", () => {});`,
      `it("snaps (oracle 9.21)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.20"]);
  });

  it("follows an alias declared inside a suite callback", () => {
    const source = [
      `describe("group", () => {`,
      `  const focus = it.only;`,
      `  focus("suite focus (oracle 9.22)", () => {});`,
      `  it("snaps (oracle 9.23)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.22"]);
  });

  it("follows an alias made by it.extend, which returns a test function", () => {
    const source = [
      `const myTest = it.extend({});`,
      `myTest.only("extended focus (oracle 9.24)", () => {});`,
      `it("snaps (oracle 9.25)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.24"]);
  });

  it("refuses a let that binds a vitest function, which the scan cannot follow", () => {
    const source = [
      `let t = it;`,
      `t.only("never (oracle 9.26)", () => {});`,
    ].join("\n");
    expect(() => titleCitations(source, "a.test.ts")).toThrow(
      /bind it with const/,
    );
  });

  it("ignores a focus over an empty table, which registers no test", () => {
    const source = [
      `it.only.each([])("empty (oracle 9.27)", () => {});`,
      `it("snaps (oracle 9.28)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.28"]);
  });

  it("reads a parenthesized static computed key as the member it names", () => {
    const source = [
      `it[("only")]("paren key (oracle 9.29)", () => {});`,
      `it("snaps (oracle 9.30)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.29"]);
  });

  it("reads a parenthesized literal condition, so a runIf on true runs", () => {
    expect(
      titleCitations(
        `it.runIf((true))("runs (oracle 9.31)", () => {});`,
        "a.test.ts",
      ),
    ).toEqual(["9.31"]);
  });

  it("drops the focus of a chain that extend builds a fresh test function from", () => {
    const source = [
      `const t = it.only.extend({});`,
      `t("moves (oracle 9.32)", () => {});`,
      `it.only("snaps (oracle 9.33)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.33"]);
  });

  it("does not alias a const to a function that a later declaration hoists over", () => {
    const source = [
      `const f = it;`,
      `function it(name: string, fn: () => void) { fn(); }`,
      `f("moves (oracle 9.34)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("skips a test whose options object sets skip", () => {
    const source = [
      `it("moves (oracle 9.35)", { skip: true }, () => {});`,
      `it("snaps (oracle 9.36)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.36"]);
  });

  it("focuses the file when an options object sets only", () => {
    const source = [
      `it("moves (oracle 9.37)", { only: true }, () => {});`,
      `it("snaps (oracle 9.38)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.37"]);
  });

  it("treats a test with no handler as todo, so it does not run", () => {
    const source = [
      `it("moves (oracle 9.39)");`,
      `it("snaps (oracle 9.40)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.40"]);
  });

  it("skips every test in a suite whose options object sets skip", () => {
    const source = [
      `describe("group", { skip: true }, () => {`,
      `  it("moves (oracle 9.41)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("reads a shuffled suite as a suite", () => {
    const source = [
      `describe.shuffle("group", () => {`,
      `  it("moves (oracle 9.42)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.42"]);
  });

  it("counts ordinary tests when a focus sits inside a hook, which runs at test time", () => {
    const source = [
      `beforeEach(() => { it.only("never runs", () => {}); });`,
      `it("moves (oracle 9.1)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["9.1"]);
  });

  it("keeps a focus inside a call that may run at collection", () => {
    const source = [
      `withSetup(() => { it.only("focused", () => {}); });`,
      `it("moves (oracle 9.2)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual([]);
  });

  it("counts ordinary tests when a focus sits inside a test body, which runs after focus is decided", () => {
    const source = [
      `it("outer", () => { it.only("never registers (oracle 8.8)", () => {}); });`,
      `it("snaps (oracle 8.9)", () => {});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["8.9"]);
  });

  it("counts a test after a block-scoped const that ends with its block", () => {
    const source = [
      `describe("group", () => {`,
      `  if (flag) { const it = 1; }`,
      `  it("moves (oracle 8.7)", () => {});`,
      `});`,
    ].join("\n");
    expect(titleCitations(source, "a.test.ts")).toEqual(["8.7"]);
  });
});
