import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  buildCodexCliParticipantArgs,
  CODEX_CLI_PARTICIPANT_TESTED_VERSION,
  CodexCliSubscriptionRequiredError,
  runCodexCliParticipant,
  type CodexCliParticipantChild,
  type CodexCliParticipantSpawn,
} from "./codex-cli-participant.js";

const SUBSCRIPTION_STATUS = {
  loggedIn: true,
  authMode: "ChatGPT",
} as const;

describe("Codex CLI participant", () => {
  it("enforces read-only planning and watchdog roles with approvals disabled", () => {
    for (const role of ["planning", "watchdog"] as const) {
      expect(
        buildCodexCliParticipantArgs({ role, cwd: "/tmp/workspace" }),
      ).toEqual([
        "--ask-for-approval",
        "never",
        "--sandbox",
        "read-only",
        "--cd",
        "/tmp/workspace",
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "-",
      ]);
    }
  });

  it("grants workspace-write only to an explicitly enabled driver", () => {
    expect(
      buildCodexCliParticipantArgs({
        role: "driver",
        cwd: "/tmp/workspace",
      }),
    ).toContain("read-only");
    const args = buildCodexCliParticipantArgs({
      role: "driver",
      cwd: "/tmp/workspace",
      allowWorkspaceWrite: true,
    });
    expect(args).toContain("workspace-write");
    expect(args).not.toContain("danger-full-access");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("resumes an opaque session and still sends the prompt on stdin", () => {
    expect(
      buildCodexCliParticipantArgs({
        role: "watchdog",
        cwd: "/tmp/workspace",
        model: "gpt-5.6-mini",
        session: { resumeSessionId: "opaque-session-name" },
      }),
    ).toEqual([
      "--ask-for-approval",
      "never",
      "--sandbox",
      "read-only",
      "--cd",
      "/tmp/workspace",
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--model",
      "gpt-5.6-mini",
      "--",
      "opaque-session-name",
      "-",
    ]);
  });

  it("spawns a fixed executable without a shell, scrubs API fallback, and parses JSONL", async () => {
    const child = new FakeCodexChild();
    const spawnProcess = vi.fn<CodexCliParticipantSpawn>(() => child);
    const execution = runCodexCliParticipant({
      role: "watchdog",
      prompt: "Review only.",
      cwd: "/tmp/workspace",
      env: {
        PATH: "/usr/bin:/bin",
        OPENAI_API_KEY: "must-not-pass",
        OPENAI_BASE_URL: "https://example.invalid",
        AZURE_OPENAI_API_KEY: "must-not-pass",
      },
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess,
    });

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    child.stdout.write(
      '{"type":"thread.started","thread_id":"thread-123"}\n{"type":"turn.completed"}\n',
    );
    child.close(0);

    await expect(execution).resolves.toMatchObject({
      exitCode: 0,
      resumeSessionId: "thread-123",
      events: [{ type: "thread.started" }, { type: "turn.completed" }],
    });
    const [command, args, options] = spawnProcess.mock.calls[0];
    expect(command).toBe("codex");
    expect(args).not.toContain("Review only.");
    expect(options).toMatchObject({
      cwd: "/tmp/workspace",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin" },
    });
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(options.env).not.toHaveProperty("OPENAI_BASE_URL");
    expect(options.env).not.toHaveProperty("AZURE_OPENAI_API_KEY");
    expect(child.stdinText).toBe("Review only.");
  });

  it("rejects API-key admission before spawning", async () => {
    const spawnProcess = vi.fn<CodexCliParticipantSpawn>();
    await expect(
      runCodexCliParticipant({
        role: "driver",
        prompt: "Implement.",
        cwd: "/tmp/workspace",
        preflight: async () => ({ loggedIn: true, authMode: "API key" }),
        spawnProcess,
      }),
    ).rejects.toBeInstanceOf(CodexCliSubscriptionRequiredError);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("kills its owned process when aborted", async () => {
    const child = new FakeCodexChild();
    const controller = new AbortController();
    const execution = runCodexCliParticipant({
      role: "driver",
      prompt: "Implement.",
      cwd: "/tmp/workspace",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess: () => child,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(child.stdinText).toBe("Implement."));
    controller.abort();
    expect(child.killedWith).toBe("SIGTERM");
    child.close(null, "SIGTERM");
    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
  });

  it("enforces event, byte, and stderr caps", async () => {
    const eventChild = new FakeCodexChild();
    const eventRun = runCodexCliParticipant({
      role: "watchdog",
      prompt: "Review.",
      cwd: "/tmp/workspace",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess: () => eventChild,
      maxEvents: 1,
    });
    await vi.waitFor(() => expect(eventChild.stdinText).toBe("Review."));
    eventChild.stdout.write('{"type":"one"}\n{"type":"two"}\n');
    eventChild.close(null, "SIGTERM");
    await expect(eventRun).rejects.toThrow("stream exceeded 1 events");

    const byteChild = new FakeCodexChild();
    const byteRun = runCodexCliParticipant({
      role: "watchdog",
      prompt: "Review.",
      cwd: "/tmp/workspace",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess: () => byteChild,
      maxStreamBytes: 4,
    });
    await vi.waitFor(() => expect(byteChild.stdinText).toBe("Review."));
    byteChild.stdout.write("12345");
    byteChild.close(null, "SIGTERM");
    await expect(byteRun).rejects.toThrow("stream exceeded 4 bytes");

    const stderrChild = new FakeCodexChild();
    const stderrRun = runCodexCliParticipant({
      role: "watchdog",
      prompt: "Review.",
      cwd: "/tmp/workspace",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess: () => stderrChild,
      maxStderrBytes: 4,
    });
    await vi.waitFor(() => expect(stderrChild.stdinText).toBe("Review."));
    stderrChild.stderr.write("12345678");
    stderrChild.close(0);
    await expect(stderrRun).resolves.toMatchObject({
      stderr: "1234",
      stderrTruncated: true,
    });
  });

  it("records the exact locally verified CLI version", () => {
    expect(CODEX_CLI_PARTICIPANT_TESTED_VERSION).toBe("0.144.3");
  });
});

class FakeCodexChild extends EventEmitter implements CodexCliParticipantChild {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  stdinText = "";
  killedWith?: NodeJS.Signals;

  constructor() {
    super();
    this.stdin.on("data", (chunk) => {
      this.stdinText += chunk.toString();
    });
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal;
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("close", code, signal);
  }
}
