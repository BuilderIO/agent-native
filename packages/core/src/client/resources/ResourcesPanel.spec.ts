import { afterEach, describe, expect, it, vi } from "vitest";

import {
  filterResourceTree,
  hasAvailableMcpIntegrations,
  normalizeResourceFileName,
  resolveInitialResourceScope,
  resolveResourceCreateMenuMode,
  shouldRenderResourceSectionCreateMenu,
} from "./ResourcesPanel.js";
import type { TreeNode } from "./use-resources.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveInitialResourceScope", () => {
  it("preserves an explicitly requested organization scope for read-only members", () => {
    expect(resolveInitialResourceScope("shared", false)).toBe("shared");
  });

  it("keeps the existing fallback when the panel has no requested scope", () => {
    expect(resolveInitialResourceScope(undefined, false)).toBe("personal");
    expect(resolveInitialResourceScope(undefined, true)).toBe("shared");
  });
});

describe("hasAvailableMcpIntegrations", () => {
  it("keeps custom MCP setup available when ejected presets are disabled", () => {
    vi.stubGlobal("__AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__", {
      enabled: true,
      defaults: { enabled: false },
      custom: true,
    });

    expect(hasAvailableMcpIntegrations([])).toBe(true);
    expect(
      resolveResourceCreateMenuMode(
        "shared",
        false,
        undefined,
        hasAvailableMcpIntegrations([]),
      ),
    ).toBe("personal-mcp");
  });

  it("hides MCP setup when neither presets nor custom servers are available", () => {
    vi.stubGlobal("__AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__", {
      enabled: true,
      defaults: { enabled: false },
      custom: false,
    });

    expect(hasAvailableMcpIntegrations([])).toBe(false);
  });
});

describe("resolveResourceCreateMenuMode", () => {
  it("keeps only personal MCP connections available to members in shared resource views", () => {
    expect(
      resolveResourceCreateMenuMode("shared", false, undefined, true),
    ).toBe("personal-mcp");
    expect(resolveResourceCreateMenuMode("shared", false, "files", true)).toBe(
      "personal-mcp",
    );
  });

  it("hides the exception in filtered resource views and without integrations", () => {
    expect(resolveResourceCreateMenuMode("shared", false, "agents", true)).toBe(
      "hidden",
    );
    expect(
      resolveResourceCreateMenuMode("shared", false, undefined, false),
    ).toBe("hidden");
  });

  it("keeps full creation available in personal scope and to organization admins", () => {
    expect(
      resolveResourceCreateMenuMode("personal", false, undefined, true),
    ).toBe("full");
    expect(resolveResourceCreateMenuMode("shared", true, undefined, true)).toBe(
      "full",
    );
  });
});

describe("shouldRenderResourceSectionCreateMenu", () => {
  it("does not put a personal MCP action under the read-only Organization heading", () => {
    expect(
      shouldRenderResourceSectionCreateMenu("personal-mcp", undefined),
    ).toBe(false);
    expect(shouldRenderResourceSectionCreateMenu("personal-mcp", "files")).toBe(
      false,
    );
  });

  it("keeps collection-specific section actions for editable agent and skill trees", () => {
    expect(shouldRenderResourceSectionCreateMenu("full", "agents")).toBe(true);
    expect(shouldRenderResourceSectionCreateMenu("full", "skills")).toBe(true);
    expect(shouldRenderResourceSectionCreateMenu("full", undefined)).toBe(
      false,
    );
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
