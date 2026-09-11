import { Extension } from "@tiptap/core";

/**
 * Node types that carry the optional `runId` attribute.
 *
 * These are exactly the top-level block nodes a plan's `rich-text` block can
 * serialize to. The plan's `doc ↔ blocks[]` bridge stamps `runId` onto the
 * FIRST node of each rich-text run so a re-parse can map the run back to its
 * originating block id (stable ids across edits). Atom/structured blocks live
 * in their own `planBlock` node and do not need this attribute.
 */
export const RUN_ID_NODE_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
] as const;

/**
 * Tiptap extension that adds a GLOBAL `runId` attribute (default `null`) to the
 * block node types in {@link RUN_ID_NODE_TYPES}.
 *
 * - `renderHTML` emits `data-run-id` only when the attribute is set, so the
 *   live editor's DOM carries the id for the doc↔blocks bridge.
 * - `parseHTML` reads `data-run-id` back so a paste / re-parse preserves it.
 * - Markdown serialization deliberately IGNORES `runId`: GFM never emits it.
 *   `tiptap-markdown` drops attributes it has no serializer for, so we simply
 *   don't register a markdown serializer here — the attribute is invisible to
 *   the GFM round-trip and only lives in the ProseMirror JSON / DOM.
 *
 * Used by BOTH the headless `gfmDoc` editor and the live plan editor so the
 * schema is identical on both sides of the bridge.
 */
export const RunId = Extension.create({
  name: "runId",

  addGlobalAttributes() {
    return [
      {
        types: [...RUN_ID_NODE_TYPES],
        attributes: {
          runId: {
            default: null,
            // Read the id off the rendered DOM so paste / re-parse round-trips.
            parseHTML: (element) => element.getAttribute("data-run-id"),
            // Only emit the attribute when set; an unset (null) runId adds
            // nothing to the DOM so untouched nodes stay clean.
            renderHTML: (attributes) => {
              const runId = (attributes as { runId?: string | null }).runId;
              if (!runId) return {};
              return { "data-run-id": runId };
            },
          },
        },
      },
    ];
  },
});
