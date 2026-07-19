import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  buildClaudeCodeParticipantArgs,
  CLAUDE_CODE_PARTICIPANT_TESTED_VERSION,
  ClaudeCodeSubscriptionRequiredError,
  runClaudeCodeParticipant,
  type ClaudeCodeParticipantChild,
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
        settings: { statusLineCommand: "/tmp/status-line" },
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
      "--settings",
      JSON.stringify({
        statusLine: { type: "command", command: "/tmp/status-line" },
      }),
    ]);
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

  it("spawns Claude without a shell, sends the prompt on stdin, and bounds JSON events", async () => {
    const child = new FakeClaudeChild();
    const spawnProcess = vi.fn<ClaudeCodeParticipantSpawn>(() => child);
    const onEvent = vi.fn();
    const execution = runClaudeCodeParticipant({
      role: "watchdog",
      prompt: "Review only.",
      cwd: "/tmp/workspace",
      env: {
        PATH: "/usr/bin:/bin",
        ANTHROPIC_API_KEY: "must-not-pass",
        ANTHROPIC_AUTH_TOKEN: "must-not-pass",
        CLAUDE_CODE_USE_BEDROCK: "1",
      },
      preflight: async () => SUBSCRIPTION_STATUS,
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
    expect(command).toBe("claude");
    expect(args).not.toContain("Review only.");
    expect(options).toMatchObject({
      cwd: "/tmp/workspace",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin" },
    });
    expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(options.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(options.env).not.toHaveProperty("CLAUDE_CODE_USE_BEDROCK");
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
