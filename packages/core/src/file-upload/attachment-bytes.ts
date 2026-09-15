// Owns: whether an attachment's bytes actually are what its `media_type`
// claims, decided from the bytes rather than from the filename.
//
// A provider validates the block it is given, not the block we meant to send,
// and it rejects the WHOLE request when one image or document block does not
// decode as its declared type. Measured against the Builder gateway: PNG bytes
// labelled `image/jpeg`, a truncated PNG, SVG markup labelled `image/png`, and
// non-PDF bytes inside a `document` block each return
// `reason: invalid_request` with the gateway's opaque
// "Sorry, this was caused by an internal error. ERROR ID: ..." envelope. One
// bad attachment therefore kills every other attachment and the user's text
// along with it.
//
// Browsers derive `File.type` from the extension, so a `.jpg` holding PNG bytes
// is ordinary user data, not a corrupt upload. Trusting the declared label is
// what turns that into a dead turn.

/** Media types every supported vision provider decodes as inline base64. */
export type SniffedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export type SniffedMediaType = SniffedImageMediaType | "application/pdf";

/**
 * Bytes are read from the base64 head/tail only. Decoding a 5 MB attachment in
 * full to read four magic bytes is pure cold-path cost on every turn.
 */
const HEAD_BASE64_CHARS = 64;
const TAIL_BASE64_CHARS = 64;

function decodeHead(base64: string): Uint8Array {
  const head = base64.slice(0, HEAD_BASE64_CHARS);
  const aligned = head.slice(0, head.length - (head.length % 4));
  try {
    return new Uint8Array(Buffer.from(aligned, "base64"));
  } catch {
    return new Uint8Array(0);
  }
}

function decodeTail(base64: string): Uint8Array {
  // base64 encodes 3 bytes per 4 chars, so a tail slice only aligns to byte
  // boundaries when it starts on a multiple of 4 from the string start.
  const start = Math.max(0, base64.length - TAIL_BASE64_CHARS);
  const aligned = start + ((4 - (start % 4)) % 4);
  try {
    return new Uint8Array(Buffer.from(base64.slice(aligned), "base64"));
  } catch {
    return new Uint8Array(0);
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38] as const;
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50] as const;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46] as const;

/**
 * The media type the bytes actually are, or `null` when they match no format a
 * provider accepts inline. `null` covers empty data, text/SVG/HTML markup, and
 * office formats — every shape that has been observed to fail the whole
 * request when labelled as an image.
 */
export function sniffAttachmentMediaType(
  base64: string | undefined,
): SniffedMediaType | null {
  if (typeof base64 !== "string" || base64.length === 0) return null;
  const head = decodeHead(base64);
  if (head.length === 0) return null;
  if (startsWith(head, PNG_SIGNATURE)) return "image/png";
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

function endsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  const offset = bytes.length - signature.length;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

/**
 * Whether the bytes are missing their format's mandatory terminator, which is
 * how a cut-short upload presents. Only formats whose terminator is fixed and
 * spec-mandated are checked: guessing at JPEG or WebP truncation would demote
 * valid images that merely carry trailing metadata, and losing a good image is
 * worse than the rejection this avoids.
 */
function isTruncated(base64: string, mediaType: SniffedMediaType): boolean {
  if (mediaType !== "image/png" && mediaType !== "image/gif") return false;
  const tail = decodeTail(base64);
  if (tail.length === 0) return false;
  if (mediaType === "image/png") return !endsWith(tail, PNG_IEND);
  return tail[tail.length - 1] !== 0x3b;
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

/**
 * Reconcile an image attachment's declared media type against its bytes.
 *
 * On success the verdict carries the SNIFFED type, not the declared one:
 * relabelling is what makes an extension-mismatched screenshot readable
 * instead of fatal.
 */
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

/** Reconcile a document attachment's bytes against the PDF it claims to be. */
export function reconcilePdfBytes(input: {
  base64: string | undefined;
  declared: string;
}): AttachmentBytesVerdict<"application/pdf"> {
  const actual = sniffAttachmentMediaType(input.base64);
  if (actual === null) return { kind: "undecodable", declared: input.declared };
  if (actual !== "application/pdf") {
    return { kind: "wrong-kind", declared: input.declared, actual };
  }
  return { kind: "ok", mediaType: actual };
}

/**
 * Model-visible explanation for a rejected attachment. The model relays this to
 * the user, so it has to name the file's real problem: "unsupported format" for
 * a truncated upload sends the user off converting a file that was fine.
 */
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
