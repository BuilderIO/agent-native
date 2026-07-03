// @vitest-environment happy-dom

/**
 * Collab-stability properties for the plan doc ↔ blocks[] serializer.
 *
 * These tests verify the SERIALIZATION properties that must hold for single-doc
 * Yjs collab in `PlanDocumentEditor`. Single-doc collab is now ENABLED
 * (`SINGLE_DOC_COLLAB_ENABLED = true`); this suite remains the regression guard
 * for the serialization layer it depends on.
 *
 * ROOT CAUSE DIAGNOSIS (2026-06) AND RESOLUTION:
 *   The pure `blocks[] → doc JSON → blocks[]` round-trip IS byte-stable —
 *   the existing `plan-doc.roundtrip.spec.ts` suite confirms this. The
 *   instability that kept collab off was NOT in the pure serialization layer:
 *
 *   1. FULL-FRAGMENT REWRITE (the original problem): `editor.commands
 *      .setContent(newDoc)` when the Collaboration extension is active routes
 *      through y-prosemirror, which replaces the ENTIRE `Y.XmlFragment` rather
 *      than patching individual changed nodes. Every `planBlock` ReactNodeView
 *      (`Tiptap ReactRenderer`) is torn down and recreated; each `ReactRenderer`
 *      constructor calls `flushSync`, firing inside a React render lifecycle and
 *      producing "flushSync called from inside a lifecycle method" warnings at a
 *      rate proportional to the autosave frequency × the number of structured
 *      blocks.
 *
 *   2. WHY `normalizeValue` WAS NOT ENOUGH: The `normalizeValue` guard in
 *      `useCollabReconcile` prevents UNNECESSARY `setContent` calls (those where
 *      the serialized content is already equivalent). But the initial seed and
 *      any external agent/peer edit still require an apply, which — via the old
 *      whole-document `setContent` — triggered the full-fragment rewrite above.
 *
 *   3. HOW COLLAB WAS RE-ENABLED (no `packages/core` change needed): The plan's
 *      injected `setContent` (in `PlanDocumentEditor.tsx`) now applies external
 *      edits SURGICALLY via `applyBlocksSurgically` → `applyDocSurgically`
 *      (exported from `@agent-native/core/client/editor`). It parses the
 *      authoritative `blocks[]` into a doc built with the LIVE editor's schema
 *      (`editor.schema.nodeFromJSON(blocksToProseJSON(blocks))`), diffs it
 *      top-level against the live doc, and dispatches ONE
 *      `tr.replaceWith(from, to, changed)` for the changed run — so unchanged
 *      `planBlock` NodeViews are never torn down and, under Collaboration, Yjs
 *      sees a minimal edit instead of a full `Y.XmlFragment` rewrite. Because the
 *      plan's serializer has no tiptap-markdown storage parser, the reconcile's
 *      own `defaultParseValue` returns null and every external apply routes
 *      through the plan's `setContent`, so the surgical path lives entirely in
 *      template code. See `PlanDocumentEditor.surgical.spec.ts` for the direct
 *      NodeView-identity regression test.
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

describe("plan-doc collab-stability: preconditions for single-doc Yjs collab", () => {
  /**
   * Both preconditions for single-doc collab now hold (the flag is ON):
   *
   * PRECONDITION MET: pure serialization stability (these tests).
   * PRECONDITION MET: surgical Yjs apply path — the plan's `setContent` applies
   *   external edits via `applyDocSurgically` (see the file-level comment and
   *   `PlanDocumentEditor.surgical.spec.ts`, which exercises the live-editor
   *   surgical path directly).
   *
   * These serialization tests remain the regression guard for the layer the
   * surgical path depends on: if the round-trip ever stops being a fixed point,
   * the reconcile's echo/already-in-sync equality checks break and collab churns.
   */
  it("serialization is a necessary precondition for safe Yjs collab (regression guard)", () => {
    // This test asserts the NECESSARY precondition: the pure serialization is stable.
    // The SUFFICIENT precondition (surgical Yjs apply) is covered by
    // PlanDocumentEditor.surgical.spec.ts, which needs a live editor + schema.
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
