import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const cli = fileURLToPath(new URL("./index.ts", import.meta.url));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compiler lookup "));
  roots.push(root);
  const cwd = path.join(root, "workspace", "app with spaces");
  const pathDir = path.join(root, "path bin");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(pathDir);
  return { root, cwd, pathDir, parent: path.dirname(cwd) };
}

function compiler(
  dir: string,
  name: "tsc" | "tsgo",
  marker: string,
  mode = 0o755,
) {
  fs.mkdirSync(dir, { recursive: true });
  const windows = process.platform === "win32";
  fs.writeFileSync(
    path.join(dir, windows ? `${name}.cmd` : name),
    windows
      ? `@echo off\r\necho ${marker} %*\r\n`
      : `#!/bin/sh\nprintf '${marker} %s\\n' "$*"\n`,
    { mode },
  );
}

function runWindowsLookupOnLinux(
  cwd: string,
  pathDir: string,
  epermPath?: string,
) {
  // Load cross-spawn on Linux before selecting the Windows CLI lookup path, so
  // the real POSIX compiler can run after the pre-spawn check.
  const script = `
    require(${JSON.stringify(require.resolve("cross-spawn"))});
    if (${JSON.stringify(epermPath ?? null)}) {
      const fs = require("node:fs");
      const stat = fs.statSync;
      fs.statSync = function (file, ...args) {
        if (file === ${JSON.stringify(epermPath ?? null)}) {
          throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        }
        return stat.call(this, file, ...args);
      };
    }
    Object.defineProperty(process, "platform", { value: "win32" });
    process.argv = [process.execPath, ${JSON.stringify(cli)}, "typecheck", "--pretty", "false"];
    import(${JSON.stringify(cli)});
  `;
  return spawnSync(
    process.execPath,
    ["--import", require.resolve("tsx/esm"), "-e", script],
    {
      cwd,
      env: {
        ...process.env,
        PATH: pathDir,
        Path: pathDir,
        PATHEXT: "",
        CI: "1",
        DO_NOT_TRACK: "1",
      },
      ...(process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {}),
      encoding: "utf8",
      timeout: 30000,
    },
  );
}

describe("agent-native typecheck Windows PATH permissions", () => {
  it("uses a later PATH compiler after an inaccessible directory in the Windows pre-spawn lookup", () => {
    if (process.platform !== "linux") return;
    const { root, cwd, pathDir } = fixture();
    fs.chmodSync(root, 0o755);
    fs.chmodSync(pathDir, 0o000);
    const laterPath = path.join(root, "later bin");
    compiler(laterPath, "tsc", "later-tsc");
    const result = runWindowsLookupOnLinux(
      cwd,
      [pathDir, laterPath].join(path.delimiter),
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("later-tsc --noEmit --pretty false");
  });

  it("uses a later PATH compiler after an EPERM lookup error", () => {
    if (process.platform !== "linux") return;
    const { root, cwd, pathDir } = fixture();
    fs.chmodSync(root, 0o755);
    const laterPath = path.join(root, "later bin");
    compiler(laterPath, "tsc", "later-tsc");
    // EPERM from stat is not reliably reproducible with POSIX directory modes.
    const result = runWindowsLookupOnLinux(
      cwd,
      [pathDir, laterPath].join(path.delimiter),
      path.join(pathDir, "tsc"),
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("later-tsc --noEmit --pretty false");
  });

  it("preserves a later PATH compiler's missing-interpreter error after an EPERM lookup error", () => {
    if (process.platform !== "linux") return;
    const { root, cwd, pathDir } = fixture();
    fs.chmodSync(root, 0o755);
    const laterPath = path.join(root, "later bin");
    fs.mkdirSync(laterPath);
    fs.writeFileSync(
      path.join(laterPath, "tsc"),
      "#!/nonexistent-test-interpreter\n",
      { mode: 0o755 },
    );
    const result = runWindowsLookupOnLinux(
      cwd,
      [pathDir, laterPath].join(path.delimiter),
      path.join(pathDir, "tsc"),
    );
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ENOENT/);
    expect(result.stderr).not.toMatch(/(?:install|add).*typescript/i);
  });

  it("reports an inaccessible PATH directory when no compiler is found in the Windows pre-spawn lookup", () => {
    if (process.platform !== "linux") return;
    const { root, cwd, pathDir } = fixture();
    fs.chmodSync(root, 0o755);
    fs.chmodSync(pathDir, 0o000);
    const result = runWindowsLookupOnLinux(cwd, pathDir);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/EACCES/);
    expect(result.stderr).not.toMatch(/(?:install|add).*typescript/i);
  });
});
