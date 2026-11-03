/**
 * How many bytes from the start of an uploaded file identify it. The server
 * hashes the first upload chunk and the desktop tray hashes the saved file, so
 * both sides must hash the same span: this many bytes, or the whole file when
 * it is shorter.
 */
export const SOURCE_HEAD_BYTES = 1024 * 1024;

export const SOURCE_HEAD_SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Hex SHA-256 of a file's first `SOURCE_HEAD_BYTES` (or all of a shorter file). */
export async function sourceHeadSha256(head: Uint8Array): Promise<string> {
  const span = head.subarray(0, SOURCE_HEAD_BYTES);
  const digest = await crypto.subtle.digest("SHA-256", span);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
