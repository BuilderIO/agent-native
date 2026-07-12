/**
 * Plan document ⇄ blocks[] serializer.
 *
 * This is the deterministic bridge between a plan's `PlanContent.blocks[]`
 * (the canonical source of truth, stored as normalized JSON in SQL) and the
 * single editable ProseMirror/Tiptap document the browser editor renders. It is
 * the plan analog of the content app's `nfm.ts` — pure functions with no
 * editor/React/DOM dependency so both the editor and any headless caller can use
 * them.
 *
 * The model (read before editing):
 *   - A plan is a flat list of blocks. `rich-text` blocks carry GFM markdown;
 *     every OTHER block type is a structured ("atom") block whose `data` lives in
 *     `blocks[]`, NOT in the document.
 *   - `blocksToProseJSON` turns the block list into one `doc`:
 *       * each `rich-text` block expands (via `gfmToProseJSON`) into its prose
 *         nodes; the FIRST node is stamped with `attrs.runId = block.id` so a
 *         later re-parse can map the prose run back to its originating block id
 *         (stable ids across edits);
 *       * each structured block becomes a single atom `planBlock` node carrying
 *         only `{ blockType, blockId, title, summary }` in attrs — never `data`.
 *         The block's `data` is threaded into the live node view through React
 *         context, sourced from `blocks[]`.
 *   - `proseJSONToBlocks` walks the doc left→right and inverts the mapping:
 *       * every maximal run of NON-`planBlock` nodes collapses (via
 *         `proseJSONToGfm`) into ONE `rich-text` block. Its id is the run's first
 *         node `runId` when present and not already used this pass, otherwise a
 *         freshly minted id. Whitespace-only runs are dropped (no empty
 *         rich-text blocks);
 *       * each `planBlock` node is reconstructed from `prevBlocks` by `blockId`,
 *         taking `data` from the previous block (the document never stores it).
 *         If the editor re-minted a duplicated pasted block id, the node may
 *         carry `sourceBlockId`; data is copied from that previous source once.
 *
 * IMPORTANT — two adjacent `rich-text` blocks legitimately MERGE. Two prose
 * blocks sitting next to each other in `blocks[]` form a single contiguous prose
 * run in the document; on the inverse pass they collapse into ONE `rich-text`
 * block. That is the intended canonical form, not a bug: the first round-trip
 * normalizes the shape and the second round-trip is a true fixed point. Inserting
 * a structured block between two prose blocks is what keeps them separate.
 *
 * Best-effort by contract: `proseJSONToBlocks` never throws. The caller validates
 * the result through `planBlockSchema` / `planContentSchema`.
 */

import {
  gfmToProseJSON,
  proseJSONToGfm,
  type JSONContent,
} from "@agent-native/core/client";

import {
  createPlanBlockId,
  type PlanBlock,
  type PlanRichTextBlock,
} from "./plan-content";

/** The atom node that stands in for a structured (non-prose) block. */
const PLAN_BLOCK_NODE = "planBlock";

type PlanBlockNodeAttrs = {
  blockType: string;
  blockId: string;
  title: string | null;
  summary: string | null;
  sourceBlockId?: string | null;
};

function isPlanBlockNode(node: JSONContent | undefined): boolean {
  return !!node && node.type === PLAN_BLOCK_NODE;
}

/** A prose node JSON with a copied/added attrs object (never mutates input). */
function withRunId(node: JSONContent, runId: string): JSONContent {
  return { ...node, attrs: { ...(node.attrs ?? {}), runId } };
}

/** True when a node only carries the runId attr (no real content attrs). */
function stripRunId(node: JSONContent): JSONContent {
  if (!node.attrs || node.attrs.runId == null) return node;
  const { runId: _ignored, ...rest } = node.attrs;
  if (Object.keys(rest).length === 0) {
    const { attrs: _drop, ...node2 } = node;
    return node2;
  }
  return { ...node, attrs: rest };
}

/**
 * Read the `runId` off the first node of a prose run, if any. The serializer
 * always stamps the FIRST node, so that is the only one we consult.
 */
function runIdOf(nodes: JSONContent[]): string | undefined {
  const first = nodes[0];
  const runId = first?.attrs?.runId;
  return typeof runId === "string" && runId.length > 0 ? runId : undefined;
}

/**
 * Convert a plan block list into a single ProseMirror `doc` JSON.
 *
 * Empty input (or input that produces no nodes) yields a doc with a single empty
 * paragraph so the document is always a valid, editable ProseMirror doc.
 */
export function blocksToProseJSON(blocks: PlanBlock[]): JSONContent {
  const content: JSONContent[] = [];

  for (const block of blocks) {
    if (block.type === "rich-text") {
      const nodes = gfmToProseJSON(block.data.markdown ?? "");
      if (nodes.length === 0) {
        // A rich-text block with empty markdown still owns its id; emit a single
        // empty paragraph stamped with the run id so the id survives a re-parse
        // (the paragraph is whitespace-only, but keeping it here preserves the
        // block until the user types — the inverse pass drops empty prose runs,
        // which is the intended merge/cleanup behavior).
        content.push({
          type: "paragraph",
          attrs: { runId: block.id },
        });
        continue;
      }
      content.push(withRunId(nodes[0], block.id), ...nodes.slice(1));
      continue;
    }

    // Structured block → a single atom planBlock node. `data` is intentionally
    // NOT serialized into the node; it lives in blocks[] and is threaded into the
    // node view via React context.
    const attrs: PlanBlockNodeAttrs = {
      blockType: block.type,
      blockId: block.id,
      title: block.title ?? null,
      summary: block.summary ?? null,
    };
    content.push({ type: PLAN_BLOCK_NODE, attrs });
  }

  if (content.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return { type: "doc", content };
}

/** True when a prose run serializes to nothing but whitespace. */
function isWhitespaceOnly(markdown: string): boolean {
  return markdown.trim().length === 0;
}

function makeRichTextBlock(id: string, markdown: string): PlanRichTextBlock {
  return { id, type: "rich-text", data: { markdown } };
}

/**
 * Reconstruct a structured block from a `planBlock` node + the previous blocks.
 *
 * The document never stores a structured block's `data`, so we recover it from
 * `prevBlocks` by id. When a duplicated/pasted block was re-minted, its node
 * carries `sourceBlockId`, letting us copy the original block's data into the
 * new block instead of replacing it with the registry's empty shape. When no
 * previous block or source is found (e.g. a slash-command insert before the
 * editor has seeded its data), we fall back to an empty `{}` data object. This
 * module is pure and React-free, so it cannot reach the block registry's
 * `spec.empty()` here; the editor (which DOES have the registry) seeds
 * `spec.empty()` data into `blocks[]` the moment a brand-new `planBlock` id
 * appears. The `{}` fallback only guards the pure/headless case and the caller
 * re-validates via `planBlockSchema`.
 */
function reconstructStructuredBlock(
  node: JSONContent,
  prevById: Map<string, PlanBlock>,
): PlanBlock | undefined {
  const attrs = (node.attrs ?? {}) as Partial<PlanBlockNodeAttrs>;
  const blockId = attrs.blockId;
  const blockType = attrs.blockType;
  if (typeof blockId !== "string" || typeof blockType !== "string") {
    // Malformed planBlock node (no id/type) — best-effort: drop it.
    return undefined;
  }

  const prev = prevById.get(blockId);
  const source =
    typeof attrs.sourceBlockId === "string"
      ? prevById.get(attrs.sourceBlockId)
      : undefined;
  const dataSource =
    prev && prev.type === blockType
      ? prev
      : source && source.type === blockType
        ? source
        : undefined;
  const data =
    dataSource && dataSource.type === blockType
      ? (dataSource as { data: unknown }).data
      : ((prev as { data?: unknown } | undefined)?.data ?? {});

  const title = attrs.title;
  const summary = attrs.summary;

  const block: PlanBlock = {
    id: blockId,
    type: blockType as PlanBlock["type"],
    ...(typeof title === "string" && title.length > 0 ? { title } : {}),
    ...(typeof summary === "string" && summary.length > 0 ? { summary } : {}),
    data,
  } as PlanBlock;

  // Preserve `editable` from the previous block if present — the document does
  // not carry it.
  if (dataSource && typeof dataSource.editable === "boolean") {
    block.editable = dataSource.editable;
  }
  return block;
}

/**
 * Convert a ProseMirror `doc` JSON back into a plan block list, using the
 * previous blocks to recover structured-block `data` (and stable ids for prose
 * runs that were not split). Best-effort; never throws.
 */
export function proseJSONToBlocks(
  doc: JSONContent,
  prevBlocks: PlanBlock[],
): PlanBlock[] {
  const prevById = new Map<string, PlanBlock>();
  const indexPrev = (block: PlanBlock) => {
    prevById.set(block.id, block);
  };
  for (const block of prevBlocks) indexPrev(block);

  const nodes = Array.isArray(doc?.content) ? doc.content : [];
  const out: PlanBlock[] = [];
  const usedRunIds = new Set<string>();

  let run: JSONContent[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    // Drop the runId attr before serializing — GFM never emits it, and we read
    // it separately for id stability.
    const cleaned = run.map(stripRunId);
    const markdown = proseJSONToGfm(cleaned);
    const candidateId = runIdOf(run);

    if (isWhitespaceOnly(markdown)) {
      // Whitespace-only run → no rich-text block. But if it carried a known run
      // id, mark it used so a later (real) run does not steal it.
      if (candidateId) usedRunIds.add(candidateId);
      run = [];
      return;
    }

    let id: string;
    if (candidateId && !usedRunIds.has(candidateId)) {
      id = candidateId;
    } else {
      id = createPlanBlockId("rich-text");
    }
    usedRunIds.add(id);
    out.push(makeRichTextBlock(id, markdown));
    run = [];
  };

  for (const node of nodes) {
    if (isPlanBlockNode(node)) {
      flushRun();
      const block = reconstructStructuredBlock(node, prevById);
      if (block) out.push(block);
      continue;
    }
    run.push(node);
  }
  flushRun();

  return out;
}
