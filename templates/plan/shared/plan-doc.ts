import {
  gfmToProseJSON,
  type JSONContent,
  proseJSONToGfm,
} from "@agent-native/toolkit/editor";

import {
  createPlanBlockId,
  type PlanBlock,
  type PlanRichTextBlock,
} from "./plan-content";

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

function withRunId(node: JSONContent, runId: string): JSONContent {
  return { ...node, attrs: { ...(node.attrs ?? {}), runId } };
}

function stripRunId(node: JSONContent): JSONContent {
  if (!node.attrs || node.attrs.runId == null) return node;
  const { runId: _ignored, ...rest } = node.attrs;
  if (Object.keys(rest).length === 0) {
    const { attrs: _drop, ...node2 } = node;
    return node2;
  }
  return { ...node, attrs: rest };
}

function runIdOf(nodes: JSONContent[]): string | undefined {
  const first = nodes[0];
  const runId = first?.attrs?.runId;
  return typeof runId === "string" && runId.length > 0 ? runId : undefined;
}

export function blocksToProseJSON(blocks: PlanBlock[]): JSONContent {
  const content: JSONContent[] = [];

  for (const block of blocks) {
    if (block.type === "rich-text") {
      const nodes = gfmToProseJSON(block.data.markdown ?? "");
      if (nodes.length === 0) {
        content.push({
          type: "paragraph",
          attrs: { runId: block.id },
        });
        continue;
      }
      content.push(withRunId(nodes[0], block.id), ...nodes.slice(1));
      continue;
    }

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

function isWhitespaceOnly(markdown: string): boolean {
  return markdown.trim().length === 0;
}

function makeRichTextBlock(id: string, markdown: string): PlanRichTextBlock {
  return { id, type: "rich-text", data: { markdown } };
}

function reconstructStructuredBlock(
  node: JSONContent,
  prevById: Map<string, PlanBlock>,
): PlanBlock | undefined {
  const attrs = (node.attrs ?? {}) as Partial<PlanBlockNodeAttrs>;
  const blockId = attrs.blockId;
  const blockType = attrs.blockType;
  if (typeof blockId !== "string" || typeof blockType !== "string") {
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

  if (dataSource && typeof dataSource.editable === "boolean") {
    block.editable = dataSource.editable;
  }
  return block;
}

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
    const cleaned = run.map(stripRunId);
    const markdown = proseJSONToGfm(cleaned);
    const candidateId = runIdOf(run);

    if (isWhitespaceOnly(markdown)) {
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
