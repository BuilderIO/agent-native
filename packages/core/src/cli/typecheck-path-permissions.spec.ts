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
  return { cwd, pathDir };
}

function runWithWindowsLookupOnLinux(cwd: string, pathDir: string) {
  // Only the CLI's platform branch is simulated. cross-spawn and the actual
  // process execution remain POSIX, so this does not prove Windows cmd escaping.
  const script = `
    require(${JSON.stringify(require.resolve("cross-spawn"))});
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
        PATHEXT: ".EXE;.CMD",
        CI: "1",
        DO_NOT_TRACK: "1",
      },
      encoding: "utf8",
      timeout: 30000,
    },
  );
}

describe("agent-native typecheck with simulated Windows CLI selection on Linux", () => {
  it("runs an extensionless PATH compiler without a separate Windows preflight", () => {
    if (process.platform !== "linux") return;
    const { cwd, pathDir } = fixture();
    fs.writeFileSync(
      path.join(pathDir, "tsc"),
      "#!/bin/sh\nprintf 'path-tsc %s\\n' \"$*\"\n",
      { mode: 0o755 },
    );
    const result = runWithWindowsLookupOnLinux(cwd, pathDir);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("path-tsc --noEmit --pretty false");
  });

  it("reports the original ENOENT and a neutral hint when tsc is missing", () => {
    if (process.platform !== "linux") return;
    const { cwd, pathDir } = fixture();
    const result = runWithWindowsLookupOnLinux(cwd, pathDir);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/spawn tsc ENOENT/);
    expect(result.stderr).toMatch(
      /Could not execute tsc; check that TypeScript and its interpreter are installed/i,
    );
  });

  it("reports the original ENOENT and a neutral hint for a missing interpreter", () => {
    if (process.platform !== "linux") return;
    const { cwd, pathDir } = fixture();
    fs.writeFileSync(
      path.join(pathDir, "tsc"),
      "#!/nonexistent-test-interpreter\n",
      { mode: 0o755 },
    );
    const result = runWithWindowsLookupOnLinux(cwd, pathDir);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/spawn tsc ENOENT/);
    expect(result.stderr).toMatch(
      /Could not execute tsc; check that TypeScript and its interpreter are installed/i,
    );
  });

  it("preserves EACCES without an ENOENT hint", () => {
    if (process.platform !== "linux") return;
    const { cwd, pathDir } = fixture();
    fs.writeFileSync(path.join(pathDir, "tsc"), "#!/bin/sh\nexit 0\n", {
      mode: 0o644,
    });
    const result = runWithWindowsLookupOnLinux(cwd, pathDir);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/spawn tsc EACCES/);
    expect(result.stderr).not.toMatch(/Could not execute tsc/);
  });
});
