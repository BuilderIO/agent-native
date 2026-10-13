// Chunked slice equality compares like memcmp; a charCodeAt loop over a large
// screen costs ~10ms per edit.
const DIFF_CHUNK_CHARS = 4096;

export function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (
    length + DIFF_CHUNK_CHARS <= limit &&
    left.slice(length, length + DIFF_CHUNK_CHARS) ===
      right.slice(length, length + DIFF_CHUNK_CHARS)
  ) {
    length += DIFF_CHUNK_CHARS;
  }
  while (
    length < limit &&
    left.charCodeAt(length) === right.charCodeAt(length)
  ) {
    length += 1;
  }
  return length;
}

export function commonSuffixLength(
  left: string,
  right: string,
  limit: number,
): number {
  let length = 0;
  while (
    length + DIFF_CHUNK_CHARS <= limit &&
    left.slice(
      left.length - length - DIFF_CHUNK_CHARS,
      left.length - length,
    ) ===
      right.slice(
        right.length - length - DIFF_CHUNK_CHARS,
        right.length - length,
      )
  ) {
    length += DIFF_CHUNK_CHARS;
  }
  while (
    length < limit &&
    left.charCodeAt(left.length - 1 - length) ===
      right.charCodeAt(right.length - 1 - length)
  ) {
    length += 1;
  }
  return length;
}
