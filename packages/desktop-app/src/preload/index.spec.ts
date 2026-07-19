import { beforeAll, describe, expect, it, vi } from "vitest";

import { MULTI_FRONTIER_CHANNELS } from "../../shared/multi-frontier-channels.js";

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    exposed: undefined as unknown,
    invoke: vi.fn(async () => undefined),
    send: vi.fn(),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      listeners.set(channel, listener);
    }),
    removeListener: vi.fn(
      (channel: string, listener: (...args: unknown[]) => void) => {
        if (listeners.get(channel) === listener) listeners.delete(channel);
      },
    ),
    listeners,
  };
});

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, value: unknown) => {
      electron.exposed = value;
    }),
  },
  ipcRenderer: {
    invoke: electron.invoke,
    send: electron.send,
    on: electron.on,
    removeListener: electron.removeListener,
  },
}));

describe("multi-frontier preload API", () => {
  beforeAll(async () => {
    await import("./index.js");
  });

  it("exposes intent-shaped invokes without raw channels", async () => {
    const api = exposedMultiFrontierApi();
    await api.create({
      prompt: "Plan it.",
      cwd: "/workspace",
      autoContinueAfterAgreement: false,
    });
    await api.roleSwap("collaboration-1", "claude-1");

    expect(electron.invoke).toHaveBeenCalledWith(
      MULTI_FRONTIER_CHANNELS.create,
      {
        prompt: "Plan it.",
        cwd: "/workspace",
        autoContinueAfterAgreement: false,
      },
    );
    expect(electron.invoke).toHaveBeenCalledWith(
      MULTI_FRONTIER_CHANNELS.roleSwap,
      {
        collaborationId: "collaboration-1",
        nextDriverParticipantId: "claude-1",
      },
    );
    expect(api).not.toHaveProperty("ipcRenderer");
  });

  it("filters subscription envelopes and removes its exact listener", () => {
    const api = exposedMultiFrontierApi();
    const callback = vi.fn();
    const unsubscribe = api.subscribe("collaboration-1", callback);
    const subscribeCall = electron.send.mock.calls.find(
      (call) => call[0] === MULTI_FRONTIER_CHANNELS.subscribe,
    );
    const subscriptionId = subscribeCall?.[1]?.subscriptionId as string;
    const listener = electron.listeners.get(MULTI_FRONTIER_CHANNELS.events)!;
    const event = {
      schemaVersion: 1 as const,
      type: "event" as const,
      collaborationId: "collaboration-1",
      sequence: 0,
      event: { kind: "notice" as const, text: "Ready" },
    };
    listener({}, { subscriptionId: "other", event });
    listener({}, { subscriptionId, event });
    expect(callback).toHaveBeenCalledOnce();

    unsubscribe();
    expect(electron.removeListener).toHaveBeenCalledWith(
      MULTI_FRONTIER_CHANNELS.events,
      listener,
    );
    expect(electron.send).toHaveBeenCalledWith(
      MULTI_FRONTIER_CHANNELS.unsubscribe,
      { subscriptionId },
    );
  });
});

function exposedMultiFrontierApi() {
  return (
    electron.exposed as {
      multiFrontier: {
        create(input: {
          prompt: string;
          cwd?: string;
          autoContinueAfterAgreement: boolean;
        }): Promise<unknown>;
        roleSwap(
          collaborationId: string,
          nextDriverParticipantId: string,
        ): Promise<unknown>;
        subscribe(
          collaborationId: string,
          callback: (event: unknown) => void,
        ): () => void;
      };
    }
  ).multiFrontier;
}
