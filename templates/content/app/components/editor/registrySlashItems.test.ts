// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { contentBlockRegistry } from "@/blocks/contentBlockRegistry";

import {
  buildRegistrySlashItems,
  seedRegistryBlockRaw,
} from "./registrySlashItems";

// The block types Content offers in its slash menu, in registry order. Excludes
// the registered-but-not-offered blocks: `columns` (needs nested editing),
// `question-form` / `visual-questions` (agent-intake forms, a plan workflow),
// and provider/runtime markers such as `source-component`.
const AUTHORABLE_LIBRARY_BLOCK_TYPES = [
  "checklist",
  "table-block",
  "code",
  "code-tabs",
  "custom-html",
  "tabs",
  "callout",
  "diagram",
  "wireframe",
  "mermaid",
  "api-endpoint",
  "openapi-spec",
  "data-model",
  "diff",
  "file-tree",
  "json-explorer",
  "annotated-code",
  "builder-text",
  "builder-code-block",
  "builder-code-snippets-v2",
  "builder-tabbed-content",
  "builder-symbol",
  "builder-raw-block",
] as const;

/** Blocks registered in Content but intentionally hidden from the slash menu. */
const HIDDEN_FROM_SLASH_MENU = ["columns", "question-form", "visual-questions"];
const PHASED_BLOCKS_HIDDEN_FROM_SLASH_MENU = [
  "inline-database",
  "source-component",
];

/**
 * T7 — registry-derived slash items + Notion gating for content's slash menu.
 *
 * Each registry `BlockSpec` with block placement becomes one slash item that
 * inserts a `registryBlock` atom seeded with a fresh id and the spec's `empty()`
 * data (encoded inline on the node's `__raw`, matching how a saved block
 * hydrates). When the open document is linked to a Notion page, only specs that
 * round-trip to NFM (`spec.notionCompatible`) are offered.
 */

/** A fake editor that records the last `insertContent` payload. */
function fakeEditor() {
  let inserted: any = null;
  const chain = {
    focus: () => ({
      insertContent: (content: unknown) => {
        inserted = content;
        return { run: () => true };
      },
    }),
  };
  return {
    editor: { chain: () => chain },
    getInserted: () => inserted,
  };
}

describe("buildRegistrySlashItems", () => {
  it("derives one item per block-placed registry spec", () => {
    const items = buildRegistrySlashItems(contentBlockRegistry);
    const authorableBlockSpecs = contentBlockRegistry
      .list("block")
      .filter(
        (spec) =>
          ![
            ...HIDDEN_FROM_SLASH_MENU,
            ...PHASED_BLOCKS_HIDDEN_FROM_SLASH_MENU,
          ].includes(spec.type),
      );
    expect(items.length).toBe(authorableBlockSpecs.length);
    // Includes the shared dev-doc / structured library labels.
    const titles = items.map((i) => i.title);
    expect(titles).toContain("Checklist");
    expect(titles).toContain("API endpoint");
    expect(titles).toContain("Data model");
    const offeredTypes = items.map((i) => i.searchText?.split(" ").pop());
    expect(offeredTypes).toEqual([...AUTHORABLE_LIBRARY_BLOCK_TYPES]);
    expect(contentBlockRegistry.get("columns")).toBeDefined();
    expect(offeredTypes).not.toContain("columns");
    expect(contentBlockRegistry.get("inline-database")).toBeDefined();
    expect(offeredTypes).not.toContain("inline-database");
    expect(contentBlockRegistry.get("source-component")).toBeDefined();
    expect(offeredTypes).not.toContain("source-component");
  });

  it("keeps API and schema aliases searchable in normal mode", () => {
    const items = buildRegistrySlashItems(contentBlockRegistry);
    const searchTexts = items.map((item) => item.searchText?.toLowerCase());
    expect(
      searchTexts.some((searchText) => searchText?.includes("swagger")),
    ).toBe(true);
    expect(
      searchTexts.some((searchText) =>
        searchText?.includes("api specification"),
      ),
    ).toBe(true);
    expect(
      searchTexts.some((searchText) => searchText?.includes("schema modeling")),
    ).toBe(true);
  });

  it("filters to Notion-compatible specs when notionCompatibleOnly is set", () => {
    const gated = buildRegistrySlashItems(contentBlockRegistry, {
      notionCompatibleOnly: true,
    });
    const titles = gated.map((i) => i.title);
    // checklist + table-block carry notionCompatible: true → kept.
    expect(titles).toContain("Checklist");
    expect(titles).toContain("Table");
    // Dev-doc and Builder docs blocks have no NFM analog → dropped from the
    // gated set.
    expect(titles).not.toContain("API endpoint");
    expect(titles).not.toContain("Data model");
    expect(titles).not.toContain("Diff");
    expect(titles).not.toContain("Builder text");
    expect(titles).not.toContain("Builder raw block");
    // Every gated spec is genuinely notion-compatible.
    const compatible = contentBlockRegistry.notionCompatibleTypes();
    expect(gated.length).toBe(compatible.size);
  });

  // The registry blocks added for dev-docs and Builder docs have NO Notion/NFM analog, so a
  // Notion-connected document MUST NOT offer any of them in the slash menu (they
  // would silently drop on push). This asserts the gating by block `type` so it
  // can't rot if a label is renamed.
  it("gates out every non-NFM-compatible dev-doc block when Notion-connected", () => {
    const NON_NFM_BLOCK_TYPES = [
      "mermaid",
      "api-endpoint",
      "data-model",
      "diff",
      "file-tree",
      "json-explorer",
      "annotated-code",
      "openapi-spec",
      "builder-text",
      "builder-code-block",
      "builder-code-snippets-v2",
      "builder-tabbed-content",
      "builder-symbol",
      "builder-raw-block",
    ];

    // Sanity: each block is registered, block-placed, and NOT flagged compatible.
    const compatible = contentBlockRegistry.notionCompatibleTypes();
    const blockTypes = new Set(
      contentBlockRegistry.list("block").map((s) => s.type),
    );
    for (const type of NON_NFM_BLOCK_TYPES) {
      expect(blockTypes.has(type)).toBe(true);
      expect(compatible.has(type)).toBe(false);
    }

    // None of these surface in the gated slash menu. The menu rides the raw
    // `type` keyword in each item's hidden search text, so match on that.
    const gated = buildRegistrySlashItems(contentBlockRegistry, {
      notionCompatibleOnly: true,
    });
    const gatedTypeKeywords = gated.map((i) => i.searchText ?? "");
    for (const type of NON_NFM_BLOCK_TYPES) {
      expect(
        gatedTypeKeywords.some((searchText) => searchText.endsWith(` ${type}`)),
        `expected "${type}" to be hidden from the Notion-gated slash menu`,
      ).toBe(false);
    }

    // The ONLY blocks the gated menu keeps are exactly the registry allowlist.
    const gatedTypes = new Set(
      gated.map((i) => i.searchText?.split(" ").pop()),
    );
    expect(gatedTypes).toEqual(compatible);
    // Spelled out: just the two NFM-analog atoms today.
    expect([...compatible].sort()).toEqual(["checklist", "table-block"]);
  });

  it("offers all blocks when not Notion-gated", () => {
    const all = buildRegistrySlashItems(contentBlockRegistry);
    const gated = buildRegistrySlashItems(contentBlockRegistry, {
      notionCompatibleOnly: true,
    });
    expect(all.length).toBeGreaterThan(gated.length);
  });

  it("rides the block type in search text for keyword matching", () => {
    const items = buildRegistrySlashItems(contentBlockRegistry);
    const fileTree = items.find((i) => i.title === "File tree");
    expect(fileTree).toBeDefined();
    expect(fileTree?.description).toBe("File/change tree");
    expect(fileTree?.searchText).toContain("file-tree");
  });

  it("inserts a registryBlock node with a fresh id and seeded __raw", () => {
    const items = buildRegistrySlashItems(contentBlockRegistry);
    const checklist = items.find((i) => i.title === "Checklist");
    expect(checklist).toBeDefined();

    const { editor, getInserted } = fakeEditor();
    checklist!.action(editor as never);

    const inserted = getInserted();
    expect(inserted?.type).toBe("registryBlock");
    expect(inserted?.attrs?.blockType).toBe("checklist");
    expect(typeof inserted?.attrs?.blockId).toBe("string");
    expect(inserted?.attrs?.blockId.length).toBeGreaterThan(0);
    // Seeded __raw is the inline MDX for the spec's empty() data, so the
    // side-map's lazy getBlock hydrates it exactly like a saved block.
    expect(inserted?.attrs?.__raw).toContain("<Checklist");
    expect(inserted?.attrs?.__raw).toContain(inserted?.attrs?.blockId);
  });

  it("mints a unique id on each insert", () => {
    const items = buildRegistrySlashItems(contentBlockRegistry);
    const checklist = items.find((i) => i.title === "Checklist")!;
    const a = fakeEditor();
    const b = fakeEditor();
    checklist.action(a.editor as never);
    checklist.action(b.editor as never);
    expect(a.getInserted()?.attrs?.blockId).not.toBe(
      b.getInserted()?.attrs?.blockId,
    );
  });
});

describe("seedRegistryBlockRaw", () => {
  it("serializes a spec's empty() seed to inline MDX with the given id", () => {
    const spec = contentBlockRegistry.get("checklist")!;
    const raw = seedRegistryBlockRaw(spec, "chk-1");
    expect(raw).toContain("<Checklist");
    expect(raw).toContain('id="chk-1"');
  });

  it("returns empty string for a spec without an empty() factory", () => {
    const spec = contentBlockRegistry.get("checklist")!;
    const noEmpty = { ...spec, empty: undefined };
    expect(seedRegistryBlockRaw(noEmpty as never, "x")).toBe("");
  });
});
