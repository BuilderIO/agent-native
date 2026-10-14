export type NativePresentationSurface<Context> = {
  canvas: HTMLCanvasElement;
  context: Context;
};

export class NativePresentationPair<Context> {
  private spare: NativePresentationSurface<Context> | null = null;
  private retired = false;

  constructor(
    private front: NativePresentationSurface<Context>,
    private readonly makeSpare: (
      front: NativePresentationSurface<Context>,
    ) => NativePresentationSurface<Context>,
    private readonly retire: (
      surface: NativePresentationSurface<Context>,
    ) => void,
  ) {}

  visible(): NativePresentationSurface<Context> {
    return this.front;
  }

  surfaces(): readonly NativePresentationSurface<Context>[] {
    return this.spare ? [this.front, this.spare] : [this.front];
  }

  prepare(): NativePresentationSurface<Context> {
    if (this.retired) throw new Error("presentation-pair-retired");
    if (!this.front.canvas.isConnected)
      throw new Error("presentation-front-disconnected");
    if (!this.spare) this.spare = this.makeSpare(this.front);
    const spare = this.spare;
    if (spare.canvas.isConnected || spare.canvas === this.front.canvas)
      throw new Error("presentation-spare-visible");
    spare.canvas.style.cssText = this.front.canvas.style.cssText;
    if (spare.canvas.width !== this.front.canvas.width)
      spare.canvas.width = this.front.canvas.width;
    if (spare.canvas.height !== this.front.canvas.height)
      spare.canvas.height = this.front.canvas.height;
    return spare;
  }

  assertPublishable(
    expectedFront: NativePresentationSurface<Context>,
    validatedSpare: NativePresentationSurface<Context>,
  ): void {
    if (
      this.retired ||
      this.front !== expectedFront ||
      this.spare !== validatedSpare
    )
      throw new Error("presentation-pair-stale");
    if (!expectedFront.canvas.isConnected || validatedSpare.canvas.isConnected)
      throw new Error("presentation-pair-dom-stale");
  }

  publish(
    expectedFront: NativePresentationSurface<Context>,
    validatedSpare: NativePresentationSurface<Context>,
  ): NativePresentationSurface<Context> {
    this.assertPublishable(expectedFront, validatedSpare);
    expectedFront.canvas.replaceWith(validatedSpare.canvas);
    this.front = validatedSpare;
    this.spare = expectedFront;
    return this.front;
  }

  dispose(): void {
    if (this.retired) return;
    this.retired = true;
    const spare = this.spare;
    this.spare = null;
    if (spare) {
      spare.canvas.remove();
      this.retire(spare);
    }
  }
}

export function isNativePresentationPairSwap<Context>(
  record: MutationRecord,
  pair: NativePresentationPair<Context>,
): boolean {
  if (record.type !== "childList") return false;
  const front = pair.visible().canvas;
  const oldFront = pair
    .surfaces()
    .find((surface) => surface.canvas !== front)?.canvas;
  if (!oldFront || !front.isConnected || oldFront.isConnected) return false;
  const changed = [...record.addedNodes, ...record.removedNodes];
  if (changed.length === 0 || changed.length > 2) return false;
  return (
    [...record.addedNodes].every((node) => node === front) &&
    [...record.removedNodes].every((node) => node === oldFront)
  );
}

export function canDetachPresentationFromSources(
  records: readonly { kind: string; nativeInstanceId?: string }[],
): boolean {
  return !records.some(
    (record) =>
      record.kind === "video" ||
      record.kind === "canvas" ||
      !!record.nativeInstanceId,
  );
}
