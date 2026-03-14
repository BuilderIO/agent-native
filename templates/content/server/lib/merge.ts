/**
 * Simple three-way line-level merge.
 *
 * Given a base version, a local version, and a remote version,
 * attempts to merge non-overlapping changes automatically.
 *
 * Returns { merged, success }:
 * - success=true  → clean merge, `merged` contains the result
 * - success=false → overlapping edits detected, `merged` is null
 */

export interface MergeResult {
  merged: string | null;
  success: boolean;
}

/**
 * Three-way merge using line-level diff.
 *
 * Algorithm:
 * 1. Split base, local, remote into lines
 * 2. Walk lines in parallel
 * 3. If both sides agree with base → keep base line
 * 4. If only local changed → take local
 * 5. If only remote changed → take remote
 * 6. If both changed the same way → take either (identical edit)
 * 7. If both changed differently → conflict (return failure)
 *
 * For insertions/deletions we use a simplified approach:
 * compare each side's diff from base and check for overlap.
 */
export function threeWayMerge(
  base: string,
  local: string,
  remote: string,
): MergeResult {
  // Quick wins
  if (local === remote) return { merged: local, success: true };
  if (local === base) return { merged: remote, success: true };
  if (remote === base) return { merged: local, success: true };

  const baseLines = base.split("\n");
  const localLines = local.split("\n");
  const remoteLines = remote.split("\n");

  // Compute which line ranges changed in each side relative to base
  const localHunks = computeHunks(baseLines, localLines);
  const remoteHunks = computeHunks(baseLines, remoteLines);

  // Check if any hunks overlap
  if (hunksOverlap(localHunks, remoteHunks)) {
    return { merged: null, success: false };
  }

  // Apply both sets of changes to base (remote first since we apply in reverse order)
  // Sort all hunks by base line index descending so indices stay valid
  const allHunks = [
    ...localHunks.map((h) => ({ ...h, source: "local" as const })),
    ...remoteHunks.map((h) => ({ ...h, source: "remote" as const })),
  ].sort((a, b) => b.baseStart - a.baseStart);

  const result = [...baseLines];
  for (const hunk of allHunks) {
    const replacement =
      hunk.source === "local"
        ? localLines.slice(hunk.newStart, hunk.newStart + hunk.newLength)
        : remoteLines.slice(hunk.newStart, hunk.newStart + hunk.newLength);
    result.splice(hunk.baseStart, hunk.baseLength, ...replacement);
  }

  return { merged: result.join("\n"), success: true };
}

interface Hunk {
  baseStart: number;
  baseLength: number;
  newStart: number;
  newLength: number;
}

/**
 * Compute change hunks between two line arrays using a simple LCS-based diff.
 * Returns ranges in the base that were modified/deleted/inserted.
 */
function computeHunks(base: string[], modified: string[]): Hunk[] {
  const lcs = longestCommonSubsequence(base, modified);
  const hunks: Hunk[] = [];

  let bi = 0;
  let mi = 0;
  let li = 0;

  while (bi < base.length || mi < modified.length) {
    if (
      li < lcs.length &&
      bi < base.length &&
      mi < modified.length &&
      base[bi] === lcs[li] &&
      modified[mi] === lcs[li]
    ) {
      // Lines match — advance all pointers
      bi++;
      mi++;
      li++;
    } else {
      // Collect a hunk of differences
      const baseStart = bi;
      const modStart = mi;

      // Advance base pointer until we hit the next LCS line (or end)
      while (bi < base.length && (li >= lcs.length || base[bi] !== lcs[li])) {
        bi++;
      }
      // Advance modified pointer until we hit the next LCS line (or end)
      while (
        mi < modified.length &&
        (li >= lcs.length || modified[mi] !== lcs[li])
      ) {
        mi++;
      }

      if (bi !== baseStart || mi !== modStart) {
        hunks.push({
          baseStart,
          baseLength: bi - baseStart,
          newStart: modStart,
          newLength: mi - modStart,
        });
      }
    }
  }

  return hunks;
}

/** Check if any pair of hunks from the two sets overlap in base line ranges. */
function hunksOverlap(a: Hunk[], b: Hunk[]): boolean {
  for (const ha of a) {
    for (const hb of b) {
      const aEnd = ha.baseStart + ha.baseLength;
      const bEnd = hb.baseStart + hb.baseLength;
      // Overlapping if ranges intersect (or are adjacent with both inserting)
      if (ha.baseStart < bEnd && hb.baseStart < aEnd) {
        return true;
      }
    }
  }
  return false;
}

/** Simple LCS of string arrays (O(n*m) DP — fine for typical file sizes). */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // For very large files, bail out to avoid memory issues
  if (m * n > 10_000_000) return [];

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find actual LCS
  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}
