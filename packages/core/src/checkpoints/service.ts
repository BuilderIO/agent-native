import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TIMEOUT = 10_000;

const CHECKPOINT_ENV = {
  ...process.env,
  GIT_LITERAL_PATHSPECS: "1",
  GIT_AUTHOR_NAME: "agent-native",
  GIT_AUTHOR_EMAIL: "noreply@agent-native.com",
  GIT_COMMITTER_NAME: "agent-native",
  GIT_COMMITTER_EMAIL: "noreply@agent-native.com",
};

export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
    });
    return true;
  } catch {
    return false;
  }
}

export function hasUncommittedChanges(cwd: string): boolean {
  const output = getUncommittedStatus(cwd);
  return output !== null && output.trim().length > 0;
}

export function getUncommittedStatus(cwd: string): string | null {
  try {
    return execFileSync("git", ["status", "--porcelain"], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
      encoding: "utf-8",
    });
  } catch {
    return null;
  }
}

export function createCheckpoint(
  cwd: string,
  message: string,
  paths?: string[],
): string | null {
  try {
    const pathspecs = paths
      ? [
          ...new Set(
            paths
              .map((file) => path.relative(cwd, path.resolve(cwd, file)))
              .filter(
                (file) =>
                  file !== "" &&
                  file !== ".." &&
                  !file.startsWith(`..${path.sep}`),
              ),
          ),
        ]
      : null;
    if (pathspecs && pathspecs.length === 0) return null;

    execFileSync(
      "git",
      pathspecs ? ["add", "--", ...pathspecs] : ["add", "-A"],
      {
        cwd,
        stdio: "pipe",
        timeout: TIMEOUT,
        env: CHECKPOINT_ENV,
      },
    );
    execFileSync(
      "git",
      pathspecs
        ? ["commit", "--only", "-m", message, "--", ...pathspecs]
        : ["commit", "-m", message],
      {
        cwd,
        stdio: "pipe",
        timeout: TIMEOUT,
        env: CHECKPOINT_ENV,
      },
    );
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
      encoding: "utf-8",
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

export function restoreToCheckpoint(cwd: string, sha: string): boolean {
  try {
    // Restore all tracked files to the checkpoint state
    execFileSync("git", ["checkout", sha, "--", "."], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
    });
    // Remove files that were added after the checkpoint
    try {
      const added = execFileSync(
        "git",
        ["diff", "--name-only", "--diff-filter=A", sha, "HEAD"],
        { cwd, stdio: "pipe", timeout: TIMEOUT, encoding: "utf-8" },
      ).trim();
      if (added) {
        for (const file of added.split("\n")) {
          const filePath = path.join(cwd, file);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch {
      // Best-effort cleanup of added files
    }
    return true;
  } catch {
    return false;
  }
}

export function getChangedFileNames(cwd: string): string[] {
  try {
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
      encoding: "utf-8",
    }).trim();
    const unstaged = execFileSync("git", ["diff", "--name-only"], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
      encoding: "utf-8",
    }).trim();
    const untracked = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd, stdio: "pipe", timeout: TIMEOUT, encoding: "utf-8" },
    ).trim();
    const all = [staged, unstaged, untracked].filter(Boolean).join("\n");
    if (!all) return [];
    return [...new Set(all.split("\n").map((f) => f.split("/").pop()!))];
  } catch {
    return [];
  }
}

export function getCurrentHead(cwd: string): string | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
      encoding: "utf-8",
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}
