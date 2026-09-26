// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { contentBlockRegistry } from "@/blocks/contentBlockRegistry";

import {
  buildRegistrySlashItems,
  contentRegistryBlockIsAuthorable,
  seedRegistryBlockRaw,
} from "./registrySlashItems";

const ADVANCED_CODE_TYPES = ["code", "code-tabs"];
const LAYOUT_TYPES = ["custom-html", "tabs"];
const VISUAL_TYPES = ["diagram", "wireframe", "mermaid"];
const DEVELOPER_DOC_TYPES = [
  "api-endpoint",
  "openapi-spec",
  "data-model",
  "diff",
  "file-tree",
  "json-explorer",
  "annotated-code",
];
const BUILDER_TYPES = [
  "builder-text",
  "builder-code-block",
  "builder-code-snippets-v2",
  "builder-tabbed-content",
  "builder-symbol",
  "builder-raw-block",
];
const ALWAYS_HIDDEN_TYPES = [
  "checklist",
  "table-block",
  "columns",
  "question-form",
  "visual-questions",
  "inline-database",
  "callout",
  "source-component",
  ...BUILDER_TYPES,
];
const ALL_POLICY_TYPES = [
  ...ADVANCED_CODE_TYPES,
  ...LAYOUT_TYPES,
  ...VISUAL_TYPES,
  ...DEVELOPER_DOC_TYPES,
];
const ALL_ENABLED_POLICY = {
  advancedCode: true,
  layouts: true,
  visuals: true,
  developerDocs: true,
};

function offeredTypes(options: Parameters<typeof buildRegistrySlashItems>[1]) {
  return buildRegistrySlashItems(contentBlockRegistry, options).map((item) =>
    item.searchText?.split(" ").pop(),
  );
}

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
  it("classifies every registered block and defaults the registry menu closed", () => {
    const registeredTypes = contentBlockRegistry
      .list("block")
      .map((s) => s.type);
    expect([...ALWAYS_HIDDEN_TYPES, ...ALL_POLICY_TYPES].sort()).toEqual(
      [...registeredTypes].sort(),
    );
    expect(offeredTypes({})).toEqual([]);
    for (const type of ALWAYS_HIDDEN_TYPES) {
      expect(contentRegistryBlockIsAuthorable(type, ALL_ENABLED_POLICY)).toBe(
        false,
      );
    }
  });

  it.each([
    ["advanced code", { advancedCode: true }, ADVANCED_CODE_TYPES],
    ["layouts", { layouts: true }, LAYOUT_TYPES],
    ["visuals", { visuals: true }, VISUAL_TYPES],
    ["developer docs", { developerDocs: true }, DEVELOPER_DOC_TYPES],
  ])("offers only the %s policy group", (_name, policy, expected) => {
    expect(offeredTypes({ policy })).toEqual(expected);
  });

  it("keeps Builder formats registered for existing content but out of insertion", () => {
    const offered = offeredTypes({ policy: ALL_ENABLED_POLICY });
    for (const type of BUILDER_TYPES) {
      expect(contentBlockRegistry.get(type)).toBeDefined();
      expect(offered).not.toContain(type);
    }
  });

  it("keeps API and schema aliases searchable when developer docs are enabled", () => {
    const items = buildRegistrySlashItems(contentBlockRegistry, {
      policy: { developerDocs: true },
    });
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
      policy: ALL_ENABLED_POLICY,
    });
    expect(gated).toEqual([]);
  });

  it("rides the block type in search text for keyword matching", () => {
    const items = buildRegistrySlashItems(contentBlockRegistry, {
      policy: { developerDocs: true },
    });
    const fileTree = items.find((i) => i.title === "File tree");
    expect(fileTree).toBeDefined();
    expect(fileTree?.description).toBe("File/change tree");
    expect(fileTree?.searchText).toContain("file-tree");
  });

  it("inserts a registryBlock node with a fresh id and seeded __raw", () => {
    const items = buildRegistrySlashItems(contentBlockRegistry, {
      policy: { advancedCode: true },
    });
    const code = items.find((i) => i.title === "Code");
    expect(code).toBeDefined();

    const { editor, getInserted } = fakeEditor();
    code!.action(editor as never);

    const inserted = getInserted();
    expect(inserted?.type).toBe("registryBlock");
    expect(inserted?.attrs?.blockType).toBe("code");
    expect(typeof inserted?.attrs?.blockId).toBe("string");
    expect(inserted?.attrs?.blockId.length).toBeGreaterThan(0);
    expect(inserted?.attrs?.__raw).toContain("<Code");
    expect(inserted?.attrs?.__raw).toContain(inserted?.attrs?.blockId);
  });

  it("mints a unique id on each insert", () => {
    const items = buildRegistrySlashItems(contentBlockRegistry, {
      policy: { advancedCode: true },
    });
    const code = items.find((i) => i.title === "Code")!;
    const a = fakeEditor();
    const b = fakeEditor();
    code.action(a.editor as never);
    code.action(b.editor as never);
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

  it("seeds real MDX for the code block (not the stuck-loading empty string)", () => {
    const spec = contentBlockRegistry.get("code")!;
    const raw = seedRegistryBlockRaw(spec, "code-1");
    expect(raw).not.toBe("");
    expect(raw).toContain("<Code");
    expect(raw).toContain('id="code-1"');
  });

  it("seeds real MDX for the code-tabs block (not the stuck-loading empty string)", () => {
    const spec = contentBlockRegistry.get("code-tabs")!;
    const raw = seedRegistryBlockRaw(spec, "tabs-1");
    expect(raw).not.toBe("");
    expect(raw).toContain("<CodeTabs");
    expect(raw).toContain('id="tabs-1"');
  });
});
