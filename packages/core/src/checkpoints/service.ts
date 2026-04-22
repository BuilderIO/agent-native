import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TIMEOUT = 10_000;

const CHECKPOINT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "agent-native",
  GIT_AUTHOR_EMAIL: "noreply@agent-native.dev",
  GIT_COMMITTER_NAME: "agent-native",
  GIT_COMMITTER_EMAIL: "noreply@agent-native.dev",
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
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
      encoding: "utf-8",
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

export function createCheckpoint(
  cwd: string,
  message: string,
): string | null {
  try {
    execFileSync("git", ["add", "-A"], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
    });
    execFileSync("git", ["commit", "-m", message], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
      env: CHECKPOINT_ENV,
    });
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
    execFileSync("git", ["checkout", sha, "--", "."], {
      cwd,
      stdio: "pipe",
      timeout: TIMEOUT,
    });
    return true;
  } catch {
    return false;
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
