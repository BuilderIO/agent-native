import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  pnpmCommand,
  startCommand,
  WINDOWS_COMMAND_LINE_LIMIT,
} from "./pnpm-command.ts";

describe("startCommand", () => {
  it("sends pnpm through pnpmCommand", () => {
    assert.deepEqual(
      startCommand("pnpm", ["run", "build"], "win32"),
      pnpmCommand(["run", "build"], "win32"),
    );
    assert.deepEqual(
      startCommand("pnpm", ["run", "build"], "linux"),
      pnpmCommand(["run", "build"], "linux"),
    );
  });

  it("starts any other command as given", () => {
    assert.deepEqual(startCommand("git", ["status"], "win32"), {
      command: "git",
      args: ["status"],
      shell: false,
    });
  });
});

describe("pnpmCommand", () => {
  it("starts pnpm directly with its arguments outside Windows", () => {
    assert.deepEqual(pnpmCommand(["run", "build"], "linux"), {
      command: "pnpm",
      args: ["run", "build"],
      shell: false,
    });
  });

  it("joins one command line for cmd.exe on Windows, arguments quoted", () => {
    assert.deepEqual(
      pnpmCommand(
        ["--filter", "@agent-native/core", "exec", "vitest", "**/*.spec.ts"],
        "win32",
        {},
      ),
      {
        command:
          'pnpm "--filter" "@agent-native/core" "exec" "vitest" "**/*.spec.ts"',
        args: [],
        shell: true,
      },
    );
  });

  it("keeps a path's trailing backslash from escaping its closing quote", () => {
    assert.equal(
      pnpmCommand(["--dir", "C:\\repo\\templates\\"], "win32", {}).command,
      'pnpm "--dir" "C:\\repo\\templates\\\\"',
    );
  });

  it("refuses arguments cmd.exe would change", () => {
    for (const arg of ['say "hi"', "%PATH%", "two\nlines"]) {
      assert.throws(() => pnpmCommand(["exec", arg], "win32", {}), /cmd\.exe/);
    }
    assert.deepEqual(pnpmCommand(["exec", "%PATH%"], "darwin").args, [
      "exec",
      "%PATH%",
    ]);
  });

  it("refuses a command line longer than cmd.exe reads", () => {
    const files = Array.from({ length: 600 }, (_, i) => `src/file-${i}.ts`);
    assert.throws(
      () => pnpmCommand(["exec", "oxlint", ...files], "win32", {}),
      new RegExp(String(WINDOWS_COMMAND_LINE_LIMIT)),
    );
  });

  it("starts the pnpm that started this script on Windows, with no shell", () => {
    const cjs =
      "C:\\Users\\runner\\setup-pnpm\\node_modules\\pnpm\\bin\\pnpm.cjs";
    assert.deepEqual(
      pnpmCommand(["--filter", "@agent-native/core", "run", "build"], "win32", {
        npm_execpath: cjs,
      }),
      {
        command: process.execPath,
        args: [cjs, "--filter", "@agent-native/core", "run", "build"],
        shell: false,
      },
    );

    const exe = "C:\\Users\\dev\\AppData\\Local\\pnpm\\PNPM.EXE";
    assert.deepEqual(
      pnpmCommand(["run", "build"], "win32", { npm_execpath: exe }),
      { command: exe, args: ["run", "build"], shell: false },
    );
  });

  it("passes arguments cmd.exe would change when no shell is involved", () => {
    const env = { npm_execpath: "D:\\pnpm\\bin\\pnpm.cjs" };
    for (const arg of ['say "hi"', "%PATH%", "two\nlines"]) {
      assert.equal(pnpmCommand(["exec", arg], "win32", env).args.at(-1), arg);
    }
  });

  it("goes through cmd.exe when npm_execpath is not pnpm's own entry", () => {
    for (const npm_execpath of [
      "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      "C:\\Users\\dev\\AppData\\Roaming\\npm\\pnpm.cmd",
      "C:\\Users\\dev\\.yarn\\releases\\yarn-4.5.0.cjs",
    ]) {
      assert.deepEqual(
        pnpmCommand(["run", "build"], "win32", { npm_execpath }),
        {
          command: 'pnpm "run" "build"',
          args: [],
          shell: true,
        },
      );
    }
  });

  it("starts the real pnpm on this machine", () => {
    const pnpm = pnpmCommand(["--version"]);
    const result = spawnSync(pnpm.command, pnpm.args, {
      encoding: "utf8",
      shell: pnpm.shell,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it(
    "lets a pnpm launcher on PATH find files beside it",
    { skip: process.platform !== "win32" },
    () => {
      // pnpm 11's launcher starts `%~dp0\..\global\v11\...\pnpm.cjs`. Under a
      // quoted name, cmd.exe sets %~dp0 to the current folder instead.
      const root = mkdtempSync(path.join(tmpdir(), "pnpm-launcher-"));
      try {
        const bin = path.join(root, "home", "bin");
        const cwd = path.join(root, "repo");
        mkdirSync(bin, { recursive: true });
        mkdirSync(cwd);
        writeFileSync(path.join(root, "home", "found.txt"), "found\r\n");
        writeFileSync(
          // guard:allow-bare-pnpm — names the fixture launcher, not a spawn
          path.join(bin, "pnpm.cmd"),
          '@type "%~dp0\\..\\found.txt"\r\n',
        );
        const env = { ...process.env };
        const pathKey =
          Object.keys(env).find((key) => key.toUpperCase() === "PATH") ??
          "PATH";
        env[pathKey] = `${bin}${path.delimiter}${env[pathKey] ?? ""}`;

        const pnpm = pnpmCommand(["run", "build"], "win32", {});
        const result = spawnSync(pnpm.command, pnpm.args, {
          cwd,
          env,
          encoding: "utf8",
          shell: pnpm.shell,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout.trim(), "found");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
