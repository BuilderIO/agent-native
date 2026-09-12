import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TIMEOUT = 10_000;
const LOCK_STALE_MS = 60_000;

const checkpointEnv = () => ({
  ...process.env,
  GIT_LITERAL_PATHSPECS: "1",
  GIT_AUTHOR_NAME: "agent-native",
  GIT_AUTHOR_EMAIL: "noreply@agent-native.com",
  GIT_COMMITTER_NAME: "agent-native",
  GIT_COMMITTER_EMAIL: "noreply@agent-native.com",
});

function withCheckpointLock<T>(
  cwd: string,
  work: (indexPath: string) => T,
): T | null {
  const indexPath = execFileSync("git", ["rev-parse", "--git-path", "index"], {
    cwd,
    stdio: "pipe",
    timeout: TIMEOUT,
    encoding: "utf-8",
  }).trim();
  const resolvedIndexPath = path.resolve(cwd, indexPath);
  const lockPath = path.join(
    path.dirname(resolvedIndexPath),
    "agent-native-checkpoint.lock",
  );
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          fs.rmdirSync(lockPath);
          continue;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      return null;
    }
  }
  try {
    return work(resolvedIndexPath);
  } finally {
    try {
      fs.rmdirSync(lockPath);
      // coercion-ok: stale checkpoint locks are reclaimed by the next run.
    } catch {}
  }
}

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

    return withCheckpointLock(cwd, (indexPath) => {
      const env = checkpointEnv();
      if (pathspecs) {
        const indexDir = fs.mkdtempSync(
          path.join(path.dirname(indexPath), "agent-native-checkpoint-index-"),
        );
        try {
          const isolatedEnv = {
            ...env,
            GIT_INDEX_FILE: path.join(indexDir, "index"),
          };
          let head: string | null = null;
          try {
            head = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
              cwd,
              stdio: "pipe",
              timeout: TIMEOUT,
              encoding: "utf-8",
              env,
            }).trim();
          } catch {
            execFileSync("git", ["read-tree", "--empty"], {
              cwd,
              stdio: "pipe",
              timeout: TIMEOUT,
              env: isolatedEnv,
            });
          }
          if (head) {
            execFileSync("git", ["read-tree", head], {
              cwd,
              stdio: "pipe",
              timeout: TIMEOUT,
              env: isolatedEnv,
            });
          }
          execFileSync("git", ["add", "--", ...pathspecs], {
            cwd,
            stdio: "pipe",
            timeout: TIMEOUT,
            env: isolatedEnv,
          });
          const tree = execFileSync("git", ["write-tree"], {
            cwd,
            stdio: "pipe",
            timeout: TIMEOUT,
            encoding: "utf-8",
            env: isolatedEnv,
          }).trim();
          const sha = execFileSync(
            "git",
            ["commit-tree", tree, ...(head ? ["-p", head] : []), "-m", message],
            {
              cwd,
              stdio: "pipe",
              timeout: TIMEOUT,
              encoding: "utf-8",
              env: isolatedEnv,
            },
          ).trim();
          execFileSync(
            "git",
            ["update-ref", "HEAD", sha, head ?? "0".repeat(40)],
            {
              cwd,
              stdio: "pipe",
              timeout: TIMEOUT,
              env,
            },
          );
          execFileSync(
            "git",
            ["reset", "--quiet", "HEAD", "--", ...pathspecs],
            {
              cwd,
              stdio: "pipe",
              timeout: TIMEOUT,
              env,
            },
          );
          return sha || null;
        } finally {
          fs.rmSync(indexDir, { recursive: true, force: true });
        }
      }
      execFileSync("git", ["add", "-A"], {
        cwd,
        stdio: "pipe",
        timeout: TIMEOUT,
        env,
      });
      execFileSync("git", ["commit", "-m", message], {
        cwd,
        stdio: "pipe",
        timeout: TIMEOUT,
        env,
      });
      const sha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd,
        stdio: "pipe",
        timeout: TIMEOUT,
        encoding: "utf-8",
        env,
      }).trim();
      return sha || null;
    });
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
  return [
    ...new Set(getChangedPaths(cwd).map((file) => file.split("/").pop()!)),
  ];
}

export function getChangedPaths(cwd: string): string[] {
  try {
    const staged = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "-z"],
      {
        cwd,
        stdio: "pipe",
        timeout: TIMEOUT,
        encoding: "utf-8",
      },
    );
    const unstaged = execFileSync("git", ["diff", "--name-only", "-z"], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
      encoding: "utf-8",
    });
    const untracked = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { cwd, stdio: "pipe", timeout: TIMEOUT, encoding: "utf-8" },
    );
    return [
      ...new Set(
        `${staged}${unstaged}${untracked}`.split("\0").filter(Boolean),
      ),
    ];
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
