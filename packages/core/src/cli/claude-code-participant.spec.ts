import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  buildClaudeCodeParticipantArgs,
  CLAUDE_CODE_PARTICIPANT_TESTED_VERSION,
  ClaudeCodeSubscriptionRequiredError,
  readClaudeCodeSubscriptionStatus,
  runClaudeCodeParticipant,
  type ClaudeCodeParticipantChild,
  type ClaudeCodeParticipantPreflightContext,
  type ClaudeCodeParticipantSpawn,
} from "./claude-code-participant.js";

const SUBSCRIPTION_STATUS = {
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  subscriptionType: "max",
} as const;

describe("Claude Code participant", () => {
  it("builds runtime-enforced watchdog arguments", () => {
    expect(
      buildClaudeCodeParticipantArgs({
        role: "watchdog",
        model: "fable",
        session: {
          sessionId: "11111111-1111-4111-8111-111111111111",
          persist: false,
        },
      }),
    ).toEqual([
      "--print",
      "--input-format",
      "text",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-chrome",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--permission-mode",
      "plan",
      "--tools",
      "Read,Glob,Grep",
      "--disallowedTools",
      "Edit,Write,NotebookEdit,Bash",
      "--model",
      "fable",
      "--session-id",
      "11111111-1111-4111-8111-111111111111",
      "--no-session-persistence",
    ]);
  });

  it("disables Claude session persistence by default but permits explicit opt-in", () => {
    expect(buildClaudeCodeParticipantArgs({ role: "driver" })).toContain(
      "--no-session-persistence",
    );
    expect(
      buildClaudeCodeParticipantArgs({
        role: "driver",
        session: { persist: true },
      }),
    ).not.toContain("--no-session-persistence");
  });

  it("uses acceptEdits without bypass or shell tools for the driver", () => {
    const args = buildClaudeCodeParticipantArgs({
      role: "driver",
      session: { resumeSessionId: "existing-session" },
    });

    expect(args).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "acceptEdits",
        "--tools",
        "Read,Glob,Grep,Edit,Write",
        "--resume",
        "existing-session",
      ]),
    );
    expect(args.join(" ")).not.toContain("dangerously-skip");
    expect(args.join(" ")).not.toContain("Bash");
  });

  it("permits only an absolute packaged executable override", async () => {
    const child = new FakeClaudeChild();
    const spawnProcess = vi.fn<ClaudeCodeParticipantSpawn>(() => child);
    const execution = runClaudeCodeParticipant({
      role: "driver",
      prompt: "Implement.",
      cwd: "/tmp/workspace",
      command: "/Applications/Agent Native.app/Contents/Resources/claude",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess,
    });
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    child.close(0);
    await expect(execution).resolves.toMatchObject({ exitCode: 0 });
    expect(spawnProcess.mock.calls[0]?.[0]).toContain("/Applications/");

    await expect(
      runClaudeCodeParticipant({
        role: "driver",
        prompt: "Implement.",
        cwd: "/tmp/workspace",
        command: "other-claude",
      }),
    ).rejects.toThrow("absolute executable path");
    await expect(
      runClaudeCodeParticipant({
        role: "driver",
        prompt: "Implement.",
        cwd: "/tmp/workspace",
        command: "/tmp/claude\0other",
      }),
    ).rejects.toThrow("absolute executable path");
  });

  it("spawns Claude without a shell, sends the prompt on stdin, and bounds JSON events", async () => {
    const child = new FakeClaudeChild();
    const spawnProcess = vi.fn<ClaudeCodeParticipantSpawn>(() => child);
    const onEvent = vi.fn();
    const packagedCommand =
      "/Applications/Agent Native.app/Contents/Resources/claude";
    const preflight = vi.fn(
      async (_context: ClaudeCodeParticipantPreflightContext) =>
        SUBSCRIPTION_STATUS,
    );
    const execution = runClaudeCodeParticipant({
      role: "watchdog",
      prompt: "Review only.",
      cwd: "/tmp/workspace",
      command: packagedCommand,
      env: {
        PATH: "/usr/bin:/bin",
        ANTHROPIC_API_KEY: "must-not-pass",
        ANTHROPIC_AUTH_TOKEN: "must-not-pass",
        CLAUDE_CODE_USE_BEDROCK: "1",
        AWS_BEARER_TOKEN_BEDROCK: "must-not-pass",
        CLAUDE_CONFIG_DIR: "/tmp/claude-config",
      },
      preflight,
      spawnProcess,
      onEvent,
      maxEvents: 2,
    });

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    child.stdout.write('{"type":"system"}\n{"type":"result"}\n');
    child.close(0);
    await expect(execution).resolves.toMatchObject({
      exitCode: 0,
      events: [{ type: "system" }, { type: "result" }],
    });

    expect(spawnProcess).toHaveBeenCalledOnce();
    const [command, args, options] = spawnProcess.mock.calls[0];
    expect(command).toBe(
      "/Applications/Agent Native.app/Contents/Resources/claude",
    );
    expect(args).not.toContain("Review only.");
    expect(options).toMatchObject({
      cwd: "/tmp/workspace",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: "/usr/bin:/bin",
        CLAUDE_CONFIG_DIR: "/tmp/claude-config",
      },
    });
    expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(options.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(options.env).not.toHaveProperty("CLAUDE_CODE_USE_BEDROCK");
    expect(options.env).not.toHaveProperty("AWS_BEARER_TOKEN_BEDROCK");
    expect(preflight).toHaveBeenCalledWith({
      command: packagedCommand,
      env: options.env,
    });
    expect(child.stdinText).toBe("Review only.");
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("rejects API-key auth before spawning", async () => {
    const spawnProcess = vi.fn<ClaudeCodeParticipantSpawn>();

    await expect(
      runClaudeCodeParticipant({
        role: "driver",
        prompt: "Implement.",
        cwd: "/tmp/workspace",
        preflight: async () => ({
          loggedIn: true,
          authMethod: "apiKey",
          apiProvider: "firstParty",
        }),
        spawnProcess,
      }),
    ).rejects.toBeInstanceOf(ClaudeCodeSubscriptionRequiredError);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("kills the owned process with SIGTERM when canceled", async () => {
    const child = new FakeClaudeChild();
    const spawnProcess = vi.fn<ClaudeCodeParticipantSpawn>(() => child);
    const controller = new AbortController();
    const execution = runClaudeCodeParticipant({
      role: "driver",
      prompt: "Implement.",
      cwd: "/tmp/workspace",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    controller.abort();
    expect(child.killedWith).toBe("SIGTERM");
    child.close(null, "SIGTERM");

    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
  });

  it("escalates a wedged process to SIGKILL and settles after cancellation", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeClaudeChild();
      const controller = new AbortController();
      const execution = runClaudeCodeParticipant({
        role: "driver",
        prompt: "Implement.",
        cwd: "/tmp/workspace",
        preflight: async () => SUBSCRIPTION_STATUS,
        spawnProcess: () => child,
        signal: controller.signal,
        terminationGraceMs: 1,
        forceSettleMs: 1,
      });

      await vi.waitFor(() => expect(child.stdinText).toBe("Implement."));
      const rejection = expect(execution).rejects.toMatchObject({
        name: "AbortError",
      });
      controller.abort();
      await vi.advanceTimersByTimeAsync(2);
      expect(child.killedSignals).toEqual(["SIGTERM", "SIGKILL"]);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid input before checking subscription status", async () => {
    const preflight = vi.fn(async () => SUBSCRIPTION_STATUS);
    await expect(
      runClaudeCodeParticipant({
        role: "driver",
        prompt: "",
        cwd: "/tmp/workspace",
        preflight,
      }),
    ).rejects.toThrow("prompt is required");
    expect(preflight).not.toHaveBeenCalled();
  });

  it("parses subscription auth status with the caller's sanitized environment", async () => {
    const execute = vi.fn(async () => ({
      stdout: JSON.stringify(SUBSCRIPTION_STATUS),
    }));
    await expect(
      readClaudeCodeSubscriptionStatus({
        command: "/Applications/Agent Native.app/Contents/Resources/claude",
        env: {
          PATH: "/usr/bin",
          ANTHROPIC_API_KEY: "must-not-pass",
        },
        execute: execute as never,
      }),
    ).resolves.toMatchObject(SUBSCRIPTION_STATUS);
    expect(execute).toHaveBeenCalledWith(
      "/Applications/Agent Native.app/Contents/Resources/claude",
      ["auth", "status", "--json"],
      expect.objectContaining({ env: { PATH: "/usr/bin" } }),
    );
  });

  it("stops a stream that exceeds its configured event bound", async () => {
    const child = new FakeClaudeChild();
    const spawnProcess = vi.fn<ClaudeCodeParticipantSpawn>(() => child);
    const execution = runClaudeCodeParticipant({
      role: "watchdog",
      prompt: "Review.",
      cwd: "/tmp/workspace",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess,
      maxEvents: 1,
    });

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    child.stdout.write('{"type":"system"}\n{"type":"result"}\n');
    expect(child.killedWith).toBe("SIGTERM");
    child.close(null, "SIGTERM");
    await expect(execution).rejects.toThrow(
      "Claude Code stream exceeded 1 events.",
    );
  });

  it("redacts credential-like stderr before returning it", async () => {
    const child = new FakeClaudeChild();
    const execution = runClaudeCodeParticipant({
      role: "watchdog",
      prompt: "Review.",
      cwd: "/tmp/workspace",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess: () => child,
    });
    await vi.waitFor(() => expect(child.stdinText).toBe("Review."));
    child.stderr.write(
      '{"access_token":"example-secret-value","safe":"visible"}',
    );
    child.close(0);
    await expect(execution).resolves.toMatchObject({
      stderr: '{"access_token":"<redacted>","safe":"visible"}',
    });
  });

  it("redacts quoted credentials from failure messages", async () => {
    const child = new FakeClaudeChild();
    const execution = runClaudeCodeParticipant({
      role: "watchdog",
      prompt: "Review.",
      cwd: "/tmp/workspace",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess: () => child,
    });
    await vi.waitFor(() => expect(child.stdinText).toBe("Review."));
    child.stderr.write("'refresh_token':'example-secret-value'");
    child.close(1);
    const error = await execution.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("refresh_token");
    expect((error as Error).message).toContain("<redacted>");
    expect((error as Error).message).not.toContain("example-secret-value");
  });

  it("settles a stdin EPIPE without an unhandled stream error", async () => {
    const child = new FakeClaudeChild();
    const execution = runClaudeCodeParticipant({
      role: "watchdog",
      prompt: "Review.",
      cwd: "/tmp/workspace",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess: () => child,
    });
    await vi.waitFor(() => expect(child.stdinText).toBe("Review."));
    child.stdin.emit(
      "error",
      Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
    );
    expect(child.killedWith).toBe("SIGTERM");
    child.close(null, "SIGTERM");
    await expect(execution).rejects.toThrow("write EPIPE");
  });

  it("settles a stdout stream error without an unhandled error event", async () => {
    const child = new FakeClaudeChild();
    const execution = runClaudeCodeParticipant({
      role: "watchdog",
      prompt: "Review.",
      cwd: "/tmp/workspace",
      preflight: async () => SUBSCRIPTION_STATUS,
      spawnProcess: () => child,
    });
    await vi.waitFor(() => expect(child.stdinText).toBe("Review."));
    child.stdout.emit("error", new Error("stdout failed"));
    expect(child.killedWith).toBe("SIGTERM");
    child.close(null, "SIGTERM");
    await expect(execution).rejects.toThrow("stdout failed");
  });

  it("records the locally verified Claude Code version", () => {
    expect(CLAUDE_CODE_PARTICIPANT_TESTED_VERSION).toBe("2.1.208");
  });
});

class FakeClaudeChild
  extends EventEmitter
  implements ClaudeCodeParticipantChild
{
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  stdinText = "";
  killedWith?: NodeJS.Signals;
  killedSignals: NodeJS.Signals[] = [];

  constructor() {
    super();
    this.stdin.on("data", (chunk) => {
      this.stdinText += chunk.toString();
    });
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal;
    if (signal) this.killedSignals.push(signal);
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("close", code, signal);
  }
}
