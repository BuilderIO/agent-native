import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  SandboxAdapter,
  SandboxRunRequest,
  SandboxRunResult,
} from "./adapter.js";

const SIGKILL_GRACE_MS = 2_000;

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

export class LocalChildProcessAdapter implements SandboxAdapter {
  readonly id = "local-child-process";

  async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
    let tmpDir: string | undefined;
    let tmpFile: string | undefined;
    try {
      const tmpBaseDir = fs.realpathSync(os.tmpdir());
      tmpDir = fs.mkdtempSync(path.join(tmpBaseDir, "agent-run-code-"));
      tmpFile = path.join(tmpDir, "sandbox.mjs");
      fs.writeFileSync(tmpFile, request.moduleSource, "utf8");

      const safeEnv: Record<string, string> = { ...request.env };
      safeEnv.TMPDIR = tmpDir;
      safeEnv.TEMP = tmpDir;
      safeEnv.TMP = tmpDir;

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
      try {
        if (tmpFile) fs.rmSync(tmpFile, { force: true });
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
