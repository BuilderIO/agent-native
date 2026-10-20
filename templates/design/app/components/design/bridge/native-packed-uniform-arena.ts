export type NativePackedUniformFrame = symbol;

export interface NativePackedUniformBinding<Buffer> {
  readonly buffer: Buffer;
  readonly offset: number;
  readonly size: number;
}

export class NativePackedUniformArenaError extends Error {
  constructor(
    readonly code:
      | "uniform-arena-invalid-layout"
      | "uniform-arena-capacity-exceeded"
      | "uniform-arena-frame-active"
      | "uniform-arena-frame-stale"
      | "uniform-arena-frame-closed"
      | "uniform-arena-duplicate-draw"
      | "uniform-arena-binding-size-changed"
      | "uniform-arena-empty-frame",
  ) {
    super(code);
    this.name = "NativePackedUniformArenaError";
  }
}

export class NativePackedUniformArena<Buffer> {
  private readonly staging: Uint8Array;
  private readonly slots = new Map<
    string,
    { binding: NativePackedUniformBinding<Buffer>; byteLength: number }
  >();
  private readonly written = new Set<string>();
  private allocatedEnd = 0;
  private writtenEnd = 0;
  private frame: NativePackedUniformFrame | null = null;
  private phase: "recording" | "uploaded" | "failed" | null = null;

  constructor(
    private readonly options: {
      buffer: Buffer;
      capacityBytes: number;
      alignment: number;
      upload: (buffer: Buffer, bytes: Uint8Array) => void;
    },
  ) {
    this.options = Object.freeze({ ...options });
    const { capacityBytes, alignment } = this.options;
    if (
      !Number.isSafeInteger(capacityBytes) ||
      capacityBytes <= 0 ||
      capacityBytes % 4 !== 0 ||
      !Number.isSafeInteger(alignment) ||
      alignment < 4 ||
      alignment % 4 !== 0
    )
      throw new NativePackedUniformArenaError("uniform-arena-invalid-layout");
    this.staging = new Uint8Array(capacityBytes);
  }

  beginFrame(): NativePackedUniformFrame {
    if (this.frame !== null)
      throw new NativePackedUniformArenaError("uniform-arena-frame-active");
    this.frame = Symbol("native-uniform-frame");
    this.phase = "recording";
    this.written.clear();
    this.writtenEnd = 0;
    return this.frame;
  }

  write(
    frame: NativePackedUniformFrame,
    drawKey: string,
    bytes: ArrayBufferView,
  ): NativePackedUniformBinding<Buffer> {
    this.assertFrame(frame);
    if (this.phase !== "recording")
      throw new NativePackedUniformArenaError("uniform-arena-frame-closed");
    if (!drawKey || bytes.byteLength === 0 || bytes.byteLength % 4 !== 0)
      throw new NativePackedUniformArenaError("uniform-arena-invalid-layout");
    if (this.written.has(drawKey))
      throw new NativePackedUniformArenaError("uniform-arena-duplicate-draw");
    let slot = this.slots.get(drawKey);
    if (slot && slot.byteLength !== bytes.byteLength)
      throw new NativePackedUniformArenaError(
        "uniform-arena-binding-size-changed",
      );
    if (!slot) {
      const offset =
        Math.ceil(this.allocatedEnd / this.options.alignment) *
        this.options.alignment;
      const size = Math.ceil(bytes.byteLength / 16) * 16;
      const end = offset + size;
      if (!Number.isSafeInteger(end) || end > this.staging.byteLength)
        throw new NativePackedUniformArenaError(
          "uniform-arena-capacity-exceeded",
        );
      slot = {
        binding: Object.freeze({ buffer: this.options.buffer, offset, size }),
        byteLength: bytes.byteLength,
      };
      this.slots.set(drawKey, slot);
      this.allocatedEnd = end;
    }
    const { offset, size } = slot.binding;
    this.staging.fill(0, offset, offset + size);
    this.staging.set(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      offset,
    );
    this.written.add(drawKey);
    this.writtenEnd = Math.max(this.writtenEnd, offset + size);
    return slot.binding;
  }

  upload(frame: NativePackedUniformFrame): void {
    this.assertFrame(frame);
    if (this.phase !== "recording")
      throw new NativePackedUniformArenaError("uniform-arena-frame-closed");
    if (!this.writtenEnd)
      throw new NativePackedUniformArenaError("uniform-arena-empty-frame");
    this.phase = "failed";
    this.options.upload(
      this.options.buffer,
      this.staging.subarray(0, this.writtenEnd),
    );
    this.assertFrame(frame);
    this.phase = "uploaded";
  }

  // All encoded consumers must be submitted before this arena can be written again.
  finishFrame(frame: NativePackedUniformFrame): void {
    this.assertFrame(frame);
    if (this.phase !== "uploaded")
      throw new NativePackedUniformArenaError("uniform-arena-frame-closed");
    this.frame = null;
    this.phase = null;
  }

  // Abort is safe only when no command buffer consuming this frame was submitted.
  abortFrame(frame: NativePackedUniformFrame): void {
    this.assertFrame(frame);
    this.frame = null;
    this.phase = null;
  }

  private assertFrame(frame: NativePackedUniformFrame): void {
    if (this.frame !== frame)
      throw new NativePackedUniformArenaError("uniform-arena-frame-stale");
  }
}
