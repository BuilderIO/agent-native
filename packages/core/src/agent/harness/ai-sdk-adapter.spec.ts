import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiSdkHarnessPartToEvents,
  createCodexCliAuthSandboxHook,
  normalizeCodexCliAuthConfig,
} from "./ai-sdk-adapter.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("aiSdkHarnessPartToEvents", () => {
  it("maps AI SDK stream text and tool parts to harness events", () => {
    expect(
      aiSdkHarnessPartToEvents({ type: "text-delta", text: "hi" }),
    ).toEqual([{ type: "text-delta", text: "hi" }]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "tool-call",
        toolCallId: "t1",
        toolName: "bash",
        input: { command: "npm test" },
      }),
    ).toEqual([
      {
        type: "tool-start",
        id: "t1",
        name: "bash",
        input: { command: "npm test" },
      },
    ]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "tool-result",
        toolCallId: "t1",
        toolName: "bash",
        output: "ok",
      }),
    ).toEqual([{ type: "tool-done", id: "t1", name: "bash", result: "ok" }]);
  });

  it("maps approval, file, compaction, finish, and error parts", () => {
    expect(
      aiSdkHarnessPartToEvents({
        type: "tool-approval-request",
        id: "approval-1",
        toolName: "write",
        message: "Approve write?",
      }),
    ).toEqual([
      {
        type: "approval-request",
        id: "approval-1",
        tool: "write",
        message: "Approve write?",
        input: undefined,
      },
    ]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "file-change",
        path: "README.md",
        operation: "update",
      }),
    ).toEqual([
      {
        type: "file-change",
        path: "README.md",
        operation: "update",
        summary: undefined,
      },
    ]);
    expect(aiSdkHarnessPartToEvents({ type: "compaction" })).toEqual([
      { type: "compaction", summary: undefined },
    ]);
    expect(
      aiSdkHarnessPartToEvents({ type: "finish", finishReason: "stop" }),
    ).toEqual([{ type: "done", reason: "stop" }]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "error",
        error: new Error("boom"),
      }),
    ).toEqual([{ type: "error", error: "boom" }]);
  });
});

describe("codexCliAuth sandbox hook", () => {
  it("copies local Codex CLI auth into the sandbox before an existing hook runs", async () => {
    const authDir = makeTempDir();
    const authPath = path.join(authDir, "auth.json");
    const authJson = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "access", refresh_token: "refresh" },
    });
    fs.writeFileSync(authPath, authJson);
    const writes: Array<{ path: string; content: string }> = [];
    const runs: string[] = [];
    const existingHook = vi.fn();
    const hook = createCodexCliAuthSandboxHook(
      { authJsonPath: authPath },
      existingHook,
    );

    await hook({
      session: {
        async run(options) {
          runs.push(options.command);
          if (options.command === 'printf "%s" "$HOME"') {
            return { stdout: "/home/sandbox", exitCode: 0 };
          }
          return { stdout: "", exitCode: 0 };
        },
        async writeTextFile(options) {
          writes.push({ path: options.path, content: options.content });
        },
      },
      sessionWorkDir: "/home/sandbox/codex-session",
    });

    expect(writes).toEqual([
      {
        path: "/home/sandbox/.codex/auth.json",
        content: authJson,
      },
    ]);
    expect(runs).toContain(
      "mkdir -p '/home/sandbox/.codex' && chmod 700 '/home/sandbox/.codex'",
    );
    expect(runs).toContain("chmod 600 '/home/sandbox/.codex/auth.json'");
    expect(existingHook).toHaveBeenCalledOnce();
  });

  it("throws a codex login hint when the local auth file is missing", async () => {
    const hook = createCodexCliAuthSandboxHook({
      authJsonPath: path.join(makeTempDir(), "missing-auth.json"),
    });

    await expect(
      hook({
        session: {
          async run() {
            return { stdout: "/home/sandbox", exitCode: 0 };
          },
          async writeTextFile() {},
        },
        sessionWorkDir: "/home/sandbox/codex-session",
      }),
    ).rejects.toThrow(/Run `codex login`/);
  });

  it("resolves the default auth path from CODEX_HOME before ~/.codex", () => {
    const previousCodexHome = process.env.CODEX_HOME; // guard:allow-env-credential -- test covers local auth-directory path selection.
    process.env.CODEX_HOME = "/tmp/codex-home"; // guard:allow-env-credential -- test covers local auth-directory path selection.

    try {
      expect(normalizeCodexCliAuthConfig(true)).toEqual({
        codexHome: "/tmp/codex-home",
        authJsonPath: "/tmp/codex-home/auth.json",
      });
    } finally {
      if (previousCodexHome === undefined)
        delete process.env.CODEX_HOME; // guard:allow-env-credential -- restore local auth-directory path env in test.
      else process.env.CODEX_HOME = previousCodexHome; // guard:allow-env-credential -- restore local auth-directory path env in test.
    }
  });
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-codex-auth-"),
  );
  tempDirs.push(dir);
  return dir;
}
