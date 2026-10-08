import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveServerFiles } from "./editor-state";
import type { DesignFile } from "./types";

function makeFile(id: string): DesignFile {
  return {
    id,
    filename: `${id}.html`,
    fileType: "html",
    content: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("resolveServerFiles", () => {
  it("returns the same empty array across renders while the design is unresolved", () => {
    expect(resolveServerFiles(null)).toBe(resolveServerFiles(null));
    expect(resolveServerFiles(undefined)).toBe(resolveServerFiles(null));
    expect(resolveServerFiles({})).toBe(resolveServerFiles(null));
    expect(resolveServerFiles(null)).toEqual([]);
  });

  it("passes a resolved design's files through by identity", () => {
    const files = [makeFile("a"), makeFile("b")];
    expect(resolveServerFiles({ files })).toBe(files);
  });

  it("keeps derived file ids stable so effect deps do not churn", () => {
    const first = resolveServerFiles(null);
    const second = resolveServerFiles(null);
    expect(first.length).toBe(0);
    expect(first === second).toBe(true);
  });
});

describe("DesignEditor serverFiles call site", () => {
  const editorSrc = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../DesignEditor.tsx",
    ),
    "utf8",
  );

  it("reads server files through the stable resolver, not a fresh array literal", () => {
    expect(editorSrc).toContain(
      "const serverFiles = resolveServerFiles(design);",
    );
    expect(editorSrc).not.toContain("design?.files ?? []");
  });
});
