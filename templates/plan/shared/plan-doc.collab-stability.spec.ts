// @vitest-environment happy-dom

/**
 * Collab-stability properties for the plan doc ↔ blocks[] serializer.
 *
 * These tests document and verify the properties that must hold for single-doc
 * Yjs collab to be safely re-enabled in `PlanDocumentEditor`.
 *
 * ROOT CAUSE DIAGNOSIS (2026-06):
 *   The pure `blocks[] → doc JSON → blocks[]` round-trip IS byte-stable —
 *   the existing `plan-doc.roundtrip.spec.ts` suite confirms this. The
 *   instability documented in `PlanDocumentEditor.tsx` (SINGLE_DOC_COLLAB_ENABLED
 *   = false) is NOT in the pure serialization layer.
 *
 *   The actual instability, when single-doc Yjs collab is enabled, is:
 *
 *   1. FULL-FRAGMENT REWRITE: `editor.commands.setContent(newDoc)` when the
 *      Collaboration extension is active routes through y-prosemirror, which
 *      replaces the ENTIRE `Y.XmlFragment` rather than patching individual
 *      changed nodes. Every `planBlock` ReactNodeView (`Tiptap ReactRenderer`)
 *      is torn down and recreated; each `ReactRenderer` constructor calls
 *      `flushSync`, and that call fires inside a React render lifecycle,
 *      producing "flushSync called from inside a lifecycle method" warnings at
 *      a rate proportional to the autosave frequency × the number of structured
 *      blocks.
 *
 *   2. WHY `normalizeValue` IS NOT ENOUGH: The `normalizeValue` guard in
 *      `useCollabReconcile` prevents UNNECESSARY `setContent` calls (those where
 *      the serialized content is already equivalent). But the initial seed and
 *      any external agent/peer edit still require a `setContent` call, which
 *      triggers the full-fragment rewrite described above.
 *
 *   3. WHAT IS NEEDED TO RE-ENABLE COLLAB (requires `packages/core` change):
 *      The `setContent` path in `useCollabReconcile` must be replaced with a
 *      surgical Yjs transaction when collab is active: compare the incoming
 *      `blocks[]` against the live doc block-by-block and apply only the
 *      changed runs / atoms via targeted `tr.replaceWith(from, to, newNode)`
 *      calls, so unchanged `planBlock` NodeViews are never torn down.
 *      This change must live in `packages/core/src/client/rich-markdown-editor/
 *      useCollabReconcile.ts` because the surgical path requires access to the
 *      Yjs `Y.XmlFragment` and the Collaboration extension's encoding layer.
 *      Specifically, one of:
 *        Option A: Add a `setContentSurgical` hook to `UseCollabReconcileOptions`
 *          so the plan can supply a targeted transaction per changed block range,
 *          applied via the ProseMirror `tr.replaceWith(from, to, fragment)` API.
 *        Option B: Make `useCollabReconcile` diff the old vs new doc JSON and emit
 *          targeted Yjs step operations (insert/delete at specific positions) instead
 *          of replacing the whole `Y.XmlFragment`.
 *
 * SERIALIZATION STABILITY (no Yjs, pure data layer):
 *   The `normalizeValue` function used by `PlanDocumentEditor` runs:
 *     `JSON.stringify(proseJSONToBlocks(blocksToProseJSON(blocks), blocks))`
 *   This is a fixed point after the first pass — confirmed by the tests below.
 *   It is the correct canonicalization for the reconcile's "already in sync" check.
 *
 * PER-BLOCK COLLAB (live today):
 *   The `PlanMarkdownEditor` component (used for legacy per-block editing) already
 *   implements real-time collaboration using per-block doc IDs of the form
 *   `plan:${planId}:${blockId}`. The server-side collab plugin is healthy and
 *   handles both `plan:<id>` (single-doc shape) and `plan:<id>:<block>` (per-block
 *   shape) correctly (see `server/collab-plugin.spec.ts`).
 */

import { describe, expect, it } from "vitest";

import type { PlanBlock } from "./plan-content";
import { blocksToProseJSON, proseJSONToBlocks } from "./plan-doc";

/** Mirrors the `normalizeValue` closure in `PlanDocumentEditor`. */
function normalizeValue(input: string): string {
  try {
    const parsed = JSON.parse(input) as PlanBlock[];
    return JSON.stringify(proseJSONToBlocks(blocksToProseJSON(parsed), parsed));
  } catch {
    return input;
  }
}

/**
 * Simulates `getMarkdown(editor)` at steady state — what the live plan editor
 * emits after a `setContent(blocksToProseJSON(blocks))` followed by no further
 * user edits. In the live editor, `getMarkdown` is
 * `proseJSONToBlocks(editor.getJSON(), blocksRef.current)`. At steady state
 * (right after seeding, before any edit), `editor.getJSON()` equals what
 * `blocksToProseJSON` produced — so this pure-function simulation is accurate.
 */
function simulateGetMarkdownAtSteadyState(blocks: PlanBlock[]): string {
  return JSON.stringify(proseJSONToBlocks(blocksToProseJSON(blocks), blocks));
}

describe("plan-doc collab-stability: normalizeValue is a fixed point", () => {
  it("normalizeValue applied twice is identical to once, for a simple markdown block", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-1",
        type: "rich-text",
        data: { markdown: "# Heading\n\nA paragraph with **bold** text." },
      },
    ];
    const value = JSON.stringify(blocks);
    const once = normalizeValue(value);
    const twice = normalizeValue(once);
    expect(twice).toBe(once);
  });

  it("normalizeValue applied twice is identical to once, for mixed prose + structured blocks", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-before",
        type: "rich-text",
        data: { markdown: "Intro paragraph." },
      },
      {
        id: "callout-1",
        type: "callout",
        data: { tone: "info", body: "A note." },
      },
      {
        id: "rt-after",
        type: "rich-text",
        data: { markdown: "## Section\n\n- Item 1\n- Item 2" },
      },
    ];
    const value = JSON.stringify(blocks);
    const once = normalizeValue(value);
    const twice = normalizeValue(once);
    expect(twice).toBe(once);
  });

  it("normalizeValue applied twice is identical to once, for complex GFM markdown", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-complex",
        type: "rich-text",
        data: {
          markdown: [
            "# Title",
            "",
            "> A blockquote.",
            "",
            "```ts",
            "const x = 1;",
            "```",
            "",
            "| Col A | Col B |",
            "| --- | --- |",
            "| v1 | v2 |",
            "",
            "Trailing paragraph.",
          ].join("\n"),
        },
      },
    ];
    const value = JSON.stringify(blocks);
    const once = normalizeValue(value);
    const twice = normalizeValue(once);
    expect(twice).toBe(once);
  });
});

describe("plan-doc collab-stability: autosave echo recognition property", () => {
  /**
   * The most critical property for the reconcile's echo guard:
   *
   * `normalizeValue(getMarkdown_result)` must equal `getMarkdown_result` so
   * the reconcile's `recentEmittedRef` ring hit (which stores `getMarkdown`
   * output) also catches the `normalizedValue` path:
   *   `recentEmittedRef.current.includes(normalizedValue)`
   *
   * In the live non-collab editor, at steady state:
   *   - `getMarkdown(editor)` produces `S`
   *   - autosave records `S` in the ring
   *   - autosave saves these blocks to SQL; SQL returns them as `content.blocks`
   *   - `value = JSON.stringify(content.blocks)` — same or normalizeValue-equivalent
   *   - `normalizeValue(value)` must equal `S` so the ring catches it
   */
  it("normalizeValue(simulateGetMarkdown(blocks)) === simulateGetMarkdown(blocks) at steady state", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-1",
        type: "rich-text",
        data: { markdown: "A paragraph." },
      },
    ];
    const emitted = simulateGetMarkdownAtSteadyState(blocks);
    const reNormalized = normalizeValue(emitted);
    expect(reNormalized).toBe(emitted);
  });

  it("normalizeValue(getMarkdown) === getMarkdown for GFM markdown at steady state", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-2",
        type: "rich-text",
        data: { markdown: "# H1\n\nParagraph.\n\n- A\n- B" },
      },
    ];
    const emitted = simulateGetMarkdownAtSteadyState(blocks);
    const reNormalized = normalizeValue(emitted);
    expect(reNormalized).toBe(emitted);
  });

  it("structured block IDs are preserved through normalizeValue (ring key stability)", () => {
    // Block IDs in the normalized form must match what getMarkdown emits, so the
    // reconcile's ring comparison works for structured + prose mixed content.
    const blocks: PlanBlock[] = [
      {
        id: "rt-a",
        type: "rich-text",
        data: { markdown: "Before the block." },
      },
      {
        id: "diagram-1",
        type: "diagram",
        data: { nodes: [{ id: "n1", label: "Start" }], edges: [] },
      },
      {
        id: "rt-b",
        type: "rich-text",
        data: { markdown: "After the block." },
      },
    ];
    const value = JSON.stringify(blocks);
    const normalized = normalizeValue(value);
    const parsed = JSON.parse(normalized) as PlanBlock[];
    expect(parsed.map((b) => b.id)).toEqual(["rt-a", "diagram-1", "rt-b"]);
  });

  it("adjacent rich-text blocks merge in normalizeValue (ring key preserves first block ID)", () => {
    // Two adjacent rich-text blocks are normalized into ONE in the first pass
    // (the serializer design: contiguous prose = one run). The merged block keeps
    // the first block's id, so ring comparisons for ANY value that started with
    // those two adjacent blocks will use the first id.
    const blocks: PlanBlock[] = [
      {
        id: "rt-first",
        type: "rich-text",
        data: { markdown: "First paragraph." },
      },
      {
        id: "rt-second",
        type: "rich-text",
        data: { markdown: "Second paragraph." },
      },
    ];
    const normalized = normalizeValue(JSON.stringify(blocks));
    const parsed = JSON.parse(normalized) as PlanBlock[];
    // After normalization the two adjacent prose blocks merge to one.
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("rt-first");
    // And that merged form is a fixed point.
    const reNormalized = normalizeValue(normalized);
    expect(reNormalized).toBe(normalized);
  });
});

describe("plan-doc collab-stability: documented preconditions for single-doc Yjs collab", () => {
  /**
   * Documents the remaining gap that keeps `SINGLE_DOC_COLLAB_ENABLED = false`.
   *
   * PRECONDITION MET: pure serialization stability (these tests).
   * PRECONDITION NOT YET MET: surgical Yjs apply path (needs packages/core change).
   *
   * The presence of this test file documents the exact gap. When the
   * packages/core surgical-apply change lands, flip the flag and these tests
   * continue to serve as regression guard for the serialization layer.
   */
  it("serialization is a necessary but not sufficient precondition for safe Yjs collab (documents the gap)", () => {
    // This test asserts the NECESSARY precondition: the pure serialization is stable.
    // The SUFFICIENT precondition (surgical Yjs apply, not tested here because it
    // requires a live editor + Yjs) is documented in the file-level comment above.
    const blocks: PlanBlock[] = [
      {
        id: "rt-1",
        type: "rich-text",
        data: { markdown: "# Plan title\n\nSome notes." },
      },
      {
        id: "wireframe-1",
        type: "wireframe",
        data: {
          surface: "desktop",
          caption: "Home",
          screen: [{ id: "t1", el: "title", text: "Welcome" }],
        },
      },
    ];
    const value = JSON.stringify(blocks);
    const canonical = normalizeValue(value);
    const recanonical = normalizeValue(canonical);
    // Fixed-point check: once canonical, always canonical.
    expect(recanonical).toBe(canonical);
    // All block IDs survive normalization.
    const parsed = JSON.parse(canonical) as PlanBlock[];
    expect(parsed.map((b) => b.id)).toEqual(["rt-1", "wireframe-1"]);
    // The simulated getMarkdown output is already in canonical form.
    const emitted = simulateGetMarkdownAtSteadyState(
      JSON.parse(canonical) as PlanBlock[],
    );
    expect(normalizeValue(emitted)).toBe(emitted);
  });
});
