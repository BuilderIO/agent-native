import { describe, it, expect } from "vitest";
import { parseArgs, camelCaseArgs, isValidPath, isValidProjectPath } from "./utils.js";

describe("parseArgs", () => {
  it("parses --key value format", () => {
    expect(parseArgs(["--name", "hello"])).toEqual({ name: "hello" });
  });

  it("parses --key=value format", () => {
    expect(parseArgs(["--name=hello"])).toEqual({ name: "hello" });
  });

  it("parses --flag as boolean true", () => {
    expect(parseArgs(["--verbose"])).toEqual({ verbose: "true" });
  });

  it("returns empty object for empty array", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("handles mixed formats", () => {
    expect(parseArgs(["--name", "hello", "--count=5", "--verbose"])).toEqual({
      name: "hello",
      count: "5",
      verbose: "true",
    });
  });

  it("treats --key --other-key as two boolean flags", () => {
    expect(parseArgs(["--foo", "--bar"])).toEqual({ foo: "true", bar: "true" });
  });

  it("skips non-flag arguments", () => {
    expect(parseArgs(["positional", "--name", "hello"])).toEqual({ name: "hello" });
  });
});

describe("camelCaseArgs", () => {
  it("converts kebab-case to camelCase", () => {
    expect(camelCaseArgs({ "my-key": "val" })).toEqual({ myKey: "val" });
  });

  it("leaves already camelCase keys unchanged", () => {
    expect(camelCaseArgs({ myKey: "val" })).toEqual({ myKey: "val" });
  });

  it("leaves single-word keys unchanged", () => {
    expect(camelCaseArgs({ name: "val" })).toEqual({ name: "val" });
  });

  it("returns empty object for empty input", () => {
    expect(camelCaseArgs({})).toEqual({});
  });
});

describe("isValidPath", () => {
  it("accepts a valid relative path", () => {
    expect(isValidPath("data/file.json")).toBe(true);
  });

  it("rejects absolute paths", () => {
    expect(isValidPath("/etc/passwd")).toBe(false);
  });

  it("rejects directory traversal", () => {
    expect(isValidPath("../secret")).toBe(false);
  });

  it("rejects null bytes", () => {
    expect(isValidPath("file\0.json")).toBe(false);
  });

  it("accepts a simple filename", () => {
    expect(isValidPath("readme.md")).toBe(true);
  });
});

describe("isValidProjectPath", () => {
  it("accepts a valid slug", () => {
    expect(isValidProjectPath("my-project")).toBe(true);
  });

  it("accepts a grouped slug", () => {
    expect(isValidProjectPath("group/my-project")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidProjectPath("")).toBe(false);
  });

  it("rejects path with special characters", () => {
    expect(isValidProjectPath("my project!")).toBe(false);
  });

  it("rejects absolute paths", () => {
    expect(isValidProjectPath("/absolute")).toBe(false);
  });

  it("rejects directory traversal", () => {
    expect(isValidProjectPath("../escape")).toBe(false);
  });

  it("rejects uppercase characters", () => {
    expect(isValidProjectPath("MyProject")).toBe(false);
  });
});
