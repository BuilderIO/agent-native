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

export function canRetainNativePresentationAfterFailure<Context>(
  pair: NativePresentationPair<Context> | null,
  previousCanvas: HTMLCanvasElement,
  submitted: boolean,
  detachedPresentation: boolean,
): boolean {
  return (
    !submitted ||
    detachedPresentation ||
    (pair !== null && pair.visible().canvas === previousCanvas)
  );
}

export function isNativePresentationPairSwap<Context>(
  record: MutationRecord,
  pair: {
    visible(): NativePresentationSurface<Context>;
    surfaces(): readonly NativePresentationSurface<Context>[];
  },
): boolean {
  if (record.type !== "childList") return false;
  const front = pair.visible().canvas;
  const hidden = pair
    .surfaces()
    .filter((surface) => surface.canvas !== front)
    .map((surface) => surface.canvas);
  if (!front.isConnected || hidden.some((canvas) => canvas.isConnected))
    return false;
  const changed = [...record.addedNodes, ...record.removedNodes];
  if (changed.length === 0 || changed.length > 2) return false;
  return (
    [...record.addedNodes].every((node) => node === front) &&
    [...record.removedNodes].every((node) =>
      hidden.includes(node as HTMLCanvasElement),
    )
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
