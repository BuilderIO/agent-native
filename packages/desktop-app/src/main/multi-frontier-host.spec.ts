import { describe, expect, it, vi } from "vitest";

import type {
  MultiFrontierCollaborationResult,
  MultiFrontierIpcEvent,
  MultiFrontierRendererState,
} from "../../shared/multi-frontier-ipc.js";
import type { SubscriptionStatus } from "../../shared/subscription-status.js";
import {
  MultiFrontierHost,
  type MultiFrontierCodexStatusAdapter,
  type MultiFrontierCoordinatorBackend,
} from "./multi-frontier-host.js";
import type { MultiFrontierSettingsStore } from "./multi-frontier-settings-store.js";

describe("MultiFrontierHost", () => {
  it("owns subscription adapters, strips raw identity, and disposes once", async () => {
    const codex = createCodexAdapter(status("codex", "connected"));
    const backend = createBackend();
    const host = createHost({
      codex,
      backend,
      readClaudeStatus: async () =>
        ({
          ...status("claude", "connected"),
          email: "private@example.test",
          organizationName: "Private org",
        }) as unknown as SubscriptionStatus,
    });

    expect(await host.getProviderStatus("codex")).toMatchObject({
      status: { providerId: "codex", connectionState: "connected" },
    });
    expect(codex.start).toHaveBeenCalledTimes(1);
    await host.getProviderStatus("codex");
    expect(codex.start).toHaveBeenCalledTimes(1);
    const claude = await host.getProviderStatus("claude");
    expect(claude.status).not.toHaveProperty("email");
    expect(claude.status).not.toHaveProperty("organizationName");

    await host.dispose();
    await host.dispose();
    expect(codex.stop).toHaveBeenCalledTimes(1);
    expect(backend.dispose).toHaveBeenCalledTimes(1);
  });

  it("projects direct provider status, refresh, and login results safely", async () => {
    const hostileClaudeStatus = {
      ...status("claude", "connected"),
      authMethod: "Bearer secret-token private@example.test",
      plan: { label: "private@example.test" },
      connectionMessage: "access_token=secret-token",
      email: "private@example.test",
      organizationName: "Private organization",
      telemetry: {
        ...status("claude", "connected").telemetry,
        sourceVersion: "x".repeat(2_000),
        error: {
          message:
            "authorization: Bearer secret-token eyJheader.payload.signature",
        },
        credits: {
          state: "available",
          balance: "refresh_token=secret-token",
        },
      },
    } as unknown as SubscriptionStatus;
    const host = createHost({
      readClaudeStatus: async () => hostileClaudeStatus,
      launchDetached: async () => ({ ok: true, cwd: "/safe" }),
    });

    for (const result of [
      await host.getProviderStatus("claude"),
      await host.refreshProviderStatus("claude"),
      await host.beginProviderLogin("claude"),
    ]) {
      const serialized = JSON.stringify(result);
      expect(serialized).toContain("[redacted]");
      expect(serialized).not.toContain("secret-token");
      expect(serialized).not.toContain("private@example.test");
      expect(serialized).not.toContain("Private organization");
      expect(
        result.status?.telemetry.sourceVersion?.length,
      ).toBeLessThanOrEqual(1_024);
    }
  });

  it("publishes sanitized Codex live usage updates to provider-status listeners", () => {
    const codex = createCodexAdapter(status("codex", "connected"));
    const host = createHost({ codex });
    const events: Array<{ providerId: string; status: SubscriptionStatus }> =
      [];
    host.subscribeProviderStatus((event) => events.push(event));

    codex.publish({
      ...status("codex", "connected"),
      email: "private@example.test",
      telemetry: {
        ...status("codex", "connected").telemetry,
        state: "live",
        source: "codex-app-server",
        updatedAt: "2026-07-19T12:00:00.000Z",
        meters: [{ id: "five-hour", kind: "five-hour", usedPercent: 42 }],
      },
    } as unknown as SubscriptionStatus);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      providerId: "codex",
      status: {
        telemetry: { meters: [{ usedPercent: 42 }] },
      },
    });
    expect(JSON.stringify(events)).not.toContain("private@example.test");
  });

  it("opens only documented subscription login commands", async () => {
    const launch = vi.fn(
      async (
        _command: string,
        _args: string[],
        _cwd: string,
        _options: { waitForExit: boolean },
      ) => ({ ok: true, cwd: "/safe" }),
    );
    const host = createHost({ launchDetached: launch, platform: "darwin" });

    await host.beginProviderLogin("codex");
    await host.beginProviderLogin("claude");

    expect(launch.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        'tell application "Terminal" to do script "codex login"',
      ]),
    );
    expect(launch.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([
        'tell application "Terminal" to do script "claude auth login --claudeai"',
      ]),
    );
    expect(launch.mock.calls.every((call) => call[2] === "/safe")).toBe(true);
  });

  it("resolves cwd, generates request and participant ids in main, and forwards actions", async () => {
    const backend = createBackend();
    const resolveWorkspace = vi.fn(async () => ({
      workspaceId: "workspace-1",
    }));
    const ids = ["a", "b", "c", "d", "e"];
    const host = createHost({
      backend,
      resolveWorkspace,
      createId: () => ids.shift() ?? "fallback",
    });

    const created = await host.create({
      prompt: "Build the bounded feature.",
      cwd: "/renderer/untrusted",
      autoContinueAfterAgreement: false,
    });
    expect(resolveWorkspace).toHaveBeenCalledWith("/renderer/untrusted");
    expect(backend.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "mf-request-a",
        workspaceId: "workspace-1",
        participants: [
          { participantId: "mf-codex-b", providerId: "codex" },
          { participantId: "mf-claude-c", providerId: "claude" },
        ],
      }),
    );
    expect(created.snapshot?.collaborationId).toBe("collaboration-1");

    await host.pause("collaboration-1");
    expect(backend.pause).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pause",
        requestId: "mf-request-d",
        collaborationId: "collaboration-1",
      }),
    );
    await host.roleSwap("collaboration-1", "mf-claude-c");
    expect(backend.roleSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "role-swap",
        requestId: "mf-request-e",
        nextDriverParticipantId: "mf-claude-c",
      }),
    );
  });

  it("requires both current subscription connections before creating", async () => {
    const unavailableCodex = createCodexAdapter(
      status("codex", "needs-sign-in"),
    );
    const codexBackend = createBackend();
    const codexHost = createHost({
      codex: unavailableCodex,
      backend: codexBackend,
    });
    const apiClaude = {
      ...status("claude", "connected"),
      authMethod: "api-key",
    } as SubscriptionStatus;
    const claudeBackend = createBackend();
    const claudeHost = createHost({
      backend: claudeBackend,
      readClaudeStatus: async () => apiClaude,
    });

    for (const [host, backend] of [
      [codexHost, codexBackend],
      [claudeHost, claudeBackend],
    ] as const) {
      await expect(
        host.create({
          prompt: "Build the bounded feature.",
          autoContinueAfterAgreement: false,
        }),
      ).resolves.toEqual({
        error: {
          message:
            "Connect both subscriptions before starting a collaboration.",
        },
      });
      expect(backend.create).not.toHaveBeenCalled();
    }
  });

  it("retries a failed Codex start probe", async () => {
    const codex = createCodexAdapter(status("codex", "connected"));
    codex.start
      .mockRejectedValueOnce(new Error("transient probe failure"))
      .mockResolvedValueOnce(status("codex", "connected"));
    const host = createHost({ codex });

    await expect(host.getProviderStatus("codex")).rejects.toThrow(
      "transient probe failure",
    );
    await expect(host.getProviderStatus("codex")).resolves.toMatchObject({
      status: { connectionState: "connected" },
    });
    expect(codex.start).toHaveBeenCalledTimes(2);
  });

  it("returns a bounded actionable result when a backend action rejects", async () => {
    const backend = createBackend();
    backend.start.mockRejectedValueOnce(new Error("provider failure"));
    const host = createHost({ backend });

    await expect(host.start("collaboration-1")).resolves.toEqual({
      error: {
        message:
          "The collaboration could not continue. Check both subscriptions, then retry recovery.",
      },
    });
  });

  it("emits main-owned monotonic sequences per collaboration", () => {
    const backend = createBackend();
    const host = createHost({ backend });
    const events: MultiFrontierIpcEvent[] = [];
    const unsubscribe = host.subscribe("collaboration-1", (event) =>
      events.push(event),
    );
    const listener = backend.listeners.get("collaboration-1")!;

    listener({
      schemaVersion: 1,
      type: "event",
      collaborationId: "attacker-collaboration",
      sequence: 9_999,
      event: { kind: "notice", text: "First" },
      email: "private@example.test",
    });
    listener({
      schemaVersion: 1,
      type: "snapshot",
      collaborationId: "collaboration-1",
      sequence: 1,
      snapshot: rendererState(),
    });

    expect(events.map((event) => event.sequence)).toEqual([0, 1]);
    expect(
      events.every((event) => event.collaborationId === "collaboration-1"),
    ).toBe(true);
    expect(events[0]).not.toHaveProperty("email");
    unsubscribe();
    expect(backend.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("returns a safe failure when the injected backend breaks correlation", async () => {
    const backend = createBackend();
    backend.start.mockResolvedValue({ schemaVersion: 1, requestId: "wrong" });
    const host = createHost({ backend });
    await expect(host.start("collaboration-1")).resolves.toEqual({
      error: {
        message: "The collaboration backend returned an invalid result.",
      },
    });
  });
});

function createHost(
  options: {
    codex?: ReturnType<typeof createCodexAdapter>;
    backend?: ReturnType<typeof createBackend>;
    readClaudeStatus?: () => Promise<SubscriptionStatus>;
    resolveWorkspace?: (
      cwd: string | undefined,
    ) => Promise<{ workspaceId: string }>;
    launchDetached?: (
      command: string,
      args: string[],
      cwd: string,
      options: { waitForExit: boolean },
    ) => Promise<{ ok: boolean; cwd: string; error?: string }>;
    platform?: string;
    createId?: () => string;
  } = {},
) {
  return new MultiFrontierHost({
    coordinator: options.backend ?? createBackend(),
    settingsStore: settingsStore(),
    resolveWorkspace:
      options.resolveWorkspace ??
      (async () => ({ workspaceId: "workspace-1" })),
    loginCwd: "/safe",
    createCodexAdapter: () =>
      options.codex ?? createCodexAdapter(status("codex", "connected")),
    readClaudeStatus:
      options.readClaudeStatus ?? (async () => status("claude", "connected")),
    launchDetached: options.launchDetached,
    platform: options.platform,
    createId: options.createId,
  });
}

function createBackend() {
  const listeners = new Map<string, (event: unknown) => void>();
  const unsubscribe = vi.fn();
  const respond = async (request: {
    requestId: string;
  }): Promise<MultiFrontierCollaborationResult> => ({
    schemaVersion: 1,
    requestId: request.requestId,
    snapshot: rendererState(),
  });
  return {
    list: vi.fn(async () => [rendererState(), { raw: "ignored" }]),
    create: vi.fn(respond),
    start: vi.fn(respond),
    go: vi.fn(respond),
    pause: vi.fn(respond),
    resume: vi.fn(respond),
    cancel: vi.fn(respond),
    reReview: vi.fn(respond),
    roleSwap: vi.fn(respond),
    subscribe: vi.fn(
      (collaborationId: string, listener: (event: unknown) => void) => {
        listeners.set(collaborationId, listener);
        return unsubscribe;
      },
    ),
    dispose: vi.fn(),
    listeners,
    unsubscribe,
  } satisfies MultiFrontierCoordinatorBackend & {
    listeners: Map<string, (event: unknown) => void>;
    unsubscribe: ReturnType<typeof vi.fn>;
  };
}

function createCodexAdapter(initialStatus: SubscriptionStatus) {
  let listener: ((status: SubscriptionStatus) => void) | undefined;
  return {
    start: vi.fn(async () => initialStatus),
    refresh: vi.fn(async () => initialStatus),
    getStatus: vi.fn(() => initialStatus),
    subscribe: vi.fn((next: (status: SubscriptionStatus) => void) => {
      listener = next;
      next(initialStatus);
      return vi.fn(() => {
        listener = undefined;
      });
    }),
    publish: (next: SubscriptionStatus) => listener?.(next),
    stop: vi.fn(),
  };
}

function settingsStore(): MultiFrontierSettingsStore {
  let settings = { autoContinueAfterAgreement: false };
  return {
    read: () => ({ ...settings }),
    update: (patch) => {
      settings = { ...settings, ...patch };
      return { ...settings };
    },
  };
}

function status(
  providerId: "codex" | "claude",
  connectionState: SubscriptionStatus["connectionState"],
): SubscriptionStatus {
  return {
    schemaVersion: 1,
    providerId,
    connectionState,
    ...(connectionState === "connected"
      ? { authMethod: providerId === "codex" ? "ChatGPT" : "Claude.ai" }
      : {}),
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
  };
}

function rendererState(): MultiFrontierRendererState {
  return {
    rendererStateIsAuthoritative: false,
    collaborationId: "collaboration-1",
    phase: "proposing",
    round: 1,
    autoContinueAfterAgreement: false,
    participants: [
      {
        participantId: "codex-1",
        providerId: "codex",
        role: "watchdog",
        permission: "read_only",
        status: "waiting",
        capabilities: ["read-only"],
      },
      {
        participantId: "claude-1",
        providerId: "claude",
        role: "watchdog",
        permission: "read_only",
        status: "waiting",
        capabilities: ["read-only"],
      },
    ],
    approvalState: "not_required",
    artifacts: [],
    subscriptions: {},
  };
}
