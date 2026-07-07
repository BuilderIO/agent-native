/**
 * Default sandbox adapter: a local Node.js child process.
 *
 * This is the historical `run-code` execution path, extracted verbatim so the
 * default runtime behavior is byte-for-byte equivalent to the previous inline
 * implementation in `run-code.ts`:
 *  - The prepared module source is written to a fresh temp dir.
 *  - The child runs with the scrubbed env supplied by the parent (no secrets).
 *  - When the Node permission model is available (`--permission`, or
 *    `--experimental-permission` on Node 20), the child is denied filesystem
 *    access outside its own temp dir, child processes, workers, and native
 *    addons. Outbound network is NOT blocked by the permission model; the env
 *    scrub means such requests carry no credentials, and all authenticated calls
 *    go through the parent's loopback bridge.
 *  - A timeout sends SIGTERM, then SIGKILL after a 2 s grace period.
 *  - Temp files are cleaned up best-effort after the run.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  SandboxAdapter,
  SandboxRunRequest,
  SandboxRunResult,
} from "./adapter.js";

/** Grace period between SIGTERM and SIGKILL when a run times out. */
const SIGKILL_GRACE_MS = 2_000;

/**
 * Hard ceiling on combined stdout+stderr bytes accumulated PER STREAM while a
 * run is in flight, independent of any caller-supplied `maxOutputChars`
 * display cap. Callers (e.g. data-programs' `emit()` contract) apply their
 * own, much smaller caps AFTER the process exits and the full string has been
 * captured and JSON-parsed — that is a business-logic cap, not a memory-safety
 * one. Without a ceiling here, a runaway `console.log`/emit loop can grow the
 * accumulated string to hundreds of MB or more before any downstream cap ever
 * runs, exhausting parent/child memory. 32 MiB comfortably covers legitimate
 * uses (run-code's 200_000-char display cap, data-programs' 4 MiB emitted
 * payload, plus generous debug logging headroom) while still bounding the
 * worst case to a small constant instead of unbounded growth.
 */
const MAX_STREAM_BYTES = 32 * 1024 * 1024;

function sandboxReadAllowPaths(tmpDir: string): string[] {
  const paths = new Set<string>([tmpDir]);
  try {
    paths.add(fs.realpathSync(tmpDir));
  } catch {}
  return [...paths];
}

function sandboxWriteAllowPaths(tmpDir: string): string[] {
  const paths = new Set<string>([tmpDir]);
  try {
    paths.add(fs.realpathSync(tmpDir));
  } catch {}
  return [...paths];
}

/**
 * Resolve the Node permission-model flag supported by the current runtime,
 * probing once and caching. Returns null when the permission model is
 * unavailable (the sandbox then falls back to env-scrub isolation only).
 */
let cachedPermissionFlag: string | null | undefined;
function resolvePermissionFlag(): string | null {
  if (cachedPermissionFlag !== undefined) return cachedPermissionFlag;
  for (const flag of ["--permission", "--experimental-permission"]) {
    try {
      const probe = spawnSync(
        process.execPath,
        [flag, "-e", "process.exit(0)"],
        {
          timeout: 10_000,
          stdio: "ignore",
        },
      );
      if (probe.status === 0) {
        cachedPermissionFlag = flag;
        return flag;
      }
    } catch {
      // Probe failure means the flag is unsupported; try the next one.
    }
  }
  cachedPermissionFlag = null;
  return null;
}

/** Sandbox adapter that runs code in a locked-down local Node child process. */
export class LocalChildProcessAdapter implements SandboxAdapter {
  readonly id = "local-child-process";

  async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
    let tmpDir: string | undefined;
    let tmpFile: string | undefined;
    try {
      // Write code to a temp ESM file (top-level await needs a module).
      const tmpBaseDir = fs.realpathSync(os.tmpdir());
      tmpDir = fs.mkdtempSync(path.join(tmpBaseDir, "agent-run-code-"));
      tmpFile = path.join(tmpDir, "sandbox.mjs");
      fs.writeFileSync(tmpFile, request.moduleSource, "utf8");

      // The parent supplies an already-scrubbed env (no secrets). Point TMPDIR
      // inside the sandbox dir so in-sandbox temp writes stay within the
      // permission-model allow list.
      const safeEnv: Record<string, string> = { ...request.env };
      safeEnv.TMPDIR = tmpDir;
      safeEnv.TEMP = tmpDir;
      safeEnv.TMP = tmpDir;

      // Lock the child down with the Node permission model when available:
      // filesystem restricted to the sandbox temp dir, and child processes,
      // workers, and native addons denied entirely.
      const permissionFlag = resolvePermissionFlag();
      const nodeArgs = permissionFlag
        ? [
            permissionFlag,
            ...sandboxReadAllowPaths(tmpDir).map(
              (allowedPath) => `--allow-fs-read=${allowedPath}`,
            ),
            ...sandboxWriteAllowPaths(tmpDir).map(
              (allowedPath) => `--allow-fs-write=${allowedPath}`,
            ),
            tmpFile,
          ]
        : [tmpFile];

      const child = spawn(process.execPath, nodeArgs, {
        cwd: tmpDir,
        env: safeEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let outputExceeded = false;

      const killForOverflow = () => {
        if (outputExceeded) return;
        outputExceeded = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
        }, SIGKILL_GRACE_MS);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
        }, SIGKILL_GRACE_MS);
      }, request.timeoutMs);

      // Accumulate as raw Buffer chunks (cheaper than repeated string
      // concatenation) and stop collecting — and kill the child — the moment
      // either stream crosses MAX_STREAM_BYTES, so a runaway emit()/console.log
      // loop can never grow parent memory past a small bounded ceiling.
      child.stdout?.on("data", (chunk: Buffer) => {
        if (outputExceeded) return;
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STREAM_BYTES) {
          killForOverflow();
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (outputExceeded) return;
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_STREAM_BYTES) {
          killForOverflow();
          return;
        }
        stderrChunks.push(chunk);
      });

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (outputExceeded && !timedOut) {
        return {
          stdout,
          stderr: `${stderr}\n[sandbox] output exceeded the ${MAX_STREAM_BYTES}-byte-per-stream safety limit; process was terminated.`,
          exitCode,
          timedOut: false,
        };
      }

      return { stdout, stderr, exitCode, timedOut };
    } finally {
      // Clean up temp files (best-effort).
      try {
        if (tmpFile) fs.rmSync(tmpFile, { force: true });
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
