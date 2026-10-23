import { createHash } from "node:crypto";

import { parseStoredChapters } from "../../shared/stored-chapters.js";

/**
 * A short token for a recording's chapters, read the way the player reads
 * them. The agent passes it back to set-chapters as `expectedVersion`:
 * copying a token is exact where re-typing a list of titles is not.
 */
export function chaptersVersionOf(
  chaptersJson: string | null | undefined,
): string {
  return createHash("sha256")
    .update(JSON.stringify(parseStoredChapters(chaptersJson)))
    .digest("hex")
    .slice(0, 16);
}
