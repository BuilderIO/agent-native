import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import {
  fileTreeMdx,
  fileTreeSchema,
  type FileTreeData,
} from "./file-tree.config.js";

/**
 * Minimal `BlockAttrReader` over a plain attribute bag, mirroring the runtime
 * `createAttrReader` value-domain narrowing (string-vs-number-vs-array-vs-object).
 * Lets the test assert the `toAttrs` → `fromAttrs` round-trip without spinning up
 * the full MDX serialize/parse pipeline.
 */
function reader(attrs: Record<string, unknown>): BlockAttrReader {
  const read = (name: string) => attrs[name];
  return {
    raw: read,
    string: (name) =>
      typeof read(name) === "string" ? (read(name) as string) : undefined,
    number: (name) =>
      typeof read(name) === "number" ? (read(name) as number) : undefined,
    bool: (name) =>
      typeof read(name) === "boolean" ? (read(name) as boolean) : undefined,
    array: <T = unknown>(name: string) =>
      Array.isArray(read(name)) ? (read(name) as T[]) : undefined,
    object: <T = unknown>(name: string) => {
      const value = read(name);
      return value && typeof value === "object" ? (value as T) : undefined;
    },
  };
}

/** Re-decode data from the attribute bag `toAttrs` produced. */
function roundTrip(data: FileTreeData): FileTreeData {
  const attrs = fileTreeMdx.toAttrs(data) as Record<string, unknown>;
  return fileTreeMdx.fromAttrs(reader(attrs), "");
}

const sample: FileTreeData = {
  title: "Files touched",
  entries: [
    {
      path: "src/index.ts",
      change: "modified",
      note: "Wire the new route here.",
      snippet: "registerRoute(gitRoute)",
      language: "ts",
    },
    { path: "src/routes/git.ts", change: "added" },
    { path: "src/routes/legacy.ts", change: "removed" },
    { path: "README.md", change: "renamed" },
  ],
};

describe("file-tree block config", () => {
  it("parses a valid file tree with mixed changes", () => {
    expect(fileTreeSchema.parse(sample)).toEqual(sample);
  });

  it("parses a file tree without a title", () => {
    const data = {
      entries: [{ path: "src/a.ts" }, { path: "src/b.ts", change: "added" }],
    };
    expect(fileTreeSchema.parse(data)).toEqual(data);
  });

  it("parses an entry with no change kind", () => {
    expect(
      fileTreeSchema.parse({ entries: [{ path: "src/plain.ts" }] }),
    ).toMatchObject({ entries: [{ path: "src/plain.ts" }] });
  });

  it("rejects a file tree with no entries", () => {
    expect(() => fileTreeSchema.parse({ entries: [] })).toThrow();
  });

  it("rejects an entry missing a path", () => {
    expect(() =>
      fileTreeSchema.parse({ entries: [{ change: "added" }] }),
    ).toThrow();
  });

  it("rejects an empty path", () => {
    expect(() => fileTreeSchema.parse({ entries: [{ path: "" }] })).toThrow();
  });

  it("rejects an unknown change kind", () => {
    expect(() =>
      fileTreeSchema.parse({
        entries: [{ path: "src/a.ts", change: "moved" }],
      }),
    ).toThrow();
  });

  it("accepts every supported change kind", () => {
    for (const change of ["added", "modified", "removed", "renamed"] as const) {
      expect(
        fileTreeSchema.parse({ entries: [{ path: "src/a.ts", change }] }),
      ).toMatchObject({ entries: [{ change }] });
    }
  });

  it("uses the stable FileTree MDX tag", () => {
    expect(fileTreeMdx.tag).toBe("FileTree");
  });

  it("round-trips title + entries losslessly through toAttrs/fromAttrs", () => {
    expect(roundTrip(sample)).toEqual(sample);
  });

  it("round-trips losslessly when the title is absent", () => {
    const data: FileTreeData = {
      entries: [
        { path: "src/index.ts", change: "modified" },
        { path: "src/routes/git.ts", change: "added" },
      ],
    };
    // No `title` attribute is emitted, so the decode yields `title: undefined`.
    expect(roundTrip(data)).toEqual({
      title: undefined,
      entries: data.entries,
    });
  });

  it("decodes a missing entries attribute to an empty array", () => {
    expect(fileTreeMdx.fromAttrs(reader({}), "")).toEqual({
      title: undefined,
      entries: [],
    });
  });
});
