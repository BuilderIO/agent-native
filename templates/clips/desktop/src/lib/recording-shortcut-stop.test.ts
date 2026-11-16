import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { emit, invoke, listen } = vi.hoisted(() => ({
  emit: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit, listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

let listenForRecordingShortcutStopAcks: (typeof import("./recording-shortcut-stop"))["listenForRecordingShortcutStopAcks"];
let requestRecordingShortcutStop: (typeof import("./recording-shortcut-stop"))["requestRecordingShortcutStop"];
let stopRecordingFromLink: (typeof import("./recording-shortcut-stop"))["stopRecordingFromLink"];

let unlistenAcks: (() => void) | undefined;

describe("requestRecordingShortcutStop", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({
      listenForRecordingShortcutStopAcks,
      requestRecordingShortcutStop,
      stopRecordingFromLink,
    } = await import("./recording-shortcut-stop"));
    emit.mockReset().mockResolvedValue(undefined);
    invoke.mockReset().mockResolvedValue(undefined);
    listen.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    unlistenAcks?.();
    unlistenAcks = undefined;
    vi.useRealTimers();
  });

  it("routes through the pill when its listener acknowledges the request", async () => {
    let acknowledge!: (event: { payload: string }) => void;
    listen.mockImplementation(async (_event, onAck) => {
      acknowledge = onAck;
      return vi.fn();
    });
    unlistenAcks = await listenForRecordingShortcutStopAcks();
    emit.mockImplementation(async (event, payload) => {
      if (event === "clips:tray-stop-request") {
        acknowledge({ payload: payload.requestId });
      }
    });

    await expect(requestRecordingShortcutStop()).resolves.toEqual({
      type: "pill",
    });

    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "clips:tray-stop-request",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("waits for an ack listener that is still registering", async () => {
    let acknowledge!: (event: { payload: string }) => void;
    let finishRegistration!: (unlisten: () => void) => void;
    listen.mockImplementation(
      async (_event, onAck) =>
        new Promise((resolve) => {
          acknowledge = onAck;
          finishRegistration = resolve;
        }),
    );
    const setup = listenForRecordingShortcutStopAcks();
    const stopRequest = requestRecordingShortcutStop();
    emit.mockImplementation(async (event, payload) => {
      if (event === "clips:tray-stop-request") {
        acknowledge({ payload: payload.requestId });
      }
    });

    await vi.advanceTimersByTimeAsync(100);
    finishRegistration(vi.fn());
    unlistenAcks = await setup;

    await expect(stopRequest).resolves.toEqual({ type: "pill" });
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "clips:tray-stop-request",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("stops directly if ack listener setup does not finish promptly", async () => {
    listen.mockImplementation(() => new Promise<() => void>(() => {}));
    void listenForRecordingShortcutStopAcks();

    const stopRequest = requestRecordingShortcutStop();
    await vi.advanceTimersByTimeAsync(149);
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(1);
    await expect(stopRequest).resolves.toEqual({
      type: "direct",
      reason: "acknowledgement-listener-not-ready",
    });
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });

  it.each([
    {
      name: "a stop link while the recording bar's listener isn't up yet still stops",
      recorderRunning: true,
      outcome: { type: "direct", reason: "pill-did-not-acknowledge" },
    },
    {
      name: "a stop link with no recorder object stops directly",
      recorderRunning: false,
      outcome: undefined,
    },
  ])("$name", async ({ recorderRunning, outcome }) => {
    listen.mockResolvedValue(vi.fn());
    invoke.mockImplementation(async (command: string) =>
      command === "stop_link_recording_current" ? true : undefined,
    );
    unlistenAcks = await listenForRecordingShortcutStopAcks();

    const stop = stopRecordingFromLink(recorderRunning, 7);
    await vi.advanceTimersByTimeAsync(300);

    await expect(stop).resolves.toEqual(outcome);
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
    expect(invoke).toHaveBeenCalledWith("stop_link_recording_current", {
      recording: 7,
    });
  });

  it.each([
    {
      name: "the link's recording ended before the bar was asked",
      recorderRunning: true,
      currentChecks: [false],
      events: [],
    },
    {
      name: "the link's recording ended while waiting for the bar",
      recorderRunning: true,
      currentChecks: [true, false],
      events: ["clips:tray-stop-request"],
    },
    {
      name: "the link's recording ended before a direct stop",
      recorderRunning: false,
      currentChecks: [false],
      events: [],
    },
  ])(
    "a stop link never stops a later recording: $name",
    async ({ recorderRunning, currentChecks, events }) => {
      listen.mockResolvedValue(vi.fn());
      const checks = [...currentChecks];
      invoke.mockImplementation(async (command: string) =>
        command === "stop_link_recording_current"
          ? (checks.shift() ?? false)
          : undefined,
      );
      unlistenAcks = await listenForRecordingShortcutStopAcks();

      const stop = stopRecordingFromLink(recorderRunning, 7);
      await vi.advanceTimersByTimeAsync(300);

      await expect(stop).resolves.toEqual({ type: "stale" });
      expect(emit.mock.calls.map(([event]) => event)).toEqual(events);
    },
  );

  it.each([true, false])(
    "a stop link whose recording check fails rejects, sending nothing (recorder running: %s)",
    async (recorderRunning) => {
      listen.mockResolvedValue(vi.fn());
      invoke.mockImplementation(async (command: string) => {
        if (command === "stop_link_recording_current") {
          throw new Error("ipc down");
        }
        return undefined;
      });
      unlistenAcks = await listenForRecordingShortcutStopAcks();

      const stop = stopRecordingFromLink(recorderRunning, 7);
      const outcome = expect(stop).rejects.toThrow("ipc down");
      await vi.advanceTimersByTimeAsync(300);

      await outcome;
      expect(emit).not.toHaveBeenCalled();
    },
  );

  it("stops directly when the pill does not acknowledge the request", async () => {
    listen.mockResolvedValue(vi.fn());
    unlistenAcks = await listenForRecordingShortcutStopAcks();

    const stopRequest = requestRecordingShortcutStop();
    await vi.advanceTimersByTimeAsync(0);
    expect(emit).toHaveBeenCalledWith("clips:tray-stop-request", {
      requestId: expect.any(String),
    });
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(300);
    await stopRequest;

    const trayRequests = emit.mock.calls.filter(
      ([event]) => event === "clips:tray-stop-request",
    );
    expect(trayRequests).toHaveLength(2);
    expect(trayRequests[1]).toEqual([
      "clips:tray-stop-request",
      { fallback: true },
    ]);
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });

  it("caps direct fallback waits at the absolute stop deadline", async () => {
    emit.mockImplementation((event, payload) => {
      if (event === "clips:tray-stop-request" && payload?.fallback) {
        return new Promise(() => {});
      }
      return Promise.resolve(undefined);
    });
    invoke.mockImplementation(() => new Promise(() => {}));

    const stopRequest = requestRecordingShortcutStop();
    await vi.advanceTimersByTimeAsync(69);
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(1);
    await stopRequest;

    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });

  it("keeps listener readiness inside the total fallback deadline", async () => {
    let finishRegistration!: (unlisten: () => void) => void;
    listen.mockImplementation(
      async () =>
        new Promise((resolve) => {
          finishRegistration = resolve;
        }),
    );
    const setup = listenForRecordingShortcutStopAcks();
    const stopRequest = requestRecordingShortcutStop();
    emit.mockImplementation((event, payload) => {
      if (
        event === "clips:tray-stop-request" &&
        payload &&
        typeof payload === "object" &&
        "fallback" in payload
      ) {
        return new Promise(() => {});
      }
      return Promise.resolve(undefined);
    });
    invoke.mockImplementation(() => new Promise(() => {}));

    await vi.advanceTimersByTimeAsync(149);
    finishRegistration(vi.fn());
    unlistenAcks = await setup;
    await vi.advanceTimersByTimeAsync(80);
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(70);
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(1);
    await stopRequest;

    expect(
      emit.mock.calls.filter(([event]) => event === "clips:tray-stop-request"),
    ).toHaveLength(2);
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });

  it("preserves listener registration failures as a distinct direct-stop reason", async () => {
    listen.mockRejectedValue(new Error("listener denied"));
    await expect(listenForRecordingShortcutStopAcks()).rejects.toThrow(
      "listener denied",
    );

    await expect(requestRecordingShortcutStop()).resolves.toEqual({
      type: "direct",
      reason: "acknowledgement-listener-registration-failed",
    });
    expect(emit).toHaveBeenCalledWith("clips:tray-stop-request", {
      fallback: true,
    });
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });

  it("reports an absent acknowledgement listener separately", async () => {
    await expect(requestRecordingShortcutStop()).resolves.toEqual({
      type: "direct",
      reason: "acknowledgement-listener-not-registered",
    });
    expect(emit).toHaveBeenCalledWith("clips:tray-stop-request", {
      fallback: true,
    });
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });
});

describe("listenForStopLinks", () => {
  beforeEach(() => {
    vi.resetModules();
    emit.mockReset().mockResolvedValue(undefined);
    invoke.mockReset();
    listen.mockReset();
  });

  // Native keeps one stop until it's taken.
  function nativeStopLinks(waiting: boolean) {
    let pending = waiting;
    const recording = 7;
    invoke.mockImplementation(async (command: string) => {
      if (command !== "take_pending_stop_link") return undefined;
      const taken = pending ? recording : null;
      pending = false;
      return taken;
    });
    return {
      send: () => {
        pending = true;
      },
    };
  }

  it.each([
    {
      name: "a stop sent before the listener was up is taken once it is",
      waitingAtStartup: true,
      sendAfterStartup: false,
      stops: 1,
    },
    {
      name: "a stop sent once the listener is up is taken from its event",
      waitingAtStartup: false,
      sendAfterStartup: true,
      stops: 1,
    },
    {
      name: "no stop, no action",
      waitingAtStartup: false,
      sendAfterStartup: false,
      stops: 0,
    },
  ])("$name", async ({ waitingAtStartup, sendAfterStartup, stops }) => {
    const { listenForStopLinks } = await import("./recording-shortcut-stop");
    const native = nativeStopLinks(waitingAtStartup);
    let deliver!: () => void;
    listen.mockImplementation(async (_event, onEvent) => {
      deliver = () => onEvent({ payload: null });
      return vi.fn();
    });
    const onStop = vi.fn();

    await listenForStopLinks(onStop);
    await Promise.resolve();
    if (sendAfterStartup) {
      native.send();
      deliver();
    }
    // A repeated event (or a second check) never stops twice.
    deliver();
    await vi.waitFor(() => expect(onStop).toHaveBeenCalledTimes(stops));
    for (const call of onStop.mock.calls) expect(call).toEqual([7]);
    expect(listen).toHaveBeenCalledWith(
      "clips:stop-link",
      expect.any(Function),
    );
  });
});
