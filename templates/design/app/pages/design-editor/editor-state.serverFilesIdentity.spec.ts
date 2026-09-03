/**
 * editor-state.serverFilesIdentity.spec.ts
 *
 * Intermittent "Maximum update depth exceeded" on a cold editor load.
 *
 * DesignEditor's render body read `design?.files ?? []`. `design` is null
 * until the `get-design` query resolves, so that literal minted a NEW array
 * on every render inside that window. It feeds the `files` memo →
 * `proposalFileIds` memo → the pending-node-rewrite effect, whose empty-files
 * branch calls `setPendingNodeRewriteProposals([])` unconditionally. A fresh
 * `[]` never equals the previous one, so the effect's own commit re-rendered
 * the component, re-minted `serverFiles`, invalidated its deps and re-fired
 * itself — nested passive updates until the query landed. Warm React Query
 * cache → `design.files` is stable from render one and the window never
 * exists, which is why it only sometimes fired.
 *
 * resolveServerFiles returns a shared module-level empty array, so the
 * no-files render is identity-stable and the chain settles after one pass.
 */

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
    // The load-bearing assertion: `?? []` fails this (two distinct arrays),
    // which is what drove the passive-effect loop.
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
    // Mirrors the `files` → `proposalFileIds` chain: with a stable source the
    // memos never invalidate, so the effect that clears pending proposals
    // runs once instead of re-triggering itself.
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
