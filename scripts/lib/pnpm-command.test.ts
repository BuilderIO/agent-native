import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { pnpmCommand, WINDOWS_COMMAND_LINE_LIMIT } from "./pnpm-command.ts";

describe("pnpmCommand", () => {
  it("starts pnpm directly with its arguments outside Windows", () => {
    assert.deepEqual(pnpmCommand(["run", "build"], "linux"), {
      command: "pnpm",
      args: ["run", "build"],
      shell: false,
    });
  });

  it("joins one quoted command line for cmd.exe on Windows", () => {
    assert.deepEqual(
      pnpmCommand(
        ["--filter", "@agent-native/core", "exec", "vitest", "**/*.spec.ts"],
        "win32",
      ),
      {
        command:
          '"pnpm" "--filter" "@agent-native/core" "exec" "vitest" "**/*.spec.ts"',
        args: [],
        shell: true,
      },
    );
  });

  it("keeps a path's trailing backslash from escaping its closing quote", () => {
    assert.equal(
      pnpmCommand(["--dir", "C:\\repo\\templates\\"], "win32").command,
      '"pnpm" "--dir" "C:\\repo\\templates\\\\"',
    );
  });

  it("refuses arguments cmd.exe would change", () => {
    for (const arg of ['say "hi"', "%PATH%", "two\nlines"]) {
      assert.throws(() => pnpmCommand(["exec", arg], "win32"), /cmd\.exe/);
    }
    assert.deepEqual(pnpmCommand(["exec", "%PATH%"], "darwin").args, [
      "exec",
      "%PATH%",
    ]);
  });

  it("refuses a command line longer than cmd.exe reads", () => {
    const files = Array.from({ length: 600 }, (_, i) => `src/file-${i}.ts`);
    assert.throws(
      () => pnpmCommand(["exec", "oxlint", ...files], "win32"),
      new RegExp(String(WINDOWS_COMMAND_LINE_LIMIT)),
    );
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
});
