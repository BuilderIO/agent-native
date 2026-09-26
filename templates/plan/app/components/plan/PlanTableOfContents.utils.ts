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

function escapeAttributeValue(value: string) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findBlockElement(root: HTMLElement, blockId: string) {
  return root.querySelector<HTMLElement>(
    `[data-block-id="${escapeAttributeValue(blockId)}"]`,
  );
}

function isDocumentHeading(element: Element): element is HTMLElement {
  return element.matches("h1, h2, h3");
}

function directDocumentHeadings(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      ".an-rich-md-prose > h1, .an-rich-md-prose > h2, .an-rich-md-prose > h3",
    ),
  ).filter((heading) => !heading.closest(".plan-block-node"));
}

function findReadonlyHeadingElement(
  root: HTMLElement,
  item: PlanHeadingTocItem,
) {
  const idTarget = root.querySelector<HTMLElement>(
    `[id="${escapeAttributeValue(item.id)}"]`,
  );
  if (
    idTarget &&
    isDocumentHeading(idTarget) &&
    !idTarget.closest(".plan-block-node")
  ) {
    return idTarget;
  }

  const block = findBlockElement(root, item.blockId);
  if (!block) return null;
  return directDocumentHeadings(block)[item.headingIndex] ?? null;
}

function findMainEditorProse(root: HTMLElement): HTMLElement | null {
  const editor = root.querySelector<HTMLElement>(".plan-document-editor");
  if (!editor) return null;
  return editor.querySelector<HTMLElement>(".an-rich-md-prose");
}

function findEditableHeadingElement(
  root: HTMLElement,
  item: PlanHeadingTocItem,
) {
  const prose = findMainEditorProse(root);
  if (!prose) return null;

  let currentRunId = "";
  let headingIndex = 0;
  for (const child of Array.from(prose.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.hasAttribute("data-plan-block")) {
      currentRunId = "";
      continue;
    }

    const runId = child.getAttribute("data-run-id");
    if (runId && runId !== currentRunId) {
      currentRunId = runId;
      headingIndex = 0;
    }

    if (currentRunId !== item.blockId || !isDocumentHeading(child)) continue;
    if (headingIndex === item.headingIndex) return child;
    headingIndex += 1;
  }

  return null;
}

function findHeadingElement(root: HTMLElement, item: PlanHeadingTocItem) {
  return (
    findReadonlyHeadingElement(root, item) ??
    findEditableHeadingElement(root, item)
  );
}

export function resolvePlanTocElements(
  root: HTMLElement,
  items: PlanTocItem[],
) {
  const map = new Map<string, HTMLElement>();

  for (const item of items) {
    const target =
      item.kind === "block"
        ? findBlockElement(root, item.blockId)
        : findHeadingElement(root, item);
    if (target) map.set(item.id, target);
  }

  return map;
}

export function getActivePlanTocId(
  ids: string[],
  getElementById: (id: string) => RectLike | null,
  offset = 180,
  scrollRoot: RectLike | null = null,
) {
  const fallback = ids[0] ?? "";
  let active = fallback;
  let activeTop = Number.NEGATIVE_INFINITY;
  let activeIndex = -1;
  const rootTop = scrollRoot?.getBoundingClientRect().top ?? 0;
  ids.forEach((id, index) => {
    const el = getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top - rootTop;
    if (top <= offset) {
      if (top > activeTop || (top === activeTop && index > activeIndex)) {
        active = id;
        activeTop = top;
        activeIndex = index;
      }
    }
  });
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

  const headingCount = items.filter((item) => item.kind === "heading").length;
  if (items.length < 3) {
    const synthetic: PlanTocItem[] = [];
    const usedBlockIds = new Set(items.map((item) => item.blockId));

    const SYNTH_LABELS: Partial<Record<PlanBlock["type"], string>> = {
      "file-tree": "Files changed",
      "data-model": "Schema",
      "api-endpoint": "API",
      diff: "Key changes",
      "annotated-code": "Key changes",
      "question-form": "Open questions",
    };

    const usedLabels = new Set(
      items.map((item) => item.label.trim().toLowerCase()),
    );

    for (const block of blocks) {
      if (usedBlockIds.has(block.id)) continue;
      if (block.type === "tabs" || block.type === "columns") continue;
      const label = SYNTH_LABELS[block.type];
      if (!label) continue;
      if (usedLabels.has(label.toLowerCase())) continue;
      usedLabels.add(label.toLowerCase());
      synthetic.push({
        id: tocIdForBlock(block.id),
        blockId: block.id,
        label,
        level: 0,
        kind: "block" as const,
      });
    }

    if (synthetic.length > 0) {
      const blockOrderMap = new Map(blocks.map((b, i) => [b.id, i]));
      const merged = [...items, ...synthetic].sort((a, b) => {
        const ia = blockOrderMap.get(a.blockId) ?? 9999;
        const ib = blockOrderMap.get(b.blockId) ?? 9999;
        return ia - ib;
      });
      return merged;
    }
  }

  void headingCount;
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
