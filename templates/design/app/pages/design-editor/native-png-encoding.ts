export class NativePngEncodingError extends Error {
  constructor(
    readonly code:
      | "invalid-pixels"
      | "compression-unavailable"
      | "encoding-failed"
      | "encoding-timeout",
    message: string,
  ) {
    super(message);
    this.name = "NativePngEncodingError";
  }
}

const MAX_SIDE = 4096;
const MAX_PIXELS = 8_388_608;
const MAX_ENCODED_BYTES = 40_000_000;
const ENCODE_TIMEOUT_MS = 10_000;

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++)
    chunk[index + 4] = type.charCodeAt(index);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < chunk.length - 4; index++)
    crc = crcTable[(crc ^ chunk[index]!) & 255]! ^ (crc >>> 8);
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

export async function encodeStraightRgbaPng(
  pixels: { width: number; height: number; rgba: Uint8Array },
  signal: AbortSignal,
): Promise<Blob> {
  const { width, height, rgba } = pixels;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_SIDE ||
    height > MAX_SIDE ||
    width * height > MAX_PIXELS ||
    !(rgba instanceof Uint8Array) ||
    rgba.byteLength !== width * height * 4
  )
    throw new NativePngEncodingError(
      "invalid-pixels",
      "PNG encoding requires a bounded, complete straight RGBA frame.",
    );
  if (signal.aborted) throw signal.reason;
  if (typeof CompressionStream !== "function")
    throw new NativePngEncodingError(
      "compression-unavailable",
      "The browser cannot compress native PNG pixels.",
    );

  const deadline = performance.now() + ENCODE_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new NativePngEncodingError(
          "encoding-timeout",
          "Native PNG encoding did not finish in time.",
        ),
      ),
    ENCODE_TIMEOUT_MS,
  );
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onEncodingAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", onEncodingAbort, { once: true });
  try {
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header[8] = 8;
    header[9] = 6;
    // PNG stores unassociated samples; a Canvas 2D round trip quantizes partial alpha.
    const parts: Uint8Array<ArrayBuffer>[] = [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", header),
      pngChunk("sRGB", new Uint8Array([0])),
    ];
    let encodedBytes = parts.reduce((sum, part) => sum + part.length, 0);
    let row = 0;
    const stride = width * 4;
    const scanlines = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(stream) {
        if (row === height) {
          stream.close();
          return;
        }
        const end = Math.min(height, row + 32);
        const packet = new Uint8Array((end - row) * (stride + 1));
        for (let offset = 0; row < end; row++, offset += stride + 1)
          packet.set(
            rgba.subarray(row * stride, (row + 1) * stride),
            offset + 1,
          );
        stream.enqueue(packet);
      },
    });
    const compression = scanlines
      .pipeThrough(new CompressionStream("deflate"), {
        signal: controller.signal,
      })
      .pipeTo(
        new WritableStream<Uint8Array>({
          write(bytes) {
            if (encodedBytes + bytes.byteLength + 24 > MAX_ENCODED_BYTES)
              throw new NativePngEncodingError(
                "encoding-failed",
                "Native PNG bytes exceed the export limit.",
              );
            const chunk = pngChunk("IDAT", bytes);
            encodedBytes += chunk.length;
            parts.push(chunk);
          },
        }),
        { signal: controller.signal },
      );
    await Promise.race([compression, aborted]);
    if (controller.signal.aborted) throw controller.signal.reason;
    parts.push(pngChunk("IEND", new Uint8Array()));
    const blob = new Blob(parts, { type: "image/png" });
    if (controller.signal.aborted) throw controller.signal.reason;
    if (performance.now() >= deadline)
      throw new NativePngEncodingError(
        "encoding-timeout",
        "Native PNG encoding did not finish in time.",
      );
    return blob;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof NativePngEncodingError) throw error;
    throw new NativePngEncodingError(
      "encoding-failed",
      `Native PNG compression failed: ${String(error)}`,
    );
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onEncodingAbort);
    signal.removeEventListener("abort", onAbort);
  }
}
