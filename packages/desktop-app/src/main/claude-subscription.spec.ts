import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CLAUDE_AUTH_STATUS_TIMEOUT_MS,
  executeClaudeProcess,
  getClaudeSubscriptionLoginLaunchSpec,
  isClaudeSubscriptionStatus,
  readClaudeSubscriptionStatus,
  type ClaudeProcessExecutor,
} from "./claude-subscription.js";

describe("readClaudeSubscriptionStatus", () => {
  it("maps Claude Code subscription authentication into a provider-neutral connection status", async () => {
    const execute = vi.fn<ClaudeProcessExecutor>().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        email: "person@example.test",
        orgId: "org-example",
        orgName: "Example Org",
        subscriptionType: "max",
      }),
      stderr: "",
    });

    const status = await readClaudeSubscriptionStatus({ execute });
    expect(status).toEqual({
      schemaVersion: 1,
      providerId: "claude",
      connectionState: "connected",
      authMethod: "claude.ai",
      plan: { type: "max" },
      telemetry: {
        state: "unsupported",
        source: "connection-only",
        capabilities: {
          account: false,
          plan: true,
          rateLimits: false,
          modelTierRateLimits: false,
          contextWindow: false,
          credits: false,
          liveUpdates: false,
        },
        meters: [],
        error: {
          message:
            "Claude Code does not expose live plan usage to non-interactive sessions.",
        },
      },
    });
    expect(execute).toHaveBeenCalledWith(
      "claude",
      ["auth", "status", "--json"],
      { timeoutMs: DEFAULT_CLAUDE_AUTH_STATUS_TIMEOUT_MS },
    );
    expect(status).not.toHaveProperty("account");
  });

  it("keeps a signed-out CLI distinct from an unavailable CLI", async () => {
    const execute: ClaudeProcessExecutor = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ loggedIn: false, authMethod: "claudeai" }),
      stderr: "",
    });

    await expect(readClaudeSubscriptionStatus({ execute })).resolves.toEqual({
      schemaVersion: 1,
      providerId: "claude",
      connectionState: "needs-sign-in",
      authMethod: "claudeai",
      telemetry: {
        state: "unavailable",
        source: "connection-only",
        capabilities: {
          account: false,
          plan: false,
          rateLimits: false,
          modelTierRateLimits: false,
          contextWindow: false,
          credits: false,
          liveUpdates: false,
        },
        meters: [],
      },
    });
  });

  it("does not advertise plan capability when Claude omits the plan tier", async () => {
    const status = await readClaudeSubscriptionStatus({
      execute: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          loggedIn: true,
          authMethod: "claude.ai",
        }),
        stderr: "",
      }),
    });

    expect(status.telemetry).toMatchObject({
      state: "unsupported",
      capabilities: { account: false, plan: false },
    });
    expect(status).not.toHaveProperty("account");
    expect(status).not.toHaveProperty("plan");
  });

  it.each([
    { exitCode: 1, stdout: "", stderr: "not logged in" },
    { exitCode: 0, stdout: "not json", stderr: "" },
    { exitCode: null, stdout: "", stderr: "", timedOut: true },
  ])("does not expose process failures as account data", async (result) => {
    const execute: ClaudeProcessExecutor = async () => result;

    await expect(readClaudeSubscriptionStatus({ execute })).resolves.toEqual({
      schemaVersion: 1,
      providerId: "claude",
      connectionState: "unavailable",
      telemetry: {
        state: "unavailable",
        source: "connection-only",
        capabilities: {
          account: false,
          plan: false,
          rateLimits: false,
          modelTierRateLimits: false,
          contextWindow: false,
          credits: false,
          liveUpdates: false,
        },
        meters: [],
      },
    });
  });

  it("does not treat API or console authentication as a Claude subscription", async () => {
    const execute: ClaudeProcessExecutor = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: "api_key",
        email: "person@example.test",
        orgId: "org-example",
        orgName: "Example Org",
        subscriptionType: "max",
      }),
      stderr: "",
    });

    const status = await readClaudeSubscriptionStatus({ execute });

    expect(status).toMatchObject({
      connectionState: "connected",
      authMethod: "api_key",
      connectionMessage:
        "Claude Code is authenticated with API or console billing, not a Claude subscription.",
      telemetry: {
        source: "connection-only",
        capabilities: { account: false, plan: false },
      },
    });
    expect(status.plan).toBeUndefined();
    expect(status).not.toHaveProperty("account");
    expect(isClaudeSubscriptionStatus(status)).toBe(false);
  });
});

describe("getClaudeSubscriptionLoginLaunchSpec", () => {
  it("uses a fixed subscription-login command on macOS", () => {
    expect(getClaudeSubscriptionLoginLaunchSpec("darwin")).toEqual({
      ok: true,
      command: "/usr/bin/osascript",
      args: [
        "-e",
        'tell application "Terminal" to do script "claude auth login --claudeai"',
        "-e",
        'tell application "Terminal" to activate',
      ],
    });
  });

  it("selects a supported Linux terminal without accepting caller-controlled command text", () => {
    expect(
      getClaudeSubscriptionLoginLaunchSpec(
        "linux",
        (command) => command === "gnome-terminal",
      ),
    ).toEqual({
      ok: true,
      command: "gnome-terminal",
      args: ["--", "claude", "auth", "login", "--claudeai"],
    });
  });

  it("returns guidance instead of a shell fallback when no terminal is available", () => {
    expect(getClaudeSubscriptionLoginLaunchSpec("linux", () => false)).toEqual({
      ok: false,
      error:
        "No supported terminal emulator was found. Install a terminal emulator and try again.",
    });
  });
});

describe("executeClaudeProcess", () => {
  it("escalates a timed-out child through TERM and KILL before forced settlement", async () => {
    vi.useFakeTimers();
    try {
      const child = createFakeProcess();
      const execution = executeClaudeProcess(
        "claude",
        ["auth", "status", "--json"],
        { timeoutMs: 1 },
        () => child,
      );
      const result = expect(execution).resolves.toMatchObject({
        exitCode: null,
        timedOut: true,
      });

      await vi.advanceTimersByTimeAsync(501);
      expect(child.killedSignals).toEqual(["SIGTERM", "SIGKILL"]);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it("reaps a wedged child after a stdout stream error", async () => {
    vi.useFakeTimers();
    try {
      const child = createFakeProcess();
      const execution = executeClaudeProcess(
        "claude",
        ["auth", "status", "--json"],
        { timeoutMs: 10_000 },
        () => child,
      );
      const result = expect(execution).resolves.toMatchObject({
        exitCode: null,
        timedOut: false,
      });
      child.stdout.emit("error", new Error("stdout failed"));

      await vi.advanceTimersByTimeAsync(500);
      expect(child.killedSignals).toEqual(["SIGTERM", "SIGKILL"]);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
});

function createFakeProcess(): ChildProcess & {
  stdout: PassThrough;
  stderr: PassThrough;
  killedSignals: NodeJS.Signals[];
} {
  const child = new EventEmitter() as ChildProcess & {
    stdout: PassThrough;
    stderr: PassThrough;
    killedSignals: NodeJS.Signals[];
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killedSignals = [];
  child.kill = ((signal?: NodeJS.Signals) => {
    if (signal) child.killedSignals.push(signal);
    return true;
  }) as ChildProcess["kill"];
  return child;
}
