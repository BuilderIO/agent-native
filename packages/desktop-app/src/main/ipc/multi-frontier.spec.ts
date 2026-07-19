import { describe, expect, it, vi } from "vitest";

import { MULTI_FRONTIER_CHANNELS } from "../../../shared/multi-frontier-channels.js";
import type { MultiFrontierIpcEvent } from "../../../shared/multi-frontier-ipc.js";
import {
  registerMultiFrontierIpc,
  type MultiFrontierIpcHost,
  type MultiFrontierIpcMain,
} from "./multi-frontier.js";

describe("registerMultiFrontierIpc", () => {
  it("rejects hostile renderer input before it reaches the host", async () => {
    const ipc = createIpcMain();
    const host = createHost();
    registerMultiFrontierIpc({ ipcMain: ipc, host });

    await expect(
      ipc.invoke(MULTI_FRONTIER_CHANNELS.providerStatus, "openai"),
    ).resolves.toEqual({
      error: { message: "Invalid subscription provider." },
    });
    await expect(
      ipc.invoke(MULTI_FRONTIER_CHANNELS.create, {
        prompt: "x".repeat(13_000),
        cwd: "/tmp",
        autoContinueAfterAgreement: false,
      }),
    ).resolves.toEqual({
      error: { message: "Invalid multi-frontier request." },
    });
    await expect(
      ipc.invoke(MULTI_FRONTIER_CHANNELS.roleSwap, {
        collaborationId: "../escape",
        nextDriverParticipantId: "claude-1",
      }),
    ).resolves.toEqual({
      error: { message: "Invalid multi-frontier request." },
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(
      ipc.invoke(MULTI_FRONTIER_CHANNELS.create, cyclic),
    ).resolves.toEqual({
      error: { message: "Invalid multi-frontier request." },
    });
    expect(host.create).not.toHaveBeenCalled();
    expect(host.roleSwap).not.toHaveBeenCalled();
  });

  it("sanitizes create intent and leaves cwd authority with the host", async () => {
    const ipc = createIpcMain();
    const host = createHost();
    registerMultiFrontierIpc({ ipcMain: ipc, host });

    await ipc.invoke(MULTI_FRONTIER_CHANNELS.create, {
      prompt: "Plan\u0001 safely",
      cwd: "/renderer/request\u0002",
      autoContinueAfterAgreement: true,
    });
    expect(host.create).toHaveBeenCalledWith({
      prompt: "Plan safely",
      cwd: "/renderer/request",
      autoContinueAfterAgreement: true,
    });
  });

  it("scopes unsubscribe and destroyed cleanup to the subscribing sender", () => {
    const ipc = createIpcMain();
    const host = createHost();
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();
    host.subscribe.mockReturnValueOnce(cleanupA).mockReturnValueOnce(cleanupB);
    registerMultiFrontierIpc({ ipcMain: ipc, host });
    const senderA = createSender(1);
    const senderB = createSender(2);

    ipc.send(MULTI_FRONTIER_CHANNELS.subscribe, senderA, {
      subscriptionId: "same-id",
      collaborationId: "collaboration-1",
    });
    ipc.send(MULTI_FRONTIER_CHANNELS.subscribe, senderB, {
      subscriptionId: "same-id",
      collaborationId: "collaboration-1",
    });
    ipc.send(MULTI_FRONTIER_CHANNELS.unsubscribe, senderB, {
      subscriptionId: "same-id",
    });
    expect(cleanupB).toHaveBeenCalledTimes(1);
    expect(cleanupA).not.toHaveBeenCalled();

    senderA.destroy();
    expect(cleanupA).toHaveBeenCalledTimes(1);
  });

  it("delivers only the subscribed envelope and cleans destroyed senders", () => {
    const ipc = createIpcMain();
    const host = createHost();
    let listener: ((event: MultiFrontierIpcEvent) => void) | undefined;
    const cleanup = vi.fn();
    host.subscribe.mockImplementation((_id, next) => {
      listener = next;
      return cleanup;
    });
    registerMultiFrontierIpc({ ipcMain: ipc, host });
    const sender = createSender(7);
    ipc.send(MULTI_FRONTIER_CHANNELS.subscribe, sender, {
      subscriptionId: "subscription-1",
      collaborationId: "collaboration-1",
    });
    const event: MultiFrontierIpcEvent = {
      schemaVersion: 1,
      type: "event",
      collaborationId: "collaboration-1",
      sequence: 0,
      event: { kind: "notice", text: "Ready" },
    };
    listener?.(event);
    expect(sender.sent).toEqual([
      {
        channel: MULTI_FRONTIER_CHANNELS.events,
        payload: { subscriptionId: "subscription-1", event },
      },
    ]);
    sender.destroy();
    listener?.(event);
    expect(sender.sent).toHaveLength(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("normalizes subscription events at the final IPC egress boundary", () => {
    const ipc = createIpcMain();
    const host = createHost();
    let listener: ((event: MultiFrontierIpcEvent) => void) | undefined;
    host.subscribe.mockImplementation((_id, next) => {
      listener = next;
      return vi.fn();
    });
    registerMultiFrontierIpc({ ipcMain: ipc, host });
    const sender = createSender(7);
    ipc.send(MULTI_FRONTIER_CHANNELS.subscribe, sender, {
      subscriptionId: "subscription-1",
      collaborationId: "collaboration-1",
    });

    listener?.({
      schemaVersion: 1,
      type: "event",
      collaborationId: "collaboration-1",
      sequence: 0,
      event: {
        kind: "notice",
        text: "authorization: Bearer secret-token private@example.test",
      },
      email: "private@example.test",
    } as unknown as MultiFrontierIpcEvent);
    const serialized = JSON.stringify(sender.sent);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("private@example.test");

    listener?.({
      schemaVersion: 1,
      type: "event",
      collaborationId: "other-collaboration",
      sequence: 1,
      event: { kind: "notice", text: "Wrong collaboration" },
    });
    listener?.({
      schemaVersion: 1,
      type: "event",
      collaborationId: "collaboration-1",
      sequence: 2,
      event: { kind: "notice", text: "x".repeat(16 * 1024 + 1) },
    });
    expect(sender.sent).toHaveLength(1);
  });
});

function createIpcMain() {
  const handles = new Map<
    string,
    Parameters<MultiFrontierIpcMain["handle"]>[1]
  >();
  const listeners = new Map<
    string,
    Parameters<MultiFrontierIpcMain["on"]>[1]
  >();
  return {
    handle: (channel, listener) => handles.set(channel, listener),
    on: (channel, listener) => listeners.set(channel, listener),
    removeHandler: (channel) => handles.delete(channel),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
    invoke: async (channel: string, input?: unknown) =>
      handles.get(channel)?.({ sender: createSender(99) }, input),
    send: (
      channel: string,
      sender: ReturnType<typeof createSender>,
      input?: unknown,
    ) => listeners.get(channel)?.({ sender }, input),
  } satisfies MultiFrontierIpcMain & {
    invoke(channel: string, input?: unknown): Promise<unknown>;
    send(
      channel: string,
      sender: ReturnType<typeof createSender>,
      input?: unknown,
    ): void;
  };
}

function createHost() {
  return {
    getSettings: vi.fn(() => ({ autoContinueAfterAgreement: false })),
    updateSettings: vi.fn((settings) => ({
      autoContinueAfterAgreement: settings.autoContinueAfterAgreement ?? false,
    })),
    getProviderStatus: vi.fn(async () => ({})),
    beginProviderLogin: vi.fn(async () => ({})),
    refreshProviderStatus: vi.fn(async () => ({})),
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
    start: vi.fn(async () => ({})),
    go: vi.fn(async () => ({})),
    pause: vi.fn(async () => ({})),
    resume: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({})),
    roleSwap: vi.fn(async () => ({})),
    subscribe: vi.fn(
      (
        _collaborationId: string,
        _listener: (event: MultiFrontierIpcEvent) => void,
      ) => vi.fn(),
    ),
  } satisfies MultiFrontierIpcHost;
}

function createSender(id: number) {
  const destroyedListeners: Array<() => void> = [];
  let destroyed = false;
  const sent: Array<{ channel: string; payload: unknown }> = [];
  return {
    id,
    sent,
    send: (channel: string, payload: unknown) =>
      sent.push({ channel, payload }),
    once: (event: "destroyed", listener: () => void) => {
      if (event === "destroyed") destroyedListeners.push(listener);
    },
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true;
      for (const listener of destroyedListeners.splice(0)) listener();
    },
  };
}
