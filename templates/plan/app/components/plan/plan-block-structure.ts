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
  return current !== null && next !== null && current !== next;
}
