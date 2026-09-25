import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import type { DesktopContentFilesRepository } from "@shared/ipc-channels";

function git(folder: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", folder, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // coercion-ok: a folder that is not a readable Git worktree has no repository identity
    return null;
  }
}

/**
 * Returns display-only Git metadata. The local path remains Desktop-owned and
 * is intentionally excluded from this value.
 */
export function deriveContentFilesRepositoryIdentity(
  folder: string,
): DesktopContentFilesRepository | undefined {
  const root = git(folder, ["rev-parse", "--show-toplevel"]);
  const commonDir = git(folder, ["rev-parse", "--git-common-dir"]);
  const commit = git(folder, ["rev-parse", "HEAD"]);
  if (!root || !commonDir || !commit) return undefined;

  const branch = git(folder, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const resolvedCommonDir = path.resolve(root, commonDir);
  return {
    localId: createHash("sha256").update(resolvedCommonDir).digest("base64url"),
    ...(branch ? { branch } : { detached: true }),
    commit,
  };
}
