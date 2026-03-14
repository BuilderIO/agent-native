/**
 * Simple three-way line-level merge.
 *
 * Given a base version, a local version, and a remote version,
 * attempts to merge non-overlapping changes automatically.
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
 * 2. Compute change hunks for each side relative to base
 * 3. If hunks don't overlap, apply both sets of changes
 * 4. If hunks overlap, return failure (conflict)
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

  const localHunks = computeHunks(baseLines, localLines);
  const remoteHunks = computeHunks(baseLines, remoteLines);

  if (hunksOverlap(localHunks, remoteHunks)) {
    return { merged: null, success: false };
  }

  // Apply both sets of changes to base (sorted descending so indices stay valid)
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
      bi++;
      mi++;
      li++;
    } else {
      const baseStart = bi;
      const modStart = mi;

      while (
        bi < base.length &&
        (li >= lcs.length || base[bi] !== lcs[li])
      ) {
        bi++;
      }
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

function hunksOverlap(a: Hunk[], b: Hunk[]): boolean {
  for (const ha of a) {
    for (const hb of b) {
      const aEnd = ha.baseStart + ha.baseLength;
      const bEnd = hb.baseStart + hb.baseLength;
      if (ha.baseStart < bEnd && hb.baseStart < aEnd) {
        return true;
      }
    }
  }
  return false;
}

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
