import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tsx = require.resolve("tsx/cli");
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

function run(cwd: string, pathDir: string) {
  return spawnSync(
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
}

describe("agent-native typecheck compiler lookup", () => {
  it("runs an ancestor compiler outside PATH from a path containing spaces", () => {
    const { cwd, parent, pathDir } = fixture();
    compiler(path.join(parent, "node_modules/.bin"), "tsc", "ancestor-tsc");
    compiler(pathDir, "tsc", "path-tsc");
    const result = run(cwd, pathDir);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("ancestor-tsc --noEmit --pretty false");
  });

  it("prefers the nearest directory, then tsc over tsgo in that directory", () => {
    const { cwd, parent, pathDir } = fixture();
    compiler(path.join(parent, "node_modules/.bin"), "tsc", "ancestor-tsc");
    compiler(path.join(cwd, "node_modules/.bin"), "tsgo", "local-tsgo");
    let result = run(cwd, pathDir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("local-tsgo --noEmit --pretty false");
    compiler(path.join(cwd, "node_modules/.bin"), "tsc", "local-tsc");
    result = run(cwd, pathDir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("local-tsc --noEmit --pretty false");
  });

  it("chooses a nearer ancestor's tsgo over a farther ancestor's tsc", () => {
    const { root, cwd, parent, pathDir } = fixture();
    compiler(path.join(root, "node_modules/.bin"), "tsc", "far-tsc");
    compiler(path.join(parent, "node_modules/.bin"), "tsgo", "near-tsgo");
    const result = run(cwd, pathDir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("near-tsgo --noEmit --pretty false");
  });

  it("typechecks with the installed ancestor compiler through the CLI launcher", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "compiler %COMPILER_TEST_ENV% "),
    );
    roots.push(root);
    const parent = path.join(root, "workspace");
    const cwd = path.join(parent, "app with spaces");
    fs.mkdirSync(cwd, { recursive: true });
    const installedModules = fileURLToPath(
      new URL("../../../../node_modules", import.meta.url),
    );
    fs.symlinkSync(
      installedModules,
      path.join(parent, "node_modules"),
      "junction",
    );
    const config = path.join(cwd, "config %COMPILER_TEST_ENV% & test.json");
    const source = path.join(cwd, "example.ts");
    fs.writeFileSync(
      config,
      JSON.stringify({ compilerOptions: { types: [] }, files: ["example.ts"] }),
    );
    fs.writeFileSync(source, "const value: string = 42;\n");
    const nodeDir = path.dirname(process.execPath);
    const systemDir =
      process.platform === "win32"
        ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32")
        : "/usr/bin:/bin";
    const executablePath = [nodeDir, systemDir].join(path.delimiter);
    const launcher = fileURLToPath(
      new URL("../../bin/agent-native.js", import.meta.url),
    );
    const invoke = () =>
      spawnSync(
        process.execPath,
        [launcher, "typecheck", "--project", config],
        {
          cwd,
          env: {
            ...process.env,
            PATH: executablePath,
            Path: executablePath,
            COMPILER_TEST_ENV:
              'expanded" & echo COMPILER_ARGUMENT_INJECTION & rem "',
            CI: "1",
            DO_NOT_TRACK: "1",
          },
          encoding: "utf8",
          timeout: 30000,
        },
      );
    const invalid = invoke();
    expect(invalid.error).toBeUndefined();
    expect(invalid.status, invalid.stderr).not.toBe(0);
    expect(invalid.stdout + invalid.stderr).toMatch(/TS2322/);
    expect(invalid.stdout + invalid.stderr).not.toContain(
      "COMPILER_ARGUMENT_INJECTION",
    );
    fs.writeFileSync(source, 'const value: string = "valid";\n');
    const valid = invoke();
    expect(valid.error).toBeUndefined();
    expect(valid.status, valid.stdout + valid.stderr).toBe(0);
    expect(fs.existsSync(path.join(cwd, "example.js"))).toBe(false);
  });

  it("falls back to tsc on PATH", () => {
    const { cwd, pathDir } = fixture();
    compiler(pathDir, "tsc", "path-tsc");
    const result = run(cwd, pathDir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("path-tsc --noEmit --pretty false");
  });

  it("passes arguments containing spaces as a single compiler argument", () => {
    const { cwd, parent, pathDir } = fixture();
    const dir = path.join(parent, "node_modules/.bin");
    fs.mkdirSync(dir, { recursive: true });
    const windows = process.platform === "win32";
    fs.writeFileSync(
      path.join(dir, windows ? "tsc.cmd" : "tsc"),
      windows
        ? "@echo off\r\necho arg=%~3\r\n"
        : "#!/bin/sh\nprintf 'arg=%s\\n' \"$3\"\n",
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [tsx, cli, "typecheck", "--project", "config with spaces.json"],
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
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("arg=config with spaces.json");
  });

  it("rejects Windows command separators before invoking a compiler shim", () => {
    if (process.platform !== "win32") return;
    const { cwd, parent, pathDir } = fixture();
    compiler(
      path.join(parent, "node_modules/.bin"),
      "tsc",
      "unexpected-compiler",
    );
    const result = spawnSync(
      process.execPath,
      [
        tsx,
        cli,
        "typecheck",
        "--project",
        "file\r\necho COMPILER_ARGUMENT_INJECTION",
      ],
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
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/newline/i);
    expect(result.stdout).not.toContain("COMPILER_ARGUMENT_INJECTION");
    expect(result.stdout).not.toContain("unexpected-compiler");
  });

  it("reports a missing compiler with an actionable error and a nonzero exit", () => {
    const { cwd, pathDir } = fixture();
    const result = run(cwd, pathDir);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/(?:install|add).*typescript/i);
    expect(result.stderr).toMatch(/tsc/i);
  });

  it("reports a missing compiler when the PATH compiler is a dangling symlink", () => {
    if (process.platform === "win32") return;
    const { cwd, pathDir } = fixture();
    fs.symlinkSync(
      path.join(pathDir, "missing-target"),
      path.join(pathDir, "tsc"),
    );
    const result = run(cwd, pathDir);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/(?:install|add).*typescript/i);
    expect(result.stderr).toMatch(/tsc/i);
  });

  it("prefers the first usable PATH compiler", () => {
    const { root, cwd, pathDir } = fixture();
    const laterPath = path.join(root, "later bin");
    compiler(pathDir, "tsc", "near-tsc");
    compiler(laterPath, "tsc", "later-tsc");
    const result = run(cwd, [pathDir, laterPath].join(path.delimiter));
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("near-tsc --noEmit --pretty false");
  });

  it("uses a later PATH compiler when the earlier entry is a dangling symlink", () => {
    if (process.platform === "win32") return;
    const { root, cwd, pathDir } = fixture();
    const laterPath = path.join(root, "later bin");
    fs.symlinkSync(
      path.join(pathDir, "missing-target"),
      path.join(pathDir, "tsc"),
    );
    compiler(laterPath, "tsc", "later-tsc");
    const result = run(cwd, [pathDir, laterPath].join(path.delimiter));
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("later-tsc --noEmit --pretty false");
  });

  it("uses a later PATH compiler when a nearer script has a missing interpreter", () => {
    if (process.platform === "win32") return;
    const { root, cwd, pathDir } = fixture();
    const laterPath = path.join(root, "later bin");
    fs.writeFileSync(
      path.join(pathDir, "tsc"),
      "#!/nonexistent-test-interpreter\n",
      { mode: 0o755 },
    );
    compiler(laterPath, "tsc", "later-tsc");
    const result = run(cwd, [pathDir, laterPath].join(path.delimiter));
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("later-tsc --noEmit --pretty false");
  });

  it("preserves a later PATH compiler's missing-interpreter error after a dangling link", () => {
    if (process.platform === "win32") return;
    const { root, cwd, pathDir } = fixture();
    const laterPath = path.join(root, "later bin");
    fs.symlinkSync(
      path.join(pathDir, "missing-target"),
      path.join(pathDir, "tsc"),
    );
    fs.mkdirSync(laterPath);
    fs.writeFileSync(
      path.join(laterPath, "tsc"),
      "#!/nonexistent-test-interpreter\n",
      { mode: 0o755 },
    );
    const result = run(cwd, [pathDir, laterPath].join(path.delimiter));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ENOENT/);
    expect(result.stderr).not.toMatch(/(?:install|add).*typescript/i);
  });

  it("preserves a PATH compiler's missing-interpreter error", () => {
    if (process.platform === "win32") return;
    const { cwd, pathDir } = fixture();
    fs.writeFileSync(
      path.join(pathDir, "tsc"),
      "#!/nonexistent-test-interpreter\n",
      { mode: 0o755 },
    );
    const result = run(cwd, pathDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ENOENT/);
    expect(result.stderr).not.toMatch(/(?:install|add).*typescript/i);
  });

  it("preserves a non-executable PATH compiler's permission error", () => {
    if (process.platform === "win32") return;
    const { cwd, pathDir } = fixture();
    compiler(pathDir, "tsc", "not-executable", 0o644);
    const result = run(cwd, pathDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/EACCES/);
    expect(result.stderr).not.toMatch(/(?:install|add).*typescript/i);
  });

  it("preserves other spawn errors instead of reporting a missing compiler", () => {
    if (process.platform === "win32") return;
    const { cwd, pathDir } = fixture();
    compiler(
      path.join(cwd, "node_modules/.bin"),
      "tsc",
      "not-executable",
      0o644,
    );
    const result = run(cwd, pathDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/EACCES/);
    expect(result.stderr).not.toMatch(/(?:install|add).*typescript/i);
  });
});
