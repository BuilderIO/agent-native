import type { PlanBlock } from "@shared/plan-content";

type PlanBlockLike = {
  id: string;
  type: string;
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function blockStructureSignature(blocks: unknown): string | null {
  if (!Array.isArray(blocks)) return null;

  const parts: unknown[] = [];
  for (const value of blocks) {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.type !== "string"
    ) {
      return null;
    }

    const block = value as PlanBlockLike;
    if (block.type === "tabs" || block.type === "columns") {
      if (!isRecord(block.data)) return null;
      const collectionKey = block.type === "tabs" ? "tabs" : "columns";
      const collection = block.data[collectionKey];
      if (!Array.isArray(collection)) return null;

      const children: unknown[] = [];
      for (const region of collection) {
        if (!isRecord(region) || typeof region.id !== "string") return null;
        const nested = blockStructureSignature(region.blocks);
        if (nested === null) return null;
        children.push([region.id, nested]);
      }
      parts.push([block.type, block.id, children]);
      continue;
    }

    parts.push([block.type, block.id]);
  }

  return JSON.stringify(parts);
}

export function hasPlanBlockStructureChange(
  currentBlocks: PlanBlock[],
  nextBlocks: PlanBlock[],
): boolean {
  const current = blockStructureSignature(currentBlocks);
  const next = blockStructureSignature(nextBlocks);
  return current === null || next === null || current !== next;
}

export function visitPlanBlocks(
  blocks: unknown,
  visit: (block: PlanBlock) => void,
): void {
  if (!Array.isArray(blocks)) return;

  for (const value of blocks) {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.type !== "string"
    ) {
      continue;
    }

    const block = value as PlanBlockLike;
    visit(value as PlanBlock);
    if (block.type !== "tabs" && block.type !== "columns") continue;
    if (!isRecord(block.data)) continue;

    const collection = block.data[block.type === "tabs" ? "tabs" : "columns"];
    if (!Array.isArray(collection)) continue;

    for (const region of collection) {
      if (!isRecord(region) || !Array.isArray(region.blocks)) continue;
      visitPlanBlocks(region.blocks, visit);
    }
  }
}

export function nestedPlanBlockLists(block: unknown): unknown[] {
  if (!isRecord(block) || (block.type !== "tabs" && block.type !== "columns")) {
    return [];
  }
  if (!isRecord(block.data)) return [];

  const regions = block.data[block.type === "tabs" ? "tabs" : "columns"];
  if (!Array.isArray(regions)) return [];
  return regions.flatMap((region) => (isRecord(region) ? [region.blocks] : []));
}

export function isWideLayoutBlock(block: PlanBlock): boolean {
  switch (block.type) {
    case "diff":
    case "annotated-code":
      return true;
    case "tabs":
      return (
        block.data?.orientation === "vertical" ||
        nestedPlanBlockLists(block).some(blocksContainDiffLike)
      );
    default:
      return false;
  }
}

function blocksContainDiffLike(blocks: unknown): boolean {
  let found = false;
  visitPlanBlocks(blocks, (block) => {
    if (block.type === "diff" || block.type === "annotated-code") found = true;
  });
  return found;
}
