import type { PlanBlock } from "@shared/plan-content";

type PlanTocItemBase = {
  id: string;
  blockId: string;
  label: string;
  level: number;
};

export type PlanBlockTocItem = PlanTocItemBase & {
  kind: "block";
};

export type PlanHeadingTocItem = PlanTocItemBase & {
  kind: "heading";
  headingIndex: number;
};

export type PlanTocItem = PlanBlockTocItem | PlanHeadingTocItem;

type RectLike = {
  getBoundingClientRect: () => { top: number };
};

export function getActivePlanTocId(
  ids: string[],
  getElementById: (id: string) => RectLike | null,
  offset = 180,
  scrollRoot: RectLike | null = null,
) {
  let active = ids[0] ?? "";
  const rootTop = scrollRoot?.getBoundingClientRect().top ?? 0;
  for (const id of ids) {
    const el = getElementById(id);
    if (!el) continue;
    const top = el.getBoundingClientRect().top - rootTop;
    if (top <= offset) {
      active = id;
    } else {
      break;
    }
  }
  return active;
}

export function collectPlanTocItems(blocks: PlanBlock[]): PlanTocItem[] {
  const items = blocks.flatMap((block) => {
    if (block.type === "rich-text") {
      const headings = collectMarkdownHeadings(block);
      if (headings.length > 0) return headings;
    }
    if (!block.title?.trim()) return [];
    return [
      {
        id: tocIdForBlock(block.id),
        blockId: block.id,
        label: block.title.trim(),
        level: 0,
        kind: "block" as const,
      },
    ];
  });

  // When heading-derived items are sparse (fewer than 3), synthesize semantic
  // entries from block types so block-heavy documents get a useful TOC. Entries
  // are merged with any real headings in document order, and each synthetic
  // entry is only added once (first matching block wins).
  const headingCount = items.filter((item) => item.kind === "heading").length;
  if (items.length < 3) {
    const synthetic: PlanTocItem[] = [];
    const usedBlockIds = new Set(items.map((item) => item.blockId));

    // Semantic label map: block type → TOC label. Only the FIRST occurrence of
    // each type is synthesized (second file-tree, second data-model, etc. get no
    // separate entry — they're assumed to be the same semantic category).
    const seenSynthTypes = new Set<string>();
    const SYNTH_LABELS: Partial<Record<PlanBlock["type"], string>> = {
      "file-tree": "Files changed",
      "data-model": "Schema",
      "api-endpoint": "API",
      diff: "Key changes",
      "annotated-code": "Key changes",
      "question-form": "Open questions",
    };

    for (const block of blocks) {
      if (usedBlockIds.has(block.id)) continue;
      if (block.type === "tabs" || block.type === "columns") continue;
      const label = SYNTH_LABELS[block.type];
      if (!label) continue;
      // De-duplicate: file-tree+file-tree both map to "Files changed", so only
      // emit the first. But api-endpoint and diff both can synthesize (different
      // labels), so key by label not type.
      if (seenSynthTypes.has(label)) continue;
      seenSynthTypes.add(label);
      synthetic.push({
        id: tocIdForBlock(block.id),
        blockId: block.id,
        label,
        level: 0,
        kind: "block" as const,
      });
    }

    // Merge synthetic items with real heading items in document order. Real
    // headings keep their positions; synthetic items are inserted in between
    // based on block order.
    if (synthetic.length > 0) {
      // Build a block-index lookup for ordering.
      const blockOrderMap = new Map(blocks.map((b, i) => [b.id, i]));
      const merged = [...items, ...synthetic].sort((a, b) => {
        const ia = blockOrderMap.get(a.blockId) ?? 9999;
        const ib = blockOrderMap.get(b.blockId) ?? 9999;
        return ia - ib;
      });
      return merged;
    }
  }

  void headingCount; // referenced above for potential future threshold tuning
  return items;
}

function collectMarkdownHeadings(
  block: Extract<PlanBlock, { type: "rich-text" }>,
): PlanTocItem[] {
  const items: PlanTocItem[] = [];
  let inFence = false;
  let fenceMarker = "";

  for (const line of block.data.markdown.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;

    const headingMatch = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (!headingMatch) continue;

    const label = cleanHeadingLabel(headingMatch[2]);
    if (!label) continue;
    const depth = headingMatch[1].length;
    items.push({
      id: tocIdForHeading(block.id, items.length),
      blockId: block.id,
      label,
      level: depth >= 3 ? 1 : 0,
      kind: "heading",
      headingIndex: items.length,
    });
  }

  return items;
}

function cleanHeadingLabel(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

function tocIdForBlock(blockId: string) {
  return `plan-section-${blockId}`;
}

function tocIdForHeading(blockId: string, index: number) {
  return `plan-heading-${blockId}-${index}`;
}
