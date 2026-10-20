export class NativeFrameResourceScratch<Texture> {
  readonly scratch: Map<string, Texture>;
  private settled = false;

  constructor(
    readonly committed: Map<string, Texture>,
    keep: readonly string[],
  ) {
    this.scratch = new Map(
      keep.flatMap((name) => {
        const texture = committed.get(name);
        return texture === undefined ? [] : [[name, texture] as const];
      }),
    );
  }

  retiredOnCommit(): Texture[] {
    if (this.settled) throw new Error("frame-resources-already-settled");
    const retained = new Set(this.scratch.values());
    return [...new Set(this.committed.values())].filter(
      (texture) => !retained.has(texture),
    );
  }

  commit(): void {
    if (this.settled) throw new Error("frame-resources-already-settled");
    this.settled = true;
  }

  rollback(): Texture[] {
    if (this.settled) throw new Error("frame-resources-already-settled");
    this.settled = true;
    const retained = new Set(this.committed.values());
    return [...new Set(this.scratch.values())].filter(
      (texture) => !retained.has(texture),
    );
  }
}
