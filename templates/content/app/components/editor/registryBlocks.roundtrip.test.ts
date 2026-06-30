// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import {
  parseRegistryBlockData,
  serializeRegistryBlockToMdx,
} from "@shared/nfm-registry";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { contentBlockRegistry } from "@/blocks/contentBlockRegistry";

import {
  LockedSourceComponentBlocks,
  RegistryBlockNode,
} from "./extensions/registryBlocks";
import { seedRegistryBlockRaw } from "./registrySlashItems";

/**
 * THE MAKE-OR-BREAK round-trip guard for the editor-unification work.
 *
 * Content stores a whole document as a SINGLE NFM markdown string. The 8 new
 * registry blocks live INLINE in that string as MDX-style components (no DB
 * sidecar). So for every block type a user can insert, two things must hold or
 * the feature silently loses data:
 *
 *   1. IDEMPOTENCY — opening a saved document and re-saving with no edit must be
 *      byte-stable: `nfm === docToNfm(nfmToDoc(nfm))`. If it isn't, every
 *      synced/Notion-pushed document drifts on open.
 *
 *   2. TYPED-DATA SURVIVAL — the inline `__raw` must micro-parse back to the
 *      block's typed `data` via the same `parseRegistryBlockData` the editor
 *      side-map uses to hydrate a saved block. If it doesn't, the block renders
 *      empty/placeholder after a reload even though the source survived.
 *
 * We drive each case off the block's REAL `empty()` seed serialized through
 * `seedRegistryBlockRaw` — the exact path a slash-menu insert takes — so the
 * fixtures can never drift from what the app actually writes.
 *
 * `sibling: true` wraps the block between two paragraphs to exercise the
 * surrounding-block boundary handling (the registry open/close scanner in
 * nfm.ts), which a lone top-level block would not.
 */

/** The dev-doc / OpenAPI blocks the unification added, by registry `type`. */
const DEV_DOC_BLOCK_TYPES = [
  "mermaid",
  "api-endpoint",
  "data-model",
  "diff",
  "file-tree",
  "json-explorer",
  "annotated-code",
  "openapi-spec",
] as const;

/** Build the inline NFM for a block type via the real slash-insert seed path. */
function seedNfm(type: string, blockId: string): string {
  const spec = contentBlockRegistry.get(type);
  if (!spec)
    throw new Error(`Block type not registered in browser registry: ${type}`);
  const raw = seedRegistryBlockRaw(spec, blockId);
  expect(raw, `${type}: empty() must serialize to inline MDX`).not.toBe("");
  return raw;
}

describe("registry blocks — NFM inline round-trip (the dev-doc blocks)", () => {
  it("registers all dev-doc block types with an empty() seed", () => {
    for (const type of DEV_DOC_BLOCK_TYPES) {
      const spec = contentBlockRegistry.get(type);
      expect(spec, `${type} must be registered`).toBeDefined();
      expect(spec?.empty, `${type} must have an empty() factory`).toBeTypeOf(
        "function",
      );
    }
  });

  for (const type of DEV_DOC_BLOCK_TYPES) {
    describe(type, () => {
      it("round-trips byte-exact as a lone top-level block (idempotency)", () => {
        const nfm = seedNfm(type, `${type}-rt1`);
        expect(docToNfm(nfmToDoc(nfm))).toBe(nfm);
      });

      it("round-trips byte-exact between sibling paragraphs (idempotency)", () => {
        const block = seedNfm(type, `${type}-rt2`);
        const nfm = `Above the ${type} block.\n${block}\nBelow the ${type} block.`;
        expect(docToNfm(nfmToDoc(nfm))).toBe(nfm);
      });

      it("parses into a registryBlock atom preserving __raw + blockId", () => {
        const nfm = seedNfm(type, `${type}-atom`);
        const doc = nfmToDoc(nfm);
        const block = doc.content.find((n) => n.type === "registryBlock");
        expect(
          block,
          `${type} must parse to a registryBlock node`,
        ).toBeDefined();
        expect(block?.attrs?.blockType).toBe(type);
        expect(block?.attrs?.blockId).toBe(`${type}-atom`);
        expect(typeof block?.attrs?.__raw).toBe("string");
        // The preserved __raw is exactly the inline source we seeded.
        expect(block?.attrs?.__raw).toBe(nfm);
      });

      it("micro-parses __raw back to the correct typed data (no data loss)", async () => {
        const blockId = `${type}-data`;
        const raw = seedNfm(type, blockId);
        const parsed = await parseRegistryBlockData(raw);
        expect(
          parsed,
          `${type}: parseRegistryBlockData must recover data`,
        ).not.toBeNull();
        expect(parsed?.type).toBe(type);
        expect(parsed?.base.id).toBe(blockId);

        // Re-serializing the recovered typed data must reproduce the same MDX
        // bytes — proves the round-trip is lossless, not just non-null.
        const reSerialized = seedRegistryBlockRaw(
          // Force the recovered data through the same serializer with the same id.
          {
            ...contentBlockRegistry.get(type)!,
            empty: () => parsed!.data,
          } as never,
          blockId,
        );
        expect(reSerialized).toBe(raw);
      });
    });
  }
});

describe("registry blocks — readable Columns source", () => {
  it("micro-parses human-editable Columns children into typed nested blocks", async () => {
    const raw = [
      '<Columns id="cols-readable" title="Before and after">',
      '<Column id="before" label="Before" contentId="before-text">',
      "",
      "### Before",
      "- Old behavior",
      "",
      "</Column>",
      '<Column id="after" label="After">',
      "",
      '<DataModel id="after-model" entities={[{"id":"plans","name":"plans","fields":[{"name":"id","type":"text","pk":true}]}]} />',
      "",
      "</Column>",
      "</Columns>",
    ].join("\n");

    const parsed = await parseRegistryBlockData(raw);
    expect(parsed?.type).toBe("columns");
    const data = parsed?.data as {
      columns?: Array<{
        id: string;
        label?: string;
        blocks: Array<{ id: string; type: string; data: unknown }>;
      }>;
    };
    expect(data.columns?.[0]?.label).toBe("Before");
    expect(data.columns?.[0]?.blocks[0]?.id).toBe("before-text");
    expect(data.columns?.[0]?.blocks[0]?.type).toBe("rich-text");
    expect(
      (data.columns?.[0]?.blocks[0]?.data as { markdown?: string }).markdown,
    ).toContain("Old behavior");
    expect(data.columns?.[1]?.blocks[0]?.type).toBe("data-model");
  });
});

describe("registry blocks — source component markers", () => {
  it("round-trips provider-native component markers through NFM", async () => {
    const raw = serializeRegistryBlockToMdx("source-component", {
      id: "source-component-builder-table-1",
      data: {
        provider: "builder",
        componentName: "Table",
        rawRef: "content/builder/.raw/blog-article/entry/table-abc.json",
        rawHash: "hash123",
        sourceLabel: "Builder body",
        previewStatus: "available",
        previewKind: "table",
        previewItems: ["3 rows", "4 columns"],
        preview: {
          status: "available",
          kind: "table",
          label: "Builder Table",
          summary: "A table preview.",
          fields: [
            { label: "rows", value: "3" },
            { label: "columns", value: "4" },
          ],
          table: {
            columns: [
              { id: "name", label: "Name" },
              { id: "status", label: "Status" },
            ],
            rows: [{ name: "Alpha", status: "Draft" }],
          },
        },
        title: "Builder Table",
        summary: "A preserved Builder table component.",
      },
    });

    const nfm = `Before\n${raw}\nAfter`;
    expect(docToNfm(nfmToDoc(nfm))).toBe(nfm);

    const doc = nfmToDoc(nfm);
    const block = doc.content.find((n) => n.type === "registryBlock");
    expect(block?.attrs?.blockType).toBe("source-component");
    expect(block?.attrs?.blockId).toBe("source-component-builder-table-1");

    const parsed = await parseRegistryBlockData(raw);
    expect(parsed?.type).toBe("source-component");
    expect(parsed?.data).toMatchObject({
      provider: "builder",
      componentName: "Table",
      rawRef: "content/builder/.raw/blog-article/entry/table-abc.json",
      rawHash: "hash123",
      previewStatus: "available",
      previewKind: "table",
      previewItems: ["3 rows", "4 columns"],
      preview: {
        status: "available",
        kind: "table",
        label: "Builder Table",
        fields: [
          { label: "rows", value: "3" },
          { label: "columns", value: "4" },
        ],
        table: {
          columns: [
            { id: "name", label: "Name" },
            { id: "status", label: "Status" },
          ],
          rows: [{ name: "Alpha", status: "Draft" }],
        },
      },
      title: "Builder Table",
    });
  });

  it("prevents deleting locked source component markers in the editor", () => {
    const raw = serializeRegistryBlockToMdx("source-component", {
      id: "source-component-builder-locked",
      data: {
        provider: "builder",
        componentName: "Table",
        rawRef: "content/builder/.raw/blog-article/entry/table-locked.json",
        rawHash: "hash123",
        previewStatus: "available",
        previewKind: "table",
        previewItems: ["1 row", "2 columns"],
      },
    });
    const editor = new Editor({
      extensions: [StarterKit, RegistryBlockNode, LockedSourceComponentBlocks],
      content: nfmToDoc(`Before\n${raw}\nAfter`),
    });

    try {
      let pos = -1;
      editor.state.doc.descendants((node, nodePos) => {
        if (node.type.name === "registryBlock") {
          pos = nodePos;
          return false;
        }
        return true;
      });
      expect(pos).toBeGreaterThan(0);
      editor.view.dispatch(
        editor.state.tr.setSelection(
          NodeSelection.create(editor.state.doc, pos),
        ),
      );

      expect(editor.commands.deleteSelection()).toBe(true);
      const sourceBlocks: string[] = [];
      editor.state.doc.descendants((node) => {
        if (
          node.type.name === "registryBlock" &&
          node.attrs.blockType === "source-component"
        ) {
          sourceBlocks.push(node.attrs.blockId);
        }
        return true;
      });
      expect(sourceBlocks).toEqual(["source-component-builder-locked"]);
      expect(docToNfm(editor.getJSON() as never)).toContain("<SourceComponent");
    } finally {
      editor.destroy();
    }
  });

  it("prevents duplicating locked source component markers in the editor", () => {
    const raw = serializeRegistryBlockToMdx("source-component", {
      id: "source-component-builder-duplicate",
      data: {
        provider: "builder",
        componentName: "Embed",
        rawRef: "content/builder/.raw/blog-article/entry/embed.json",
        rawHash: "hash123",
        previewStatus: "available",
        previewKind: "embed",
        previewUrl: "https://example.com/embed",
      },
    });
    const editor = new Editor({
      extensions: [StarterKit, RegistryBlockNode, LockedSourceComponentBlocks],
      content: nfmToDoc(`Before\n${raw}\nAfter`),
    });

    try {
      editor.commands.focus("end");
      editor.commands.insertContent({
        type: "registryBlock",
        attrs: {
          blockType: "source-component",
          blockId: "source-component-builder-duplicate",
          title: null,
          summary: null,
          sourceBlockId: null,
          __raw: raw,
        },
      });

      const sourceBlocks: string[] = [];
      editor.state.doc.descendants((node) => {
        if (
          node.type.name === "registryBlock" &&
          node.attrs.blockType === "source-component"
        ) {
          sourceBlocks.push(node.attrs.blockId);
        }
        return true;
      });
      expect(sourceBlocks).toEqual(["source-component-builder-duplicate"]);
    } finally {
      editor.destroy();
    }
  });

  it("prevents select-all deletion of locked source component markers", () => {
    const raw = serializeRegistryBlockToMdx("source-component", {
      id: "source-component-builder-select-all",
      data: {
        provider: "builder",
        componentName: "Image",
        rawRef: "content/builder/.raw/blog-article/entry/image.json",
        rawHash: "hash123",
        previewStatus: "available",
        previewKind: "component",
      },
    });
    const editor = new Editor({
      extensions: [StarterKit, RegistryBlockNode, LockedSourceComponentBlocks],
      content: nfmToDoc(`Before\n${raw}\nAfter`),
    });

    try {
      editor.commands.selectAll();
      expect(editor.commands.deleteSelection()).toBe(true);
      expect(docToNfm(editor.getJSON() as never)).toContain(
        "source-component-builder-select-all",
      );
    } finally {
      editor.destroy();
    }
  });

  it("prevents paste-replacing a range that contains locked source component markers", () => {
    const raw = serializeRegistryBlockToMdx("source-component", {
      id: "source-component-builder-paste-replace",
      data: {
        provider: "builder",
        componentName: "Image",
        rawRef: "content/builder/.raw/blog-article/entry/image.json",
        rawHash: "hash123",
        previewStatus: "available",
        previewKind: "component",
      },
    });
    const editor = new Editor({
      extensions: [StarterKit, RegistryBlockNode, LockedSourceComponentBlocks],
      content: nfmToDoc(`Before\n${raw}\nAfter`),
    });

    try {
      editor.commands.selectAll();
      editor.commands.insertContent("Replacement prose");
      const nfm = docToNfm(editor.getJSON() as never);
      expect(nfm).toContain("source-component-builder-paste-replace");
      expect(nfm).not.toBe("Replacement prose");
    } finally {
      editor.destroy();
    }
  });
});

/**
 * Block-type-specific data-fidelity assertions: confirm the *meaningful* fields
 * of each block's seed actually survive the parse (a generic re-serialize check
 * could pass even if a field were silently dropped on both sides, so we also
 * pin concrete values here).
 */
describe("registry blocks — typed-field fidelity per block type", () => {
  async function dataOf(type: string): Promise<any> {
    const raw = seedNfm(type, `${type}-fid`);
    const parsed = await parseRegistryBlockData(raw);
    return parsed?.data;
  }

  it("mermaid preserves its diagram source", async () => {
    const data = await dataOf("mermaid");
    expect(typeof data.source).toBe("string");
    expect(data.source).toContain("flowchart");
  });

  it("api-endpoint preserves method + path", async () => {
    const data = await dataOf("api-endpoint");
    expect(data.method).toBe("GET");
    expect(data.path).toBe("/api/resource");
  });

  it("data-model preserves entities with typed fields", async () => {
    const data = await dataOf("data-model");
    expect(Array.isArray(data.entities)).toBe(true);
    expect(data.entities[0].name).toBe("User");
    const idField = data.entities[0].fields.find((f: any) => f.name === "id");
    expect(idField.pk).toBe(true);
  });

  it("diff preserves before/after + language", async () => {
    const data = await dataOf("diff");
    expect(data.before).toContain("function add");
    expect(data.after).toContain("number");
    expect(data.language).toBe("ts");
  });

  it("file-tree preserves entries with change badges", async () => {
    const data = await dataOf("file-tree");
    expect(Array.isArray(data.entries)).toBe(true);
    const modified = data.entries.find((e: any) => e.change === "modified");
    expect(modified.path).toBe("src/index.ts");
  });

  it("json-explorer preserves its JSON payload string", async () => {
    const data = await dataOf("json-explorer");
    expect(typeof data.json).toBe("string");
    expect(JSON.parse(data.json).tags).toEqual(["alpha", "beta"]);

    const raw = serializeRegistryBlockToMdx("json-explorer", {
      id: "json-depth",
      data: { json: data.json, collapsedDepth: 3 },
    });
    const parsed = await parseRegistryBlockData(raw);
    expect((parsed?.data as { collapsedDepth?: number }).collapsedDepth).toBe(
      3,
    );
  });

  it("annotated-code preserves code + anchored annotations", async () => {
    const data = await dataOf("annotated-code");
    expect(data.language).toBe("ts");
    expect(data.code).toContain("resolveAuth");
    expect(data.annotations[0].lines).toBe("2");
    expect(data.annotations[0].label).toBe("Lookup");
  });

  it("openapi-spec preserves the full spec JSON", async () => {
    const data = await dataOf("openapi-spec");
    expect(typeof data.spec).toBe("string");
    const spec = JSON.parse(data.spec);
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.paths["/widgets"]).toBeDefined();
  });
});

describe("registry blocks — duplicated block id reminting", () => {
  it("can refresh preserved inline MDX to a reminted duplicate block id", async () => {
    const originalRaw = seedNfm("api-endpoint", "api-endpoint-original");
    const parsed = await parseRegistryBlockData(originalRaw);
    expect(parsed).not.toBeNull();

    const remintedRaw = serializeRegistryBlockToMdx(parsed!.type, {
      ...parsed!.base,
      id: "api-endpoint-copy",
      data: parsed!.data,
    });

    expect(remintedRaw).toContain('id="api-endpoint-copy"');
    expect(remintedRaw).not.toContain("api-endpoint-original");
    expect(docToNfm(nfmToDoc(remintedRaw))).toBe(remintedRaw);

    const remintedParsed = await parseRegistryBlockData(remintedRaw);
    expect(remintedParsed?.base.id).toBe("api-endpoint-copy");
    expect(remintedParsed?.type).toBe("api-endpoint");
    expect(remintedParsed?.data).toEqual(parsed!.data);
  });
});
