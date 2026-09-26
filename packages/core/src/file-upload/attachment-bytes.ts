
export type SniffedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export type SniffedMediaType = SniffedImageMediaType | "application/pdf";

const HEAD_BASE64_CHARS = 64;
const TAIL_BASE64_CHARS = 1024;

const CANONICAL_BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return CANONICAL_BASE64_RE.test(value);
}

function decodedByteLength(base64: string): number {
  let padding = 0;
  if (base64.endsWith("==")) padding = 2;
  else if (base64.endsWith("=")) padding = 1;
  return (base64.length / 4) * 3 - padding;
}

function decodeHead(base64: string): Uint8Array {
  const head = base64.slice(0, HEAD_BASE64_CHARS);
  const aligned = head.slice(0, head.length - (head.length % 4));
  return new Uint8Array(Buffer.from(aligned, "base64"));
}

function decodeTail(base64: string): Uint8Array {
  const start = Math.max(0, base64.length - TAIL_BASE64_CHARS);
  const aligned = start + ((4 - (start % 4)) % 4);
  return new Uint8Array(Buffer.from(base64.slice(aligned), "base64"));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

function endsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  const offset = bytes.length - signature.length;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function includesSequence(
  bytes: Uint8Array,
  sequence: readonly number[],
): boolean {
  outer: for (let i = 0; i <= bytes.length - sequence.length; i += 1) {
    for (let k = 0; k < sequence.length; k += 1) {
      if (bytes[i + k] !== sequence[k]) continue outer;
    }
    return true;
  }
  return false;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_IHDR = [0x49, 0x48, 0x44, 0x52] as const;
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const JPEG_EOI = [0xff, 0xd9] as const;
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38] as const;
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50] as const;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46] as const;
const PDF_EOF = [0x25, 0x25, 0x45, 0x4f, 0x46] as const;

export function sniffAttachmentMediaType(
  base64: string | undefined,
): SniffedMediaType | null {
  if (typeof base64 !== "string" || !isCanonicalBase64(base64)) return null;
  const head = decodeHead(base64);
  if (head.length === 0) return null;
  if (startsWith(head, PNG_SIGNATURE)) {
    return PNG_IHDR.every((byte, i) => head[12 + i] === byte)
      ? "image/png"
      : null;
  }
  if (startsWith(head, JPEG_SIGNATURE)) return "image/jpeg";
  if (startsWith(head, GIF_SIGNATURE)) return "image/gif";
  if (startsWith(head, PDF_SIGNATURE)) return "application/pdf";
  if (startsWith(head, RIFF_SIGNATURE) && head.length >= 12) {
    return WEBP_TAG.every((byte, i) => head[8 + i] === byte)
      ? "image/webp"
      : null;
  }
  return null;
}

function isTruncated(base64: string, mediaType: SniffedMediaType): boolean {
  if (mediaType === "image/webp") {
    const head = decodeHead(base64);
    if (head.length < 8) return true;
    const declared =
      (head[4]! | (head[5]! << 8) | (head[6]! << 16) | (head[7]! << 24)) >>> 0;
    return declared + 8 > decodedByteLength(base64);
  }

  const tail = decodeTail(base64);
  if (tail.length === 0) return true;
  switch (mediaType) {
    case "image/png":
      return !endsWith(tail, PNG_IEND);
    case "image/gif":
      return tail[tail.length - 1] !== 0x3b;
    case "image/jpeg":
      return !includesSequence(tail, JPEG_EOI);
    case "application/pdf":
      return !includesSequence(tail, PDF_EOF);
  }
}

export type AttachmentBytesVerdict<M extends SniffedMediaType> =
  | { kind: "ok"; mediaType: M }
  | { kind: "undecodable"; declared: string }
  | { kind: "truncated"; mediaType: SniffedMediaType }
  | { kind: "wrong-kind"; declared: string; actual: SniffedMediaType };

export type AttachmentBytesRejection = Exclude<
  AttachmentBytesVerdict<SniffedMediaType>,
  { kind: "ok" }
>;

export function reconcileImageBytes(input: {
  base64: string | undefined;
  declared: string;
}): AttachmentBytesVerdict<SniffedImageMediaType> {
  const actual = sniffAttachmentMediaType(input.base64);
  if (actual === null) return { kind: "undecodable", declared: input.declared };
  if (actual === "application/pdf") {
    return { kind: "wrong-kind", declared: input.declared, actual };
  }
  if (isTruncated(input.base64!, actual)) {
    return { kind: "truncated", mediaType: actual };
  }
  return { kind: "ok", mediaType: actual };
}

export function reconcilePdfBytes(input: {
  base64: string | undefined;
  declared: string;
}): AttachmentBytesVerdict<"application/pdf"> {
  const actual = sniffAttachmentMediaType(input.base64);
  if (actual === null) return { kind: "undecodable", declared: input.declared };
  if (actual !== "application/pdf") {
    return { kind: "wrong-kind", declared: input.declared, actual };
  }
  if (isTruncated(input.base64!, actual)) {
    return { kind: "truncated", mediaType: actual };
  }
  return { kind: "ok", mediaType: actual };
}

export function describeAttachmentBytesVerdict(
  verdict: AttachmentBytesRejection,
): string {
  switch (verdict.kind) {
    case "undecodable":
      return `its contents are not a JPEG, PNG, GIF, WebP, or PDF file despite being labelled ${verdict.declared}`;
    case "truncated":
      return `the ${verdict.mediaType} data is incomplete, which usually means the upload was cut short`;
    case "wrong-kind":
      return `it is labelled ${verdict.declared} but actually contains ${verdict.actual} data`;
  }
}
