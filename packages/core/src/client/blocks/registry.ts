import type { BlockSpec, BlockPlacement } from "./types.js";

export class BlockRegistry {
  private byType = new Map<string, BlockSpec<any>>();
  private byTag = new Map<string, BlockSpec<any>>();

  register(spec: BlockSpec<any>): void {
    const prevForType = this.byType.get(spec.type);
    if (prevForType && prevForType.mdx.tag !== spec.mdx.tag) {
      this.byTag.delete(prevForType.mdx.tag);
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

  tags(): Set<string> {
    return new Set(this.byTag.keys());
  }

  notionCompatibleTypes(): Set<string> {
    const types = new Set<string>();
    for (const spec of this.byType.values()) {
      if (spec.notionCompatible) types.add(spec.type);
    }
    return types;
  }

  list(placement?: BlockPlacement): BlockSpec<any>[] {
    const all = [...this.byType.values()];
    return placement
      ? all.filter((spec) => spec.placement.includes(placement))
      : all;
  }
}

export function registerBlocks(
  registry: BlockRegistry,
  specs: BlockSpec<any>[],
): void {
  for (const spec of specs) registry.register(spec);
}
