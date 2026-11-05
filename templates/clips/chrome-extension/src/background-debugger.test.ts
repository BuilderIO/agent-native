import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = 1_000_000_000;

type Activation = { tabId: number; windowId?: number; lastActiveMs: number };
type MessageListener = (
  message: unknown,
  sender: object,
  respond: (response: unknown) => void,
) => boolean;

async function restoreRecording(
  activations: Activation[],
  windows: Record<number, number>,
  moveOnAttach?: number,
) {
  vi.resetModules();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const attached: number[] = [];
  const detached: number[] = [];
  let onMessage: MessageListener | undefined;
  const event = () => ({ addListener: () => undefined });
  const stored = {
    activeNativeRecording: {
      sessionId: "session-1",
      recordingId: "recording-1",
      targetTabId: 1,
      startedAt: new Date(NOW).toISOString(),
      startedAtMs: NOW,
      includeDeveloperLogs: true,
      status: "recording",
    },
    recentTabActivations: activations,
  };
  vi.stubGlobal("chrome", {
    runtime: {
      getManifest: () => ({ update_url: "https://example.test/update" }),
      onInstalled: event(),
      onMessage: {
        addListener: (listener: MessageListener) => (onMessage = listener),
      },
      onMessageExternal: event(),
      onConnect: event(),
    },
    storage: {
      session: {
        get: (_keys: string[], callback: (value: typeof stored) => void) =>
          callback(stored),
      },
    },
    tabs: {
      get: async (tabId: number) => ({ id: tabId, windowId: windows[tabId] }),
      query: async ({ windowId }: { windowId: number }) =>
        Object.entries(windows)
          .filter(([, id]) => id === windowId)
          .map(([id, currentWindowId]) => ({
            id: Number(id),
            windowId: currentWindowId,
          })),
      onAttached: event(),
      onActivated: event(),
      onRemoved: event(),
      onUpdated: event(),
    },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: event() },
    action: { onClicked: event() },
    debugger: {
      attach: (
        { tabId }: { tabId: number },
        _version: string,
        callback: () => void,
      ) => {
        attached.push(tabId);
        if (tabId === moveOnAttach) windows[tabId] = 2;
        callback();
      },
      detach: ({ tabId }: { tabId: number }, callback: () => void) => {
        detached.push(tabId);
        callback();
      },
      sendCommand: (
        _target: object,
        _method: string,
        _params: object,
        callback: () => void,
      ) => callback(),
      onEvent: event(),
      onDetach: event(),
    },
  });
  await import("./background");
  if (!onMessage) throw new Error("background message listener not registered");
  await new Promise((resolve) => onMessage?.({ type: "test" }, {}, resolve));
  return { attached, detached };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("background debugger restore", () => {
  it("selects recent tabs by their current window before applying the cap", async () => {
    const activations = [
      ...[2, 3, 4, 5, 6].map((tabId) => ({
        tabId,
        windowId: 2,
        lastActiveMs: NOW - tabId,
      })),
      { tabId: 7, windowId: 2, lastActiveMs: NOW - 100 },
      { tabId: 8, windowId: 1, lastActiveMs: NOW - 200 },
    ];
    const result = await restoreRecording(activations, {
      1: 1,
      2: 2,
      3: 2,
      4: 2,
      5: 2,
      6: 2,
      7: 1,
      8: 2,
    });
    expect(result.attached).toEqual([1, 7]);
    expect(result.detached).toEqual([]);
  });

  it("detaches a selected tab if it moves while attaching", async () => {
    const result = await restoreRecording(
      [{ tabId: 7, windowId: 1, lastActiveMs: NOW - 100 }],
      { 1: 1, 7: 1 },
      7,
    );
    expect(result.attached).toEqual([1, 7]);
    expect(result.detached).toEqual([7]);
  });
});
