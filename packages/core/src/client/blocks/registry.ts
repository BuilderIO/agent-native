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

  /**
   * Register (or re-register) a block spec. Last registration wins: re-registering
   * an existing block `type` (or MDX `tag`) OVERRIDES the previous spec rather than
   * throwing. This lets an app intentionally override a shared library block with
   * its own variant, and makes module-level registration idempotent under dev HMR
   * (which can re-run a registration module against a registry that survived the
   * reload). When a re-registered type changes its MDX tag, the stale tag mapping
   * is dropped so `getByTag` can't return an orphaned spec.
   */
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

  /** All registered MDX tags — replaces the hardcoded `BLOCK_COMPONENTS` set. */
  tags(): Set<string> {
    return new Set(this.byTag.keys());
  }

  /**
   * The set of registered block `type`s whose specs declare
   * `notionCompatible: true` — i.e. they round-trip to Notion-Flavored Markdown
   * and may sync to Notion. Apps use this as the registry-backed part of their
   * Notion gating allowlist; prose-only NFM analogs that are not registry atoms
   * (rich-text, callout) are NOT in here — apps union those in separately.
   */
  notionCompatibleTypes(): Set<string> {
    const types = new Set<string>();
    for (const spec of this.byType.values()) {
      if (spec.notionCompatible) types.add(spec.type);
    }
    return types;
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
