import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type WorktreeState = {
  dirty: boolean;
  locked: boolean;
  // `null` means lsof could not run.
  inUse: boolean | null;
  idleHours: number;
  // `null` means we could not tell, which must never read as "safe to delete".
  published: boolean | null;
};

/** Why this worktree must stay, or `null` when it is safe to remove. */
export function keepReason(
  s: WorktreeState,
  minIdleHours: number,
): string | null {
  if (s.locked) return "locked";
  if (s.inUse === null) return "could not check for running processes";
  if (s.inUse) return "a process is running in it";
  if (s.dirty) return "uncommitted changes";
  if (s.published === null)
    return "could not check whether its commits are pushed";
  if (!s.published) return "commits not pushed or merged anywhere";
  if (s.idleHours < minIdleHours)
    return `touched ${s.idleHours.toFixed(1)}h ago`;
  return null;
}

// Ignored build output can be regenerated; any other ignored file (.env,
// scratch notes) may be the only copy, so it keeps the worktree.
const REGENERABLE = new Set([
  "node_modules",
  "dist",
  "build",
  ".turbo",
  ".next",
  ".react-router",
  ".cache",
  ".generated",
  "coverage",
  ".netlify",
  ".vite",
  ".nitro",
  ".output",
]);

// `.tmp` holds repo-local scratch that may be the only copy, so it keeps the
// worktree unless the caller passes --discard-tmp.
export function hasUserFiles(status: string, discardTmp = false): boolean {
  return status.split("\n").some((line) => {
    if (!line.trim()) return false;
    if (!line.startsWith("!! ")) return true;
    const last = line.slice(3).replace(/\/$/, "").split("/").pop() ?? "";
    return !(REGENERABLE.has(last) || (discardTmp && last === ".tmp"));
  });
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

function tryGit(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch {
    // coercion-ok: null means unreadable; callers keep the worktree
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
  const unpushed = tryGit(
    wt,
    "rev-list",
    "HEAD",
    "--not",
    "--remotes=origin",
    "--count",
  );
  if (unpushed === null) return null;
  if (unpushed.trim() === "0") return true;
  // Squash merges leave the branch's commits off every remote ref.
  if (!branch) return false;
  const head = tryGit(wt, "rev-parse", "HEAD")?.trim();
  try {
    const out = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "merged",
        "--json",
        "headRefOid",
      ],
      { cwd: wt, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return (JSON.parse(out) as { headRefOid: string }[]).some(
      (p) => p.headRefOid === head,
    );
  } catch {
    // coercion-ok: null means unreadable; keepReason keeps the worktree
    return null;
  }
}

// Read fresh at every check: activity between the dry-run pass and removal
// must reset the idle clock.
function lastTouched(wt: string): number | null {
  try {
    const gitDir = path.resolve(
      wt,
      tryGit(wt, "rev-parse", "--git-dir")?.trim() ?? "",
    );
    // Edits to tracked files make the tree dirty, so what must show here is
    // clean-but-recent work: a fresh commit, checkout, or index refresh.
    const commitMs =
      Number(tryGit(wt, "log", "-1", "--format=%ct", "HEAD")?.trim()) * 1000;
    if (!Number.isFinite(commitMs)) return null;
    return Math.max(
      commitMs,
      statSync(wt).mtimeMs,
      statSync(path.join(gitDir, "index")).mtimeMs,
      statSync(path.join(gitDir, "logs", "HEAD")).mtimeMs,
    );
  } catch {
    // coercion-ok: null means unreadable; check() keeps the worktree
    return null;
  }
}

// Open files as well as cwds, so an editor with the worktree open counts.
// `null` means lsof failed: every worktree then counts as in use.
function busyDirs(): string[] | null {
  try {
    const out = execFileSync("lsof", ["-w", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return out
      .split("\n")
      .filter((l) => l.startsWith("n"))
      .map((l) => l.slice(1));
  } catch {
    // coercion-ok: null means lsof failed; every worktree counts as unchecked
    return null;
  }
}

export function main(argv = process.argv.slice(2)): number {
  const apply = argv.includes("--apply");
  const idleArg = argv.find((a) => a.startsWith("--min-idle-hours="));
  const minIdle = idleArg ? Number(idleArg.split("=")[1]) : 6;
  if (!Number.isFinite(minIdle) || minIdle < 0) {
    console.error(
      "prune-worktrees: --min-idle-hours must be a non-negative number",
    );
    return 2;
  }
  const repo = process.cwd();
  const self = tryGit(repo, "rev-parse", "--show-toplevel")?.trim();
  if (!self) {
    console.error("prune-worktrees: not inside a git repository");
    return 2;
  }
  // Stale or unpruned remote refs could make unpublished work look pushed.
  if (tryGit(self, "fetch", "--quiet", "--prune", "origin") === null) {
    console.error(
      "prune-worktrees: fetch failed; refusing to judge from stale refs",
    );
    return 2;
  }
  const entries = git(self, "worktree", "list", "--porcelain")
    .split("\n\n")
    .filter(Boolean);
  const busy = busyDirs();
  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    const field = (k: string) =>
      entry
        .split("\n")
        .find((l) => l.startsWith(k))
        ?.slice(k.length + 1);
    const wt = field("worktree");
    if (!wt || wt === self || !isAgentWorktree(wt)) continue;
    const branch = field("branch")?.replace("refs/heads/", "") ?? null;
    // Re-run right before removal: a process or new work may have appeared.
    const check = (busyNow: string[] | null) => {
      const touched = lastTouched(wt);
      if (touched === null) return "could not read its timestamps";
      const status = tryGit(wt, "status", "--porcelain", "--ignored=matching");
      return keepReason(
        {
          dirty:
            status === null ||
            hasUserFiles(status, argv.includes("--discard-tmp")),
          locked: entry.includes("\nlocked"),
          inUse:
            busyNow === null
              ? null
              : busyNow.some((d) => d === wt || d.startsWith(wt + path.sep)),
          idleHours: (Date.now() - touched) / 3_600_000,
          published: isPublished(wt, branch),
        },
        minIdle,
      );
    };
    const reason = check(busy);
    if (reason) {
      console.log(`keep   ${wt}: ${reason}`);
      continue;
    }
    console.log(`${apply ? "remove" : "would remove"} ${wt}`);
    if (apply) {
      const again = check(busyDirs());
      if (again) {
        console.log(`keep   ${wt}: ${again}`);
        continue;
      }
      try {
        git(self, "worktree", "remove", wt);
        removed++;
      } catch {
        console.error(`failed ${wt}: git worktree remove refused`);
        failed++;
      }
    }
  }
  if (apply && tryGit(self, "worktree", "prune") === null) failed++;
  console.log(apply ? `removed ${removed}` : "dry run: pass --apply to remove");
  return failed > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main());
}
