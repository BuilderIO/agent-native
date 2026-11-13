import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

it("runs an ancestor compiler outside PATH from a path containing spaces", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compiler lookup "));
  try {
    const parent = path.join(root, "workspace");
    const cwd = path.join(parent, "app with spaces");
    const pathDir = path.join(root, "path bin");
    const ancestorBin = path.join(parent, "node_modules/.bin");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(pathDir);
    fs.mkdirSync(ancestorBin, { recursive: true });
    const windows = process.platform === "win32";
    for (const [dir, marker] of [
      [ancestorBin, "ancestor-tsc"],
      [pathDir, "path-tsc"],
    ]) {
      fs.writeFileSync(
        path.join(dir, windows ? "tsc.cmd" : "tsc"),
        windows
          ? `@echo off\r\necho ${marker} %*\r\n`
          : `#!/bin/sh\nprintf '${marker} %s\\n' "$*"\n`,
        { mode: 0o755 },
      );
    }
    const tsx = createRequire(import.meta.url).resolve("tsx/cli");
    const cli = fileURLToPath(new URL("./index.ts", import.meta.url));
    const result = spawnSync(
      process.execPath,
      [tsx, cli, "typecheck", "--pretty", "false"],
      {
        cwd,
        env: {
          ...process.env,
          PATH: pathDir,
          Path: pathDir,
          CI: "1",
          DO_NOT_TRACK: "1",
        },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("ancestor-tsc --noEmit --pretty false");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
