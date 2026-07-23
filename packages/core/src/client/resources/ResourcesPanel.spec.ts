import { describe, expect, it } from "vitest";

import {
  filterResourceTree,
  normalizeResourceFileName,
  resolveInitialResourceScope,
} from "./ResourcesPanel.js";
import type { TreeNode } from "./use-resources.js";

describe("resolveInitialResourceScope", () => {
  it("preserves an explicitly requested organization scope for read-only members", () => {
    expect(resolveInitialResourceScope("shared", false)).toBe("shared");
  });

  it("keeps the existing fallback when the panel has no requested scope", () => {
    expect(resolveInitialResourceScope(undefined, false)).toBe("personal");
    expect(resolveInitialResourceScope(undefined, true)).toBe("shared");
  });
});

describe("normalizeResourceFileName", () => {
  it("adds a Markdown extension when the file name has no extension", () => {
    expect(normalizeResourceFileName("notes")).toBe("notes.md");
    expect(normalizeResourceFileName("research/ideas")).toBe(
      "research/ideas.md",
    );
  });

  it("preserves nested names that already include an extension", () => {
    expect(normalizeResourceFileName("foo/bar.whatever")).toBe(
      "foo/bar.whatever",
    );
    expect(normalizeResourceFileName("config/.env")).toBe("config/.env");
  });

  it("trims input and rejects blank or folder-only names", () => {
    expect(normalizeResourceFileName("  notes.txt  ")).toBe("notes.txt");
    expect(normalizeResourceFileName("   ")).toBe("");
    expect(normalizeResourceFileName("notes/")).toBe("");
  });
});

describe("filterResourceTree", () => {
  const resource = (path: string) => ({
    id: path,
    path,
    owner: "owner",
    mimeType: "text/markdown",
    size: 10,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "user" as const,
    visibility: "workspace" as const,
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  });
  const file = (path: string, kind?: TreeNode["kind"]): TreeNode => ({
    name: path.split("/").pop() ?? path,
    path,
    type: "file",
    ...(kind ? { kind } : {}),
    resource: resource(path),
  });
  const folder = (path: string, children: TreeNode[]): TreeNode => ({
    name: path,
    path,
    type: "folder",
    children,
  });
  const tree: TreeNode[] = [
    file("notes.md"),
    file("AGENTS.md"),
    file("LEARNINGS.md"),
    folder("memory", [file("memory/MEMORY.md")]),
    folder("agents", [
      file("agents/designer.md", "agent"),
      file("agents/researcher.json", "remote-agent"),
    ]),
    folder("skills", [file("skills/review/SKILL.md", "skill")]),
    folder("remote-agents", [
      file("remote-agents/researcher.json", "remote-agent"),
    ]),
  ];

  it("keeps plain files out of special resource collections", () => {
    const result = filterResourceTree(tree, "files");
    expect(result.map((node) => node.path)).toEqual(["notes.md"]);
  });

  it("keeps custom agents separate from remote agent manifests", () => {
    expect(filterResourceTree(tree, "agents")).toEqual([
      expect.objectContaining({
        path: "agents",
        children: [expect.objectContaining({ path: "agents/designer.md" })],
      }),
    ]);
    expect(filterResourceTree(tree, "remote-agents")).toEqual([
      expect.objectContaining({
        path: "agents",
        children: [expect.objectContaining({ path: "agents/researcher.json" })],
      }),
      expect.objectContaining({
        path: "remote-agents",
        children: [
          expect.objectContaining({ path: "remote-agents/researcher.json" }),
        ],
      }),
    ]);
  });

  it("selects memory, skills, instructions, and learnings by their meaning", () => {
    expect(filterResourceTree(tree, "memory")[0]?.path).toBe("memory");
    expect(filterResourceTree(tree, "skills")[0]?.path).toBe("skills");
    expect(filterResourceTree(tree, "instructions")[0]?.path).toBe("AGENTS.md");
    expect(filterResourceTree(tree, "learnings")[0]?.path).toBe("LEARNINGS.md");
  });
});
