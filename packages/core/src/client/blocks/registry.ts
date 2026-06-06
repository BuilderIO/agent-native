import type { BlockSpec, BlockPlacement } from "./types.js";

/**
 * In-memory block registry. Holds two lookups: by runtime `type` (render +
 * serialize side) and by MDX `tag` (parse side). The registry is a plain object
 * usable both inside React (via the context provider) and outside it (the
 * server MDX serializer/parser, agent schema export) — mirroring how the legacy
 * `BLOCK_COMPONENTS` set and `serializeBlock`/`parseBlock` are plain functions.
 */
export class BlockRegistry {
  private byType = new Map<string, BlockSpec<any>>();
  private byTag = new Map<string, BlockSpec<any>>();

  register(spec: BlockSpec<any>): void {
    if (this.byType.has(spec.type)) {
      throw new Error(`Block type "${spec.type}" is already registered.`);
    }
    if (this.byTag.has(spec.mdx.tag)) {
      throw new Error(`Block MDX tag "${spec.mdx.tag}" is already registered.`);
    }
    this.byType.set(spec.type, spec);
    this.byTag.set(spec.mdx.tag, spec);
  }

  get(type: string): BlockSpec<any> | undefined {
    return this.byType.get(type);
  }

  getByTag(tag: string): BlockSpec<any> | undefined {
    return this.byTag.get(tag);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  hasTag(tag: string): boolean {
    return this.byTag.has(tag);
  }

  /** All registered MDX tags — replaces the hardcoded `BLOCK_COMPONENTS` set. */
  tags(): Set<string> {
    return new Set(this.byTag.keys());
  }

  /** All registered specs, optionally filtered by placement. */
  list(placement?: BlockPlacement): BlockSpec<any>[] {
    const all = [...this.byType.values()];
    return placement
      ? all.filter((spec) => spec.placement.includes(placement))
      : all;
  }
}

/** Register a batch of specs in order. */
export function registerBlocks(
  registry: BlockRegistry,
  specs: BlockSpec<any>[],
): void {
  for (const spec of specs) registry.register(spec);
}
