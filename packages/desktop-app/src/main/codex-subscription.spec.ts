import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  CodexAppServerError,
  CodexSubscriptionAdapter,
  createCodexAppServerClient,
  defaultCodexCommandRunner,
  probeCodexSubscription,
  type CodexAppServerClient,
  type CodexJsonRpcChildProcess,
} from "./codex-subscription.js";

describe("probeCodexSubscription", () => {
  it("uses the CLI only and returns a non-secret connection state", async () => {
    const command = vi.fn(async (args: string[]) =>
      args[0] === "--version"
        ? { status: 0, stdout: "codex-cli 1.2.3" }
        : { status: 0, stdout: "Logged in using ChatGPT" },
    );

    await expect(probeCodexSubscription(command)).resolves.toEqual({
      state: "connected",
      version: "codex-cli 1.2.3",
      authMethod: "ChatGPT",
    });
    expect(command).toHaveBeenCalledWith(["--version"], 1_500);
    expect(command).toHaveBeenCalledWith(["login", "status"], 1_500);
  });

  it("does not turn a missing CLI into an authentication error", async () => {
    await expect(
      probeCodexSubscription(async () => ({
        status: null,
        error: { code: "ENOENT" },
      })),
    ).resolves.toMatchObject({ state: "unavailable" });
  });

  it("does not block the event loop while a CLI probe is pending", async () => {
    let timerProgressed = false;
    setTimeout(() => {
      timerProgressed = true;
    }, 0);
    const probe = probeCodexSubscription(async (args) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return args[0] === "--version"
        ? { status: 0, stdout: "codex-cli 1.2.3" }
        : { status: 0, stdout: "Logged in using ChatGPT" };
    });

    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(timerProgressed).toBe(true);
    await expect(probe).resolves.toMatchObject({ state: "connected" });
  });
});

describe("defaultCodexCommandRunner", () => {
  it("escalates a timed-out child through TERM and KILL before forced settlement", async () => {
    vi.useFakeTimers();
    try {
      const child = createFakeCommandProcess();
      const execution = defaultCodexCommandRunner(
        ["login", "status"],
        1,
        () => child,
      );
      const result = expect(execution).resolves.toMatchObject({
        status: null,
        error: { code: "ETIMEDOUT" },
      });

      await vi.advanceTimersByTimeAsync(501);
      expect(child.killedSignals).toEqual(["SIGTERM", "SIGKILL"]);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it("reaps a wedged child after a stderr stream error", async () => {
    vi.useFakeTimers();
    try {
      const child = createFakeCommandProcess();
      const execution = defaultCodexCommandRunner(
        ["login", "status"],
        10_000,
        () => child,
      );
      const result = expect(execution).resolves.toMatchObject({
        status: null,
        error: { code: "EIO" },
      });
      child.stderr.emit("error", new Error("stderr failed"));

      await vi.advanceTimersByTimeAsync(500);
      expect(child.killedSignals).toEqual(["SIGTERM", "SIGKILL"]);
      await result;
    } finally {
      vi.useRealTimers();
    }
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

  it("parses cross-chunk responses after ignoring malformed JSON-RPC lines", async () => {
    const child = createFakeChild();
    const client = createCodexAppServerClient(() => child, 100);
    const request = client.request("account/read");

    child.stdout.emit("data", Buffer.from('not-json\n{"jsonrpc":"2.0","id":'));
    child.stdout.emit("data", Buffer.from('1,"result":{"planType":"pro"}}\n'));

    await expect(request).resolves.toEqual({ planType: "pro" });
    client.close();
  });

  it("classifies only JSON-RPC method-not-found as unsupported", async () => {
    const child = createFakeChild();
    const client = createCodexAppServerClient(() => child, 100);
    const request = client.request("account/rateLimits/read");
    child.stdout.emit(
      "data",
      '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"missing"}}\n',
    );

    const error = await request.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CodexAppServerError);
    expect((error as CodexAppServerError).code).toBe("METHOD_NOT_FOUND");
    client.close();
  });

  it("caps an unterminated stdout frame and rejects pending requests", async () => {
    const child = createFakeChild();
    const client = createCodexAppServerClient(() => child, 100);
    const request = client.request("account/read");
    child.stdout.emit("data", "x".repeat(256 * 1024 + 1));

    await expect(request).rejects.toThrow("output exceeded its safety limit");
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it.each(["stdout", "stdin", "child"] as const)(
    "kills the app-server when its %s channel errors",
    async (channel) => {
      const child = createFakeChild();
      const client = createCodexAppServerClient(() => child, 100);
      const request = client.request("account/read");

      if (channel === "child") child.emit("error", new Error("process failed"));
      else child[channel].emit("error", new Error(`${channel} failed`));

      const error = await request.catch((value: unknown) => value);
      expect(error).toBeInstanceOf(CodexAppServerError);
      expect((error as CodexAppServerError).code).toBe("TRANSPORT");
      expect(child.kill).toHaveBeenCalledOnce();
    },
  );

  it("closes its owned process at most once", () => {
    const child = createFakeChild();
    const client = createCodexAppServerClient(() => child, 100);
    client.close();
    client.close();
    child.emit("exit", 0);
    expect(child.kill).toHaveBeenCalledOnce();
  });
});

describe("CodexSubscriptionAdapter", () => {
  it("shares initialization across concurrent refreshes", async () => {
    let resolveInitialize: (() => void) | undefined;
    const initialize = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });
    const client = createClient([]);
    client.request.mockImplementation(async (method: string) => {
      if (method === "initialize") {
        await initialize;
        return {};
      }
      if (method === "account/read") {
        return { account: { type: "chatgpt", planType: "pro" } };
      }
      return { rateLimits: { primary: { usedPercent: 1 } } };
    });
    const createAppServerClient = vi.fn(() => client);
    const runCommand = vi.fn(signedInCommand);
    const adapter = new CodexSubscriptionAdapter({
      runCommand,
      createAppServerClient,
    });

    const first = adapter.start();
    const second = adapter.refresh();
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(4));
    expect(createAppServerClient).toHaveBeenCalledOnce();
    expect(client.request.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
    ]);

    resolveInitialize?.();
    await Promise.all([first, second]);
    expect(
      client.request.mock.calls.filter(([method]) => method === "initialize"),
    ).toHaveLength(1);
    adapter.stop();
  });

  it("derives signed-out capabilities from the fields actually present", async () => {
    const status = await new CodexSubscriptionAdapter({
      runCommand: async (args) =>
        args[0] === "--version"
          ? { status: 0, stdout: "codex-cli 1.2.3" }
          : { status: 1, stderr: "not logged in" },
    }).start();

    expect(status).toMatchObject({
      connectionState: "needs-sign-in",
      telemetry: { capabilities: { account: false, plan: false } },
    });
    expect(status).not.toHaveProperty("account");
    expect(status).not.toHaveProperty("plan");
  });

  it("initializes one long-lived server and maps account plus model-tier meters", async () => {
    const runCommand = vi.fn(signedInCommand);
    const client = createClient([
      {},
      {
        account: {
          type: "chatgpt",
          email: "person@example.test",
          organizationId: "org-example",
          organizationName: "Example Org",
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
      plan: { type: "plus" },
      telemetry: {
        state: "live",
        source: "codex-app-server",
        capabilities: {
          account: false,
          plan: true,
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
    expect(status).not.toHaveProperty("account");
  });

  it("keeps a connected account when experimental rate limits are unsupported", async () => {
    const client = createClient([
      {},
      { account: { type: "chatgpt", planType: "plus" } },
      new CodexAppServerError("METHOD_NOT_FOUND", "unsupported method"),
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
      telemetry: {
        state: "unsupported",
        source: "connection-only",
        capabilities: { account: false, plan: true },
      },
    });
    expect(status).not.toHaveProperty("account");
  });

  it("treats a rate-limit timeout as a reconnectable error", async () => {
    const client = createClient([
      {},
      { account: { type: "chatgpt", planType: "plus" } },
      new CodexAppServerError("TIMEOUT", "request timed out"),
    ]);
    const adapter = new CodexSubscriptionAdapter({
      runCommand: signedInCommand,
      createAppServerClient: () => client,
      restartDelayMs: () => 1_000_000,
    });

    const status = await adapter.start();

    expect(status.telemetry.state).toBe("error");
    expect(status.telemetry.state).not.toBe("unsupported");
    expect(client.close).toHaveBeenCalledOnce();
    adapter.stop();
  });

  it("keeps a rate-limit transport exit as error without an unsupported overwrite", async () => {
    const client = createClient([]);
    client.request.mockImplementation(async (method: string) => {
      if (method === "initialize") return {};
      if (method === "account/read") {
        return { account: { type: "chatgpt", planType: "plus" } };
      }
      client.emitExit();
      throw new CodexAppServerError("TRANSPORT", "process exited");
    });
    const adapter = new CodexSubscriptionAdapter({
      runCommand: signedInCommand,
      createAppServerClient: () => client,
      restartDelayMs: () => 1_000_000,
    });
    const states: string[] = [];
    adapter.subscribe((status) => states.push(status.telemetry.state));

    const status = await adapter.start();

    expect(status.telemetry.state).toBe("error");
    expect(states).toEqual(["unavailable", "error"]);
    expect(states).not.toContain("unsupported");
    adapter.stop();
  });

  it("preserves stale telemetry when transport exits during a later rate-limit refresh", async () => {
    let rateReads = 0;
    const client = createClient([]);
    client.request.mockImplementation(async (method: string) => {
      if (method === "initialize") return {};
      if (method === "account/read") {
        return { account: { type: "chatgpt", planType: "plus" } };
      }
      rateReads += 1;
      if (rateReads === 1) {
        return { rateLimits: { primary: { usedPercent: 12 } } };
      }
      client.emitExit();
      throw new CodexAppServerError("TRANSPORT", "process exited");
    });
    const adapter = new CodexSubscriptionAdapter({
      runCommand: signedInCommand,
      createAppServerClient: () => client,
      restartDelayMs: () => 1_000_000,
    });

    expect((await adapter.start()).telemetry.state).toBe("live");
    const status = await adapter.refresh();

    expect(status.telemetry.state).toBe("stale");
    expect(status.telemetry.state).not.toBe("unsupported");
    adapter.stop();
  });

  it("preserves a known-good plan when a later account refresh omits it", async () => {
    const client = createClient([
      {},
      { account: { type: "chatgpt", planType: "pro" } },
      { rateLimits: { primary: { usedPercent: 10 } } },
      { account: { type: "chatgpt" } },
      { rateLimits: { primary: { usedPercent: 20 } } },
    ]);
    const adapter = new CodexSubscriptionAdapter({
      runCommand: signedInCommand,
      createAppServerClient: () => client,
    });

    await adapter.start();
    const refreshed = await adapter.refresh();
    adapter.stop();

    expect(refreshed.plan).toEqual({ type: "pro", label: "pro" });
    expect(refreshed.telemetry.capabilities).toMatchObject({
      account: false,
      plan: true,
    });
  });

  it("clears cached plan data across signed-out and unknown auth probes", async () => {
    let auth: "chatgpt" | "signed-out" | "unknown" = "chatgpt";
    const client = createClient([
      {},
      { account: { type: "chatgpt", planType: "pro" } },
      { rateLimits: { primary: { usedPercent: 10 } } },
    ]);
    const adapter = new CodexSubscriptionAdapter({
      runCommand: async (args) => {
        if (args[0] === "--version") {
          return { status: 0, stdout: "codex-cli 1.2.3" };
        }
        if (auth === "signed-out") return { status: 1, stderr: "signed out" };
        if (auth === "unknown") return { status: 0, stdout: "Logged in" };
        return { status: 0, stdout: "Logged in using ChatGPT" };
      },
      createAppServerClient: () => client,
    });

    expect((await adapter.start()).plan?.type).toBe("pro");
    auth = "signed-out";
    const signedOut = await adapter.refresh();
    expect(signedOut).not.toHaveProperty("plan");
    auth = "unknown";
    const unknown = await adapter.refresh();
    expect(unknown).not.toHaveProperty("plan");
    expect(unknown.telemetry.capabilities.plan).toBe(false);
    adapter.stop();
  });

  it("clears cached plan data when the CLI switches to API-key auth", async () => {
    let apiKey = false;
    const client = createClient([
      {},
      { account: { type: "chatgpt", planType: "pro" } },
      { rateLimits: { primary: { usedPercent: 10 } } },
    ]);
    const adapter = new CodexSubscriptionAdapter({
      runCommand: async (args) =>
        args[0] === "--version"
          ? { status: 0, stdout: "codex-cli 1.2.3" }
          : {
              status: 0,
              stdout: apiKey
                ? "Logged in using an API key"
                : "Logged in using ChatGPT",
            },
      createAppServerClient: () => client,
    });

    expect((await adapter.start()).plan?.type).toBe("pro");
    apiKey = true;
    const status = await adapter.refresh();
    expect(status.authMethod).toBe("API key");
    expect(status).not.toHaveProperty("plan");
    expect(status.telemetry.capabilities.plan).toBe(false);
    adapter.stop();
  });

  it("publishes one error when the app-server crashes during initialize", async () => {
    const client = createClient([]);
    client.request.mockImplementationOnce(async () => {
      client.emitExit();
      throw new Error("crashed during initialize");
    });
    const adapter = new CodexSubscriptionAdapter({
      runCommand: signedInCommand,
      createAppServerClient: () => client,
      restartDelayMs: () => 1_000_000,
    });
    const states: string[] = [];
    adapter.subscribe((status) => states.push(status.telemetry.state));

    const status = await adapter.start();
    adapter.stop();

    expect(status.telemetry.state).toBe("error");
    expect(states).toEqual(["unavailable", "error"]);
    expect(client.close).toHaveBeenCalledOnce();
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

  it("does not claim a window label when the CLI omits its duration", async () => {
    const client = createClient([
      {},
      { account: { type: "chatgpt", planType: "pro" } },
      { rateLimits: { primary: { usedPercent: 34 } } },
    ]);
    const adapter = new CodexSubscriptionAdapter({
      runCommand: signedInCommand,
      createAppServerClient: () => client,
    });

    const status = await adapter.start();
    adapter.stop();

    expect(status.telemetry.meters).toEqual([
      expect.objectContaining({ id: "codex:primary", usedPercent: 34 }),
    ]);
    expect(status.telemetry.meters[0]).not.toHaveProperty("label");
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

async function signedInCommand(args: string[]) {
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
  child.stdin = new EventEmitter() as CodexJsonRpcChildProcess["stdin"];
  child.stdin.write = (value: string) => {
    child.writes.push(value);
    return true;
  };
  child.kill = vi.fn(() => true);
  return child;
}

function createFakeCommandProcess(): ChildProcess & {
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
