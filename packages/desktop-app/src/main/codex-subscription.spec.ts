import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  CodexSubscriptionAdapter,
  createCodexAppServerClient,
  probeCodexSubscription,
  type CodexAppServerClient,
  type CodexJsonRpcChildProcess,
} from "./codex-subscription.js";

describe("probeCodexSubscription", () => {
  it("uses the CLI only and returns a non-secret connection state", () => {
    const command = vi.fn((args: string[]) =>
      args[0] === "--version"
        ? { status: 0, stdout: "codex-cli 1.2.3" }
        : { status: 0, stdout: "Logged in using ChatGPT" },
    );

    expect(probeCodexSubscription(command)).toEqual({
      state: "connected",
      version: "codex-cli 1.2.3",
      authMethod: "ChatGPT",
    });
    expect(command).toHaveBeenCalledWith(["--version"], 1_500);
    expect(command).toHaveBeenCalledWith(["login", "status"], 1_500);
  });

  it("does not turn a missing CLI into an authentication error", () => {
    expect(
      probeCodexSubscription(() => ({
        status: null,
        error: { code: "ENOENT" },
      })),
    ).toMatchObject({ state: "unavailable" });
  });
});

describe("createCodexAppServerClient", () => {
  it("uses JSON-RPC over stdio, resolves responses, and forwards notifications", async () => {
    const child = createFakeChild();
    const client = createCodexAppServerClient(() => child, 100);
    const notification = vi.fn();
    client.onNotification(notification);

    const request = client.request("initialize", {
      clientInfo: { name: "test" },
    });
    expect(JSON.parse(child.writes[0] ?? "")).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    child.stdout.emit(
      "data",
      Buffer.from(
        '{"jsonrpc":"2.0","method":"account/rateLimits/updated","params":{"rateLimits":{}}}\n{"jsonrpc":"2.0","id":1,"result":{}}\n',
      ),
    );

    await expect(request).resolves.toEqual({});
    expect(notification).toHaveBeenCalledWith("account/rateLimits/updated", {
      rateLimits: {},
    });
  });

  it("bounds a stalled experimental request with a timeout", async () => {
    vi.useFakeTimers();
    try {
      const client = createCodexAppServerClient(() => createFakeChild(), 100);
      const expectation = expect(
        client.request("account/read"),
      ).rejects.toThrow("Codex app-server request timed out.");
      await vi.advanceTimersByTimeAsync(100);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CodexSubscriptionAdapter", () => {
  it("initializes one long-lived server and maps account plus model-tier meters", async () => {
    const runCommand = vi.fn(signedInCommand);
    const client = createClient([
      {},
      {
        account: {
          type: "chatgpt",
          email: "person@example.test",
          planType: "plus",
        },
      },
      {
        rateLimits: {
          limitId: "codex",
          primary: {
            usedPercent: 42,
            windowDurationMins: 300,
            resetsAt: 1_784_000_000,
          },
          secondary: {
            usedPercent: 8,
            windowDurationMins: 10_080,
            resetsAt: 1_784_500_000,
          },
          credits: { hasCredits: true, unlimited: false, balance: "3" },
        },
        rateLimitsByLimitId: {
          gpt5: {
            limitId: "gpt5",
            limitName: "GPT-5",
            secondary: {
              usedPercent: 18,
              windowDurationMins: 10_080,
              resetsAt: 1_784_500_000,
            },
          },
        },
      },
    ]);
    const adapter = new CodexSubscriptionAdapter({
      runCommand,
      createAppServerClient: () => client,
      now: () => new Date("2026-07-19T00:00:00.000Z"),
    });

    const status = await adapter.start();

    expect(client.request).toHaveBeenNthCalledWith(
      1,
      "initialize",
      expect.any(Object),
    );
    expect(status).toMatchObject({
      schemaVersion: 1,
      providerId: "codex",
      connectionState: "connected",
      account: { email: "person@example.test" },
      plan: { type: "plus" },
      telemetry: {
        state: "live",
        source: "codex-app-server",
        capabilities: {
          rateLimits: true,
          modelTierRateLimits: true,
          liveUpdates: true,
        },
        credits: { state: "available", balance: "3" },
      },
    });
    expect(status.telemetry.meters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codex:primary",
          kind: "five-hour",
          usedPercent: 42,
        }),
        expect.objectContaining({
          id: "codex:secondary",
          kind: "weekly",
          usedPercent: 8,
        }),
        expect.objectContaining({
          id: "gpt5:secondary",
          kind: "model-tier-weekly",
          modelTier: "GPT-5",
          usedPercent: 18,
        }),
      ]),
    );

    client.emitNotification("account/rateLimits/updated", {
      rateLimits: { limitId: "codex", primary: { usedPercent: 64 } },
    });
    expect(adapter.getStatus().telemetry.meters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codex:primary",
          usedPercent: 64,
          windowDurationMinutes: 300,
        }),
      ]),
    );
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it("keeps a connected account when experimental rate limits are unsupported", async () => {
    const client = createClient([
      {},
      { account: { type: "chatgpt", planType: "plus" } },
      new Error("unsupported method"),
    ]);
    const adapter = new CodexSubscriptionAdapter({
      runCommand: signedInCommand,
      createAppServerClient: () => client,
      restartDelayMs: () => 1_000_000,
    });

    const status = await adapter.start();
    adapter.stop();

    expect(status).toMatchObject({
      connectionState: "connected",
      plan: { type: "plus" },
      telemetry: { state: "unsupported", source: "connection-only" },
    });
  });

  it("labels windows from their reported duration instead of their slot name", async () => {
    const client = createClient([
      {},
      { account: { type: "chatgpt", planType: "pro" } },
      {
        rateLimits: {
          primary: { usedPercent: 34, windowDurationMins: 10_080 },
        },
      },
    ]);
    const adapter = new CodexSubscriptionAdapter({
      runCommand: signedInCommand,
      createAppServerClient: () => client,
    });

    const status = await adapter.start();
    adapter.stop();

    expect(status.telemetry.meters).toEqual([
      expect.objectContaining({
        id: "codex:primary",
        kind: "weekly",
        label: "Weekly",
        usedPercent: 34,
      }),
    ]);
  });

  it("marks telemetry stale and schedules a bounded reconnect after process exit", async () => {
    vi.useFakeTimers();
    try {
      const client = createClient([
        {},
        { account: { type: "chatgpt", planType: "plus" } },
        { rateLimits: { limitId: "codex", primary: { usedPercent: 2 } } },
      ]);
      const adapter = new CodexSubscriptionAdapter({
        runCommand: signedInCommand,
        createAppServerClient: () => client,
        restartDelayMs: () => 100,
      });
      await adapter.start();
      client.emitExit();

      expect(adapter.getStatus().telemetry.state).toBe("stale");
      await vi.advanceTimersByTimeAsync(100);
      expect(client.request).toHaveBeenCalledTimes(6);
      adapter.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

function signedInCommand(args: string[]) {
  return args[0] === "--version"
    ? { status: 0, stdout: "codex-cli 1.2.3" }
    : { status: 0, stdout: "Logged in using ChatGPT" };
}

function createClient(responses: unknown[]): CodexAppServerClient & {
  request: ReturnType<typeof vi.fn>;
  emitNotification: (method: string, params: unknown) => void;
  emitExit: () => void;
} {
  const notificationListeners = new Set<
    (method: string, params: unknown) => void
  >();
  const exitListeners = new Set<() => void>();
  const request = vi.fn(async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  });
  return {
    request,
    onNotification(listener) {
      notificationListeners.add(listener);
      return () => notificationListeners.delete(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    close: vi.fn(),
    emitNotification: (method, params) => {
      for (const listener of notificationListeners) listener(method, params);
    },
    emitExit: () => {
      for (const listener of exitListeners) listener();
    },
  };
}

function createFakeChild(): CodexJsonRpcChildProcess & {
  writes: string[];
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as CodexJsonRpcChildProcess & {
    writes: string[];
    kill: ReturnType<typeof vi.fn>;
  };
  child.writes = [];
  child.stdout = new EventEmitter() as CodexJsonRpcChildProcess["stdout"];
  child.stdin = {
    write: (value: string) => {
      child.writes.push(value);
      return true;
    },
  } as CodexJsonRpcChildProcess["stdin"];
  child.kill = vi.fn(() => true);
  return child;
}
