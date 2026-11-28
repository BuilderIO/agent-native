import type { ContextPreview } from "@agent-native/core/shared/context-xray";
import type { ContentContextPathEntry } from "@shared/api";
import { describe, expect, it } from "vitest";

import { SCREEN_DOCUMENT_PREVIEW_CHARS } from "../../../shared/screen-document-preview";
import { buildAgentContextRows } from "./agent-context-line";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

type Section = ContextPreview["sections"][number];

function section(
  provenance: Section["provenance"],
  sourceRef: NonNullable<Section["sourceRef"]>,
  tokenCount = 40,
): Section {
  return {
    kind: "system",
    segmentId: `${provenance}:${sourceRef.path ?? ""}`,
    group: "system",
    label: sourceRef.path ?? provenance,
    provenance,
    governance: "inherited",
    tokenCount,
    tokenMethod: "estimate",
    sourceRef,
    contentHash: "hash",
    preview: "",
    timestamp: 0,
  };
}

const shortPage = { title: "Office hours are back", content: "We meet again." };

describe("buildAgentContextRows", () => {
  it("lists only the page when nothing else is sent", () => {
    expect(buildAgentContextRows(shortPage, undefined, { t })).toEqual([
      {
        key: "page",
        name: "Office hours are back",
        meta: "agentContext.pageAll",
        detail: "agentContext.pageAllDetail",
      },
    ]);
  });

  it("counts the words the snapshot carries when the page is cut off", () => {
    const content = "word ".repeat(SCREEN_DOCUMENT_PREVIEW_CHARS);
    const [page] = buildAgentContextRows(
      { title: "Recurring tasks are here", content },
      undefined,
      { t },
    );
    expect(page.meta).toBe("agentContext.pagePart");
    expect(page.detail).toBe(
      `agentContext.pagePartDetail ${JSON.stringify({
        shown: SCREEN_DOCUMENT_PREVIEW_CHARS / 5,
        total: SCREEN_DOCUMENT_PREVIEW_CHARS,
      })}`,
    );
  });

  it("counts a cut-off code block the way the whole page's count does", () => {
    const content = [
      "Intro.",
      "```",
      "code ".repeat(SCREEN_DOCUMENT_PREVIEW_CHARS),
      "```",
    ].join("\n");
    const [page] = buildAgentContextRows(
      { title: "Snippets", content },
      undefined,
      { t },
    );
    expect(page.detail).toBe(
      `agentContext.pagePartDetail ${JSON.stringify({ shown: 1, total: 1 })}`,
    );
  });

  it("treats a page at the cut-off as whole", () => {
    const content = `  ${"x".repeat(SCREEN_DOCUMENT_PREVIEW_CHARS)}  `;
    const [page] = buildAgentContextRows({ title: "", content }, undefined, {
      t,
    });
    expect(page.name).toBe("agentContext.untitled");
    expect(page.meta).toBe("agentContext.pageAll");
  });

  it("names the pages above from the nearest one up", () => {
    const rows = buildAgentContextRows(
      {
        ...shortPage,
        contextPath: [
          { id: "blog", kind: "page", title: "Blog", description: "" },
          { id: "year", kind: "database", title: "2026", description: "" },
        ],
      },
      undefined,
      { t },
    );
    expect(rows[1]).toEqual({
      key: "pages-above",
      name: "2026 · Blog",
      meta: `agentContext.pagesAbove ${JSON.stringify({ count: 2 })}`,
      detail: `agentContext.pagesAboveDetail ${JSON.stringify({ count: 2 })}`,
    });
  });

  it("leaves out the space's own list unless it has a Description", () => {
    const blog = {
      id: "blog",
      kind: "page",
      title: "Blog",
      description: "",
    } as const;
    const space = {
      id: "files",
      kind: "database",
      title: "Personal",
      description: "",
    } as const;
    const rowsFor = (contextPath: ContentContextPathEntry[]) =>
      buildAgentContextRows(
        { ...shortPage, contextPath, spaceDatabaseId: "files" },
        undefined,
        { t },
      ).map((row) => row.name);
    expect(rowsFor([space])).toEqual(["Office hours are back"]);
    expect(rowsFor([blog, space])).toEqual(["Office hours are back", "Blog"]);
    expect(rowsFor([blog, { ...space, description: "Team notes." }])).toEqual([
      "Office hours are back",
      "Blog · Personal",
    ]);
  });

  it("adds the instructions and memory that are sent, in prompt order", () => {
    const preview = {
      sections: [
        section("framework-core", { scope: "framework" }),
        section("template", { scope: "template", path: "AGENTS.md" }),
        section("organization", { scope: "organization", path: "AGENTS.md" }),
        section("personal", { scope: "personal", path: "AGENTS.md" }),
        section("personal", {
          scope: "personal",
          path: "memory/INSTRUCTIONS.md",
        }),
        section("memory", { scope: "personal", path: "memory/MEMORY.md" }),
      ],
    };
    const rows = buildAgentContextRows(shortPage, preview, {
      t,
      workspaceName: "Pinecone Planner",
    });
    expect(rows.map((row) => [row.key, row.name])).toEqual([
      ["page", "Office hours are back"],
      ["workspace", "Pinecone Planner"],
      ["instructions", "agentContext.instructions"],
      ["memory", "agentContext.memory"],
    ]);
  });

  it("leaves out empty files and memory, reference files and shared learnings", () => {
    const preview = {
      sections: [
        section(
          "organization",
          { scope: "organization", path: "AGENTS.md" },
          0,
        ),
        section("organization", { scope: "shared", path: "LEARNINGS.md" }),
        section("sql-workspace", { scope: "workspace" }),
        section("enterprise-workspace-core", {
          scope: "workspace",
          path: "brand.md",
        }),
        section("memory", { scope: "personal", path: "memory/MEMORY.md" }, 0),
        {
          ...section("memory", { scope: "personal", path: "memory/MEMORY.md" }),
          preview: "# Memory Index",
        },
      ],
    };
    expect(
      buildAgentContextRows(shortPage, preview, { t }).map((row) => row.key),
    ).toEqual(["page"]);
  });

  it("falls back to a generic workspace name", () => {
    const preview = {
      sections: [
        section("sql-workspace", {
          scope: "workspace-instruction",
          path: "instructions/tone.md",
        }),
      ],
    };
    const rows = buildAgentContextRows(shortPage, preview, {
      t,
      workspaceName: "  ",
    });
    expect(rows[1]).toMatchObject({
      key: "workspace",
      name: "agentContext.workspace",
    });
  });
});
