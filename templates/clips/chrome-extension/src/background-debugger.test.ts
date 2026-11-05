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
  failLookup?: (tabId: number, attached: number[]) => boolean,
) {
  vi.resetModules();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const attached: number[] = [];
  const detached: number[] = [];
  const failedDetaches = new Set<number>();
  let lastError: { message: string } | undefined;
  let onMessage: MessageListener | undefined;
  let onExternalMessage: MessageListener | undefined;
  const activatedListeners: Array<
    (info: { tabId: number; windowId: number }) => void
  > = [];
  const attachedListeners: Array<() => void> = [];
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
      get lastError() {
        return lastError;
      },
      getManifest: () => ({ update_url: "https://example.test/update" }),
      onInstalled: event(),
      onMessage: {
        addListener: (listener: MessageListener) => (onMessage = listener),
      },
      onMessageExternal: {
        addListener: (listener: MessageListener) =>
          (onExternalMessage = listener),
      },
      onConnect: event(),
    },
    storage: {
      session: {
        get: (_keys: string[], callback: (value: typeof stored) => void) =>
          callback(stored),
        set: (value: Partial<typeof stored>, callback: () => void) => {
          Object.assign(stored, value);
          callback();
        },
      },
    },
    tabs: {
      get: async (tabId: number) => {
        if (failLookup?.(tabId, attached))
          throw new Error(`lookup failed: ${tabId}`);
        return { id: tabId, windowId: windows[tabId] };
      },
      query: async ({ windowId }: { windowId: number }) =>
        Object.entries(windows)
          .filter(([, id]) => id === windowId)
          .map(([id, currentWindowId]) => ({
            id: Number(id),
            windowId: currentWindowId,
          })),
      onAttached: {
        addListener: (listener: () => void) => attachedListeners.push(listener),
      },
      onActivated: {
        addListener: (
          listener: (info: { tabId: number; windowId: number }) => void,
        ) => activatedListeners.push(listener),
      },
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
        if (failedDetaches.has(tabId))
          lastError = { message: `detach failed: ${tabId}` };
        callback();
        lastError = undefined;
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
  if (!onExternalMessage)
    throw new Error("external message listener not registered");
  const externalMessage = onExternalMessage;
  return {
    attached,
    detached,
    failedDetaches,
    activate: (tabId: number, windowId: number) =>
      activatedListeners.forEach((listener) => listener({ tabId, windowId })),
    moved: () => attachedListeners.forEach((listener) => listener()),
    start: () =>
      new Promise((resolve) =>
        externalMessage(
          { type: "CLIPS_CAPTURE_START", sessionId: "session-1" },
          {},
          resolve,
        ),
      ),
  };
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

  it("isolates a missing recent tab without reporting a target attach error", async () => {
    let failed = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await restoreRecording(
      [{ tabId: 2, windowId: 1, lastActiveMs: NOW - 100 }],
      { 1: 1, 2: 1 },
      undefined,
      (tabId) => tabId === 2 && !failed && (failed = true),
    );
    expect(await result.start()).toMatchObject({
      attached: true,
      attachError: null,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      2,
      expect.objectContaining({ message: "lookup failed: 2" }),
    );
  });

  it("detaches a recent tab if its post-attach lookup fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let failed = false;
    const result = await restoreRecording(
      [{ tabId: 2, windowId: 1, lastActiveMs: NOW - 100 }],
      { 1: 1, 2: 1 },
      undefined,
      (tabId, attached) =>
        tabId === 2 && attached.includes(2) && !failed && (failed = true),
    );
    expect(result.detached).toEqual([2]);
    expect(await result.start()).toMatchObject({
      attached: true,
      attachError: null,
    });
  });

  it("reports a failed target lookup as a session error", async () => {
    let failTarget = false;
    const result = await restoreRecording(
      [],
      { 1: 1, 2: 1 },
      undefined,
      (tabId) => failTarget && tabId === 1,
    );
    failTarget = true;
    expect(await result.start()).toMatchObject({
      attachError: expect.stringContaining("lookup failed: 1"),
    });
  });

  it("reports a target lookup failure while checking a recent tab and detaches it", async () => {
    let failed = false;
    const result = await restoreRecording(
      [{ tabId: 2, windowId: 1, lastActiveMs: NOW - 100 }],
      { 1: 1, 2: 1 },
      undefined,
      (tabId, attached) =>
        tabId === 1 && attached.includes(2) && !failed && (failed = true),
    );
    expect(result.detached).toEqual([2]);
    expect(await result.start()).toMatchObject({
      attachError: expect.stringContaining("lookup failed: 1"),
    });
  });

  it("detaches an activated tab when its post-attach lookup fails and follows later activations", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let failed = false;
    const result = await restoreRecording(
      [],
      { 1: 1, 2: 1, 3: 1 },
      undefined,
      (tabId, attached) =>
        tabId === 2 && attached.includes(2) && !failed && (failed = true),
    );
    result.activate(2, 1);
    await vi.waitFor(() => expect(result.detached).toContain(2));
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: "lookup failed: 2" }),
    );
    result.activate(3, 1);
    await vi.waitFor(() => expect(result.attached).toContain(3));
  });

  it("detaches an unknown tab and continues cleanup for a later moved tab", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const windows = { 1: 1, 2: 1, 3: 1 };
    let failTab = false;
    const result = await restoreRecording(
      [2, 3].map((tabId) => ({
        tabId,
        windowId: 1,
        lastActiveMs: NOW - tabId,
      })),
      windows,
      undefined,
      (tabId) => failTab && tabId === 2,
    );
    expect(result.attached).toEqual([1, 2, 3]);
    failTab = true;
    windows[3] = 2;
    result.moved();
    await vi.waitFor(() => expect(result.detached).toEqual([2, 3]));
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      2,
      expect.objectContaining({ message: "lookup failed: 2" }),
    );
  });

  it("reports a failed detach, continues cleanup, and retries the still-attached tab", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const windows = { 1: 1, 2: 1, 3: 1 };
    const result = await restoreRecording(
      [2, 3].map((tabId) => ({
        tabId,
        windowId: 1,
        lastActiveMs: NOW - tabId,
      })),
      windows,
    );
    result.failedDetaches.add(2);
    windows[2] = 2;
    windows[3] = 2;
    result.moved();
    await vi.waitFor(() => expect(result.detached).toEqual([2, 3]));
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      2,
      expect.objectContaining({ message: "detach failed: 2" }),
    );
    result.failedDetaches.delete(2);
    result.moved();
    await vi.waitFor(() => expect(result.detached).toEqual([2, 3, 2]));
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
