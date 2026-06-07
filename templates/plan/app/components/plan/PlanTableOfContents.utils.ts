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
  return blocks.flatMap((block) => {
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
