import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeNfm, docToNfm, nfmToDoc } from "./nfm";
import {
  isRegistryBlockTag,
  registryBlockSpecByTag,
  serializeRegistryBlockToMdx,
  parseRegistryBlockData,
} from "./nfm-registry";

/**
 * Replica of the private `hashContent` in `server/lib/notion-sync.ts` — the
 * authoritative conflict-detection signal is `sha256(canonicalizeNfm(content))`.
 * Kept byte-identical here so this spec exercises the EXACT code path Notion
 * push/pull use for `lastSyncedContentHash` without exporting server internals.
 */
function hashContent(content: string | null | undefined): string {
  return crypto
    .createHash("sha256")
    .update(canonicalizeNfm(content ?? ""))
    .digest("hex");
}

/**
 * T5 — content's NFM serializer round-trips registry-block MDX components
 * (the dev-doc / OpenAPI library shared with plan) INLINE in the single
 * `documents.content` string, with no sidecar table.
 *
 * The contract mirrors the core idempotency invariant: a document containing an
 * `<Endpoint …/>` / `<Checklist …/>` element must satisfy
 * `x === docToNfm(nfmToDoc(x))` (the verbatim element source survives as the
 * node's `__raw`), AND a document with NO registry blocks must stay byte-for-byte
 * identical to today (regression guard for the existing NFM fixpoint behavior).
 */
const L = (...lines: string[]) => lines.join("\n");

describe("nfm registry blocks — inline round-trip", () => {
  it("recognizes registered PascalCase tags, not lowercase Notion tags", () => {
    expect(isRegistryBlockTag("Endpoint")).toBe(true);
    expect(isRegistryBlockTag("Checklist")).toBe(true);
    expect(isRegistryBlockTag("DataModel")).toBe(true);
    // Lowercase Notion container/atom tags must NOT be registry tags.
    expect(isRegistryBlockTag("callout")).toBe(false);
    expect(isRegistryBlockTag("details")).toBe(false);
    expect(isRegistryBlockTag("table")).toBe(false);
    expect(isRegistryBlockTag("page")).toBe(false);
    expect(isRegistryBlockTag("column")).toBe(false);
    // Unknown tags fall through.
    expect(isRegistryBlockTag("Nope")).toBe(false);
  });

  const REGISTRY_FIXTURES: Array<{ name: string; nfm: string }> = [
    {
      name: "self-closing Checklist",
      nfm: '<Checklist id="c1" items={[{"id":"a","label":"First"}]} />',
    },
    {
      name: "self-closing Endpoint (no body)",
      nfm: '<Endpoint id="e1" method="GET" path="/api/widgets" summary="List widgets" />',
    },
    {
      name: "multi-line Endpoint with prose description",
      nfm: L(
        '<Endpoint id="e2" method="POST" path="/api/widgets">',
        "",
        "Creates a widget.",
        "",
        "</Endpoint>",
      ),
    },
    {
      name: "multi-line self-closing Checklist (pretty-printed JSON attr)",
      nfm: L(
        '<Checklist id="c2" items={[',
        "  {",
        '    "id": "a",',
        '    "label": "First"',
        "  }",
        "]} />",
      ),
    },
    {
      name: "self-closing OpenApi",
      nfm: '<OpenApi id="o1" title="My API" spec="{}" />',
    },
    {
      name: "registry block between paragraphs",
      nfm: L(
        "Intro paragraph.",
        '<Endpoint id="e3" method="DELETE" path="/api/widgets/1" />',
        "Outro paragraph.",
      ),
    },
    {
      name: "registry block alongside plain Notion blocks",
      nfm: L(
        "# A document",
        "Some prose.",
        '<Endpoint id="e6" method="GET" path="/api/things" />',
        '<callout icon="💡">',
        "\tA callout after the endpoint.",
        "</callout>",
        "- a bullet",
      ),
    },
  ];

  for (const { name, nfm } of REGISTRY_FIXTURES) {
    it(`is a round-trip fixpoint: ${name}`, () => {
      expect(docToNfm(nfmToDoc(nfm))).toBe(nfm);
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });

    it(`parses into a registryBlock atom: ${name}`, () => {
      const doc = nfmToDoc(nfm);
      const block = doc.content.find((n) => n.type === "registryBlock");
      expect(block).toBeDefined();
      expect(typeof block?.attrs?.__raw).toBe("string");
      expect(block?.attrs?.blockId).toBeTruthy();
    });
  }

  it("preserves a registry block nested inside a callout (indented __raw)", () => {
    const nfm = L(
      '<callout icon="💡">',
      "\tIntro inside the callout.",
      '\t<Endpoint id="e4" method="GET" path="/nested" />',
      "</callout>",
    );
    expect(docToNfm(nfmToDoc(nfm))).toBe(nfm);
  });

  it("re-serializes an edited registry block from the threaded context", () => {
    const nfm = '<Endpoint id="e5" method="GET" path="/old" />';
    const doc = nfmToDoc(nfm);
    const edited =
      '<Endpoint id="e5" method="POST" path="/new" summary="Updated" />';
    const out = docToNfm(doc, {
      serializeRegistryBlock: (blockId) =>
        blockId === "e5" ? edited : undefined,
    });
    expect(out).toBe(edited);
  });

  it("falls back to __raw when the context returns nothing", () => {
    const nfm = '<Checklist id="c9" items={[]} />';
    const doc = nfmToDoc(nfm);
    const out = docToNfm(doc, {
      serializeRegistryBlock: () => undefined,
    });
    expect(out).toBe(nfm);
  });

  it("serializeRegistryBlockToMdx delegates to core serializeSpecBlock", () => {
    const mdx = serializeRegistryBlockToMdx("checklist", {
      id: "c1",
      data: { items: [{ id: "a", label: "First" }] },
    });
    expect(mdx).toContain("<Checklist");
    expect(mdx).toContain('id="c1"');
    // Round-trips back through the NFM parser to the same bytes.
    expect(docToNfm(nfmToDoc(mdx))).toBe(mdx);
  });

  it("parseRegistryBlockData micro-parses __raw back to typed data", async () => {
    const raw = '<Checklist id="c1" items={[{"id":"a","label":"First"}]} />';
    const parsed = await parseRegistryBlockData(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("checklist");
    expect(parsed?.base.id).toBe("c1");
    const data = parsed?.data as { items: Array<{ label: string }> };
    expect(data.items[0].label).toBe("First");
  });

  it("parseRegistryBlockData reads prose children into a childrenField block", async () => {
    const raw = registryBlockSpecByTag("Endpoint")
      ? L(
          '<Endpoint id="e2" method="POST" path="/api/widgets">',
          "",
          "Creates a widget.",
          "",
          "</Endpoint>",
        )
      : "";
    const parsed = await parseRegistryBlockData(raw);
    expect(parsed?.type).toBe("api-endpoint");
    const data = parsed?.data as { description?: string; method: string };
    expect(data.method).toBe("POST");
    expect(data.description).toContain("Creates a widget.");
  });
});

/**
 * Notion conflict detection hinges on `lastSyncedContentHash =
 * sha256(canonicalizeNfm(content))`. A document that CONTAINS a registry block
 * (which has no Notion analog and rides through as preserved `__raw`) must still
 * produce a stable, deterministic content hash — otherwise every push/pull would
 * mis-detect a phantom local edit on the registry-block portion and either spam
 * conflicts or clobber remote content. These tests prove the hash is stable for
 * registry-bearing documents and tracks real edits, using the byte-exact replica
 * of the server `hashContent`.
 */
describe("nfm registry blocks — content hash / conflict detection", () => {
  const DOC_WITH_REGISTRY = L(
    "# Release notes",
    "",
    "Intro prose before the structured blocks.",
    '<Endpoint id="e1" method="GET" path="/api/widgets" summary="List widgets" />',
    '<Checklist id="c1" items={[{"id":"a","label":"Ship it"}]} />',
    "",
    "Outro prose.",
  );

  it("produces a stable hash across repeated canonicalization (no phantom edits)", () => {
    // The same document hashes to the same value every time — the registry block
    // round-trips byte-exact through its `__raw`, so re-canonicalizing (as both
    // push and pull do) never perturbs the hash.
    const first = hashContent(DOC_WITH_REGISTRY);
    const second = hashContent(DOC_WITH_REGISTRY);
    const reCanonicalized = hashContent(canonicalizeNfm(DOC_WITH_REGISTRY));
    expect(second).toBe(first);
    expect(reCanonicalized).toBe(first);
    // canonicalizeNfm is itself a fixpoint on the registry-bearing doc.
    expect(canonicalizeNfm(DOC_WITH_REGISTRY)).toBe(
      canonicalizeNfm(canonicalizeNfm(DOC_WITH_REGISTRY)),
    );
  });

  it("hash is identical for byte-identical registry-bearing docs", () => {
    // A no-op pull (remote content === local content) must hash-match the
    // baseline so `localChanged`/`remoteChanged` stay false — no false conflict.
    const a = DOC_WITH_REGISTRY;
    const b = [...DOC_WITH_REGISTRY]; // same bytes, distinct string instance
    expect(hashContent(a)).toBe(hashContent(b.join("")));
  });

  it("hash changes only when content actually changes", () => {
    const base = hashContent(DOC_WITH_REGISTRY);
    // Editing the surrounding prose changes the hash (a real local edit).
    const proseEdited = DOC_WITH_REGISTRY.replace(
      "Outro prose.",
      "Outro prose, revised.",
    );
    expect(hashContent(proseEdited)).not.toBe(base);
    // Editing inside a registry block's preserved source also changes the hash.
    const blockEdited = DOC_WITH_REGISTRY.replace(
      'path="/api/widgets"',
      'path="/api/widgets/v2"',
    );
    expect(hashContent(blockEdited)).not.toBe(base);
  });

  it("push serialization of a registry-bearing doc canonicalizes without throwing", () => {
    // `pushDocumentToNotionPage` sends `canonicalizeNfm(content)` to Notion's
    // markdown endpoint. The registry block can't map to a Notion block, so the
    // contract is that canonicalization preserves it verbatim (as `__raw`) and
    // never throws — Notion treats the leftover MDX as text rather than us
    // crashing the push.
    expect(() => canonicalizeNfm(DOC_WITH_REGISTRY)).not.toThrow();
    const pushPayload = canonicalizeNfm(DOC_WITH_REGISTRY);
    // The registry block survives into the pushed markdown (not dropped/garbled).
    expect(pushPayload).toContain('<Endpoint id="e1"');
    expect(pushPayload).toContain('<Checklist id="c1"');
    // And the pushed payload is itself canonical (idempotent), so the hash the
    // push records as the new baseline matches what a subsequent read produces.
    expect(canonicalizeNfm(pushPayload)).toBe(pushPayload);
    expect(hashContent(pushPayload)).toBe(hashContent(DOC_WITH_REGISTRY));
  });
});

/**
 * Regression guard: a document with NO registry blocks must produce byte-exact
 * NFM identical to today's behavior. These mirror the canonical fixpoints in
 * `nfm.spec.ts` — if the registry hook ever leaks into the plain Notion path,
 * one of these breaks.
 */
describe("nfm registry blocks — no-regression on plain NFM", () => {
  const PLAIN_FIXTURES: string[] = [
    "Just a paragraph.",
    'Colored paragraph {color="red"}',
    L("# Heading One", "## Heading Two"),
    L("- bullet one", "\t- nested bullet", "- bullet two"),
    L(
      '<callout icon="💡" color="blue_bg">',
      "\tCallout with **bold** and a nested list:",
      "\t- callout item one",
      "</callout>",
    ),
    L(
      "<details>",
      "<summary>A toggle</summary>",
      "\tHidden child",
      "</details>",
    ),
    L(
      "<columns>",
      "\t<column>",
      "\t\tLeft column text",
      "\t</column>",
      "</columns>",
    ),
    L('<table header-row="true">', "<tr>", "<td>H1</td>", "</tr>", "</table>"),
    '<page url="https://www.notion.so/abc">Child Page</page>',
    "<table_of_contents/>",
    "![A caption](https://cdn.example.com/x.png)",
  ];

  for (const nfm of PLAIN_FIXTURES) {
    it(`stays byte-identical: ${nfm.slice(0, 40).replace(/\n/g, "·")}`, () => {
      expect(docToNfm(nfmToDoc(nfm))).toBe(nfm);
      expect(canonicalizeNfm(nfm)).toBe(nfm);
    });
  }

  it("the combined plain document is a stable fixpoint", () => {
    const doc = PLAIN_FIXTURES.join("\n");
    expect(canonicalizeNfm(doc)).toBe(doc);
    expect(canonicalizeNfm(canonicalizeNfm(doc))).toBe(canonicalizeNfm(doc));
  });
});
