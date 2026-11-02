import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type WorktreeState = {
  dirty: boolean;
  locked: boolean;
  inUse: boolean;
  idleHours: number;
  // `null` means we could not tell, which must never read as "safe to delete".
  published: boolean | null;
};

/** Why this worktree must stay, or `null` when it is safe to remove. */
export function keepReason(s: WorktreeState, minIdleHours: number): string | null {
  if (s.locked) return "locked";
  if (s.inUse) return "a process is running in it";
  if (s.dirty) return "uncommitted changes";
  if (s.published === null) return "could not check whether its commits are pushed";
  if (!s.published) return "commits not pushed or merged anywhere";
  if (s.idleHours < minIdleHours) return `touched ${s.idleHours.toFixed(1)}h ago`;
  return null;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

function tryGit(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

/** Only agent-made worktrees: `~/.codex/worktrees/*` and `<repo>/.claude/worktrees/*`. */
export function isAgentWorktree(p: string, home = os.homedir()): boolean {
  return (
    p.startsWith(path.join(home, ".codex", "worktrees") + path.sep) ||
    p.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`)
  );
}

function isPublished(wt: string, branch: string | null): boolean | null {
  const unpushed = tryGit(wt, "rev-list", "HEAD", "--not", "--remotes", "--count");
  if (unpushed === null) return null;
  if (unpushed.trim() === "0") return true;
  // Squash merges leave the branch's commits off every remote ref.
  if (!branch) return false;
  const head = tryGit(wt, "rev-parse", "HEAD")?.trim();
  try {
    const out = execFileSync(
      "gh",
      ["pr", "list", "--head", branch, "--state", "merged", "--json", "headRefOid"],
      { cwd: wt, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return (JSON.parse(out) as { headRefOid: string }[]).some((p) => p.headRefOid === head);
  } catch {
    return null;
  }
}

// `null` means lsof failed: every worktree then counts as in use.
function busyDirs(): string[] | null {
  try {
    const out = execFileSync("lsof", ["-w", "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split("\n").filter((l) => l.startsWith("n")).map((l) => l.slice(1));
  } catch {
    return null;
  }
}

export function main(argv = process.argv.slice(2)): number {
  const apply = argv.includes("--apply");
  const idleArg = argv.find((a) => a.startsWith("--min-idle-hours="));
  const minIdle = idleArg ? Number(idleArg.split("=")[1]) : 6;
  const repo = process.cwd();
  const self = tryGit(repo, "rev-parse", "--show-toplevel")?.trim();
  if (!self) {
    console.error("prune-worktrees: not inside a git repository");
    return 2;
  }
  tryGit(self, "fetch", "--quiet", "origin");
  const entries = git(self, "worktree", "list", "--porcelain").split("\n\n").filter(Boolean);
  const busy = busyDirs();
  let removed = 0;
  for (const entry of entries) {
    const field = (k: string) => entry.split("\n").find((l) => l.startsWith(k))?.slice(k.length + 1);
    const wt = field("worktree");
    if (!wt || wt === self || !isAgentWorktree(wt)) continue;
    let mtime: number;
    try {
      mtime = statSync(wt).mtimeMs;
      const gitDir = tryGit(wt, "rev-parse", "--git-dir")?.trim();
      if (gitDir) mtime = Math.max(mtime, statSync(path.resolve(wt, gitDir, "index")).mtimeMs);
    } catch {
      continue; // `git worktree prune` below handles directories that are gone
    }
    const branch = field("branch")?.replace("refs/heads/", "") ?? null;
    const status = tryGit(wt, "status", "--porcelain");
    const reason = keepReason(
      {
        dirty: status === null || status.trim() !== "",
        locked: entry.includes("\nlocked"),
        inUse: busy === null || busy.some((d) => d === wt || d.startsWith(wt + path.sep)),
        idleHours: (Date.now() - mtime) / 3_600_000,
        published: isPublished(wt, branch),
      },
      minIdle,
    );
    if (reason) {
      console.log(`keep   ${wt}: ${reason}`);
      continue;
    }
    console.log(`${apply ? "remove" : "would remove"} ${wt}`);
    if (apply) {
      git(self, "worktree", "remove", wt);
      removed++;
    }
  }
  if (apply) tryGit(self, "worktree", "prune");
  console.log(apply ? `removed ${removed}` : "dry run: pass --apply to remove");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
