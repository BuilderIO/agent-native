import { describe, expect, it } from "vitest";

import { formatWithPrettier, isFormattablePath } from "./prettier-format";

describe("isFormattablePath", () => {
  it("recognizes supported extensions", () => {
    expect(isFormattablePath("index.html")).toBe(true);
    expect(isFormattablePath("styles.css")).toBe(true);
    expect(isFormattablePath("app.js")).toBe(true);
    expect(isFormattablePath("app.jsx")).toBe(true);
    expect(isFormattablePath("app.ts")).toBe(true);
    expect(isFormattablePath("app.tsx")).toBe(true);
    expect(isFormattablePath("data.json")).toBe(true);
    expect(isFormattablePath("README.md")).toBe(true);
  });

  it("rejects unsupported extensions", () => {
    expect(isFormattablePath("image.png")).toBe(false);
    expect(isFormattablePath("archive.zip")).toBe(false);
    expect(isFormattablePath("no-extension")).toBe(false);
    expect(isFormattablePath("config.yaml")).toBe(false);
  });
});

describe("formatWithPrettier", () => {
  it("formats ugly HTML", async () => {
    const result = await formatWithPrettier(
      "<div><p>hello   world</p></div>",
      "index.html",
    );
    expect("formatted" in result).toBe(true);
    if ("formatted" in result) {
      expect(result.formatted).toContain("<div>");
      expect(result.formatted.endsWith("\n")).toBe(true);
    }
  });

  it("formats ugly CSS", async () => {
    const result = await formatWithPrettier(
      ".foo{color:red;background:blue}",
      "styles.css",
    );
    expect("formatted" in result).toBe(true);
    if ("formatted" in result) {
      expect(result.formatted).toContain("color: red;");
    }
  });

  it("formats ugly JavaScript", async () => {
    const result = await formatWithPrettier(
      "const   x=1;function foo( a,b ){return a+b}",
      "script.js",
    );
    expect("formatted" in result).toBe(true);
    if ("formatted" in result) {
      expect(result.formatted).toContain("const x = 1;");
    }
  });

  it("formats ugly TypeScript", async () => {
    const result = await formatWithPrettier(
      "const x:number=1;function foo(a:number,b:number):number{return a+b}",
      "script.ts",
    );
    expect("formatted" in result).toBe(true);
    if ("formatted" in result) {
      expect(result.formatted).toContain("const x: number = 1;");
    }
  });

  it("formats ugly JSON", async () => {
    const result = await formatWithPrettier('{"a":1,"b":2}', "data.json");
    expect("formatted" in result).toBe(true);
    if ("formatted" in result) {
      expect(result.formatted.trim()).toBe('{ "a": 1, "b": 2 }');
    }
  });

  it("returns an error (never throws) for unparseable content", async () => {
    await expect(
      formatWithPrettier("const x = {{{{ this is not valid js", "broken.js"),
    ).resolves.toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it("returns an error for a path with no known formatter", async () => {
    const result = await formatWithPrettier("anything", "image.png");
    expect("error" in result).toBe(true);
  });
});
