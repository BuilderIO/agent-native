import { imageSize } from "image-size";

export const MAX_EMAIL_IMAGE_BYTES = 5 * 1024 * 1024;

type EmailImageMediaType = "image/png" | "image/jpeg" | "image/gif";

export type EmailImageBytesVerdict =
  | { kind: "valid"; mediaType: EmailImageMediaType }
  | { kind: "invalid" | "truncated" | "unreadable" | "too-large" }
  | { kind: "mime-mismatch"; actual: EmailImageMediaType };

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_END = Buffer.from([73, 69, 78, 68, 174, 66, 96, 130]);
const JPEG_END = Buffer.from([255, 217]);

export async function verifyEmailImageResponse(
  response: Response,
  declaredType: string,
): Promise<EmailImageBytesVerdict> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_EMAIL_IMAGE_BYTES
  ) {
    try {
      await response.body?.cancel();
    } catch {
      return { kind: "unreadable" };
    }
    return { kind: "too-large" };
  }
  const reader = response.body?.getReader();
  if (!reader) return { kind: "invalid" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_EMAIL_IMAGE_BYTES) {
        await reader.cancel();
        return { kind: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "unreadable" };
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, total);
  let format: "png" | "jpg" | "gif";
  let mediaType: EmailImageMediaType;
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    format = "png";
    mediaType = "image/png";
    if (!bytes.subarray(-8).equals(PNG_END)) return { kind: "truncated" };
  } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    format = "jpg";
    mediaType = "image/jpeg";
    if (!bytes.subarray(-1024).includes(JPEG_END)) return { kind: "truncated" };
  } else if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))) {
    format = "gif";
    mediaType = "image/gif";
    if (bytes[bytes.length - 1] !== 59) return { kind: "truncated" };
  } else {
    return { kind: "invalid" };
  }
  try {
    const dimensions = imageSize(bytes);
    if (
      dimensions.type !== format ||
      !Number.isSafeInteger(dimensions.width) ||
      !Number.isSafeInteger(dimensions.height) ||
      dimensions.width <= 0 ||
      dimensions.height <= 0
    )
      return { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
  return mediaType === declaredType
    ? { kind: "valid", mediaType }
    : { kind: "mime-mismatch", actual: mediaType };
}
