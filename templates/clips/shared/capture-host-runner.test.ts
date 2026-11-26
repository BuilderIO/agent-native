import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CaptureStartAbortedError,
  createCaptureHostRunner,
  type CaptureStartGate,
  type OwnedCapture,
} from "./capture-host-runner.js";
import {
  CAPTURE_STARTUP_BUDGET_MS,
  assertCaptureTransition,
  isCaptureTerminal,
  type MotionCaptureSession,
} from "./motion-capture.js";

afterEach(() => vi.useRealTimers());

const session: MotionCaptureSession = {
  id: "session",
  hostId: "host",
  captureMode: "motion",
  maxDurationMs: 1000,
  state: "queued",
  recordingId: null,
  startedAtMs: null,
  startUncertaintyMs: null,
  observedFrameRate: null,
  error: null,
};

type Args = Record<string, unknown>;

function fakeServer(
  options: {
    intercept?: (args: Args) => unknown;
  } = {},
) {
  const server = {
    take: null as (MotionCaptureSession & { trashed?: string }) | null,
    active: false,
    released: false,
    pendingOutcome: null as string | null,
    queue(overrides: Partial<MotionCaptureSession> = {}) {
      server.take = { ...session, ...overrides };
      server.active = true;
      return server.take;
    },
    stop() {
      const take = server.take;
      if (
        take &&
        ["queued", "starting", "beginning", "recording"].includes(take.state)
      )
        take.state = "stop-requested";
    },
    reports(): Args[] {
      return call.mock.calls
        .map(([, args]) => args)
        .filter((args) => args.operation === "report");
    },
    handle(args: Args): unknown {
      const take = server.take;
      if (args.operation === "register") return { id: "host", secret: "x" };
      if (args.operation === "poll") {
        if (args.pendingOutcome)
          server.pendingOutcome = String(args.pendingOutcome);
        return { session: server.active && take ? { ...take } : null };
      }
      if (args.operation === "release") {
        if (server.active && take?.state === "queued") take.state = "cancelled";
        else if (server.active && take && !isCaptureTerminal(take.state))
          throw new Error(
            "Stop the active capture before releasing its recorder.",
          );
        server.active = false;
        server.released = true;
        return { released: true };
      }
      if (!take || take.id !== args.sessionId) throw new Error("not found");
      const state = String(args.state);
      if (isCaptureTerminal(take.state)) {
        server.active = false;
        return { ...take };
      }
      if (
        ["starting", "beginning", "recording"].includes(state) &&
        take.state === "stop-requested"
      )
        return { ...take };
      if (
        state === "beginning" &&
        take.state !== "starting" &&
        take.state !== "beginning"
      )
        return { ...take };
      assertCaptureTransition(take.state, state);
      take.state = state as MotionCaptureSession["state"];
      if (state === "recording") {
        take.recordingId = String(args.recordingId);
        take.startedAtMs = Number(args.startedAtMs);
      }
      if (isCaptureTerminal(state)) {
        take.error = (args.error as string | undefined) ?? null;
        if (
          state === "cancelled" &&
          args.recordingId &&
          take.startedAtMs === null
        )
          take.trashed = String(args.recordingId);
        server.pendingOutcome = null;
        server.active = false;
      }
      return { ...take };
    },
  };
  const call = vi.fn(async (_action: string, args: Args): Promise<unknown> => {
    const intercepted = options.intercept?.(args);
    if (intercepted !== undefined) return intercepted;
    return server.handle(args);
  });
  return { server, call };
}

function transport(call: (action: string, args: Args) => Promise<unknown>) {
  return <T>(action: string, args: Args) => call(action, args) as Promise<T>;
}

function capture(
  stop = vi.fn(async () => {}),
  discard?: () => Promise<void>,
): OwnedCapture {
  return {
    recordingId: "recording",
    startedAtMs: 100,
    startUncertaintyMs: 1,
    readMediaTime: () => ({ mediaTimeMs: 0, uncertaintyMs: 1 }),
    stop,
    ...(discard ? { discard } : {}),
  };
}

function gatedStart(owned: OwnedCapture, onBegin = () => {}) {
  return vi.fn(
    async (
      _session: MotionCaptureSession,
      _signal: AbortSignal,
      gate: CaptureStartGate,
    ) => {
      await gate.confirmBegin();
      onBegin();
      return owned;
    },
  );
}

function runnerFor(
  call: (action: string, args: Args) => Promise<unknown>,
  start: (
    session: MotionCaptureSession,
    signal: AbortSignal,
    gate: CaptureStartGate,
  ) => Promise<OwnedCapture>,
  extra: {
    cancelStartup?: () => Promise<void>;
    startupRecordingId?: () => string | null | undefined;
    onError?: (error: Error) => void;
  } = {},
) {
  return createCaptureHostRunner({
    call: transport(call),
    start,
    kind: "desktop",
    label: "test",
    surface: "screen",
    ...extra,
  });
}

it("stops locally at the bound even when all later transport requests fail", async () => {
  vi.useFakeTimers();
  let disconnected = false;
  const stop = vi.fn(async () => {});
  const { server, call } = fakeServer({
    intercept: () => {
      if (disconnected) throw new TypeError("Failed to fetch");
      return undefined;
    },
  });
  server.queue();
  const start = gatedStart(capture(stop));
  const runner = runnerFor(call, start);
  await runner.arm();
  await vi.advanceTimersByTimeAsync(10);
  expect(server.take?.state).toBe("recording");
  disconnected = true;
  await vi.advanceTimersByTimeAsync(1500);
  expect(start).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
  disconnected = false;
  await runner.disarm();
  expect(server.take?.state).toBe("complete");
  expect(server.released).toBe(true);
});

it("does not create a second recording when the READY acknowledgement is lost", async () => {
  vi.useFakeTimers();
  let lost = false;
  const stop = vi.fn(async () => {});
  const { server, call } = fakeServer({
    intercept: (args) => {
      if (args.state === "recording" && !lost) {
        lost = true;
        server.handle(args);
        throw new TypeError("response lost");
      }
      return undefined;
    },
  });
  server.queue();
  const start = gatedStart(capture(stop));
  const runner = runnerFor(call, start);
  await runner.arm();
  await vi.advanceTimersByTimeAsync(900);
  expect(start).toHaveBeenCalledTimes(1);
  expect(server.take?.state).toBe("recording");
  await runner.disarm();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(server.take?.state).toBe("complete");
});

it("disarming waits for confirmed teardown when an aborted start resolves late", async () => {
  vi.useFakeTimers();
  let resolveStart!: (value: OwnedCapture) => void;
  let resolveStop!: () => void;
  const stop = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveStop = resolve;
      }),
  );
  const { server, call } = fakeServer();
  server.queue();
  const runner = runnerFor(
    call,
    () =>
      new Promise<OwnedCapture>((resolve) => {
        resolveStart = resolve;
      }),
  );
  await runner.arm();
  await vi.advanceTimersByTimeAsync(1);
  let released = false;
  const release = runner.disarm().then(() => {
    released = true;
  });
  resolveStart(capture(stop));
  await vi.advanceTimersByTimeAsync(1);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(released).toBe(false);
  resolveStop();
  await release;
  expect(released).toBe(true);
  expect(server.take?.state).toBe("cancelled");
});

it("a failed server release cannot restart a locally disarmed surface", async () => {
  vi.useFakeTimers();
  const start = vi.fn();
  const { server, call } = fakeServer({
    intercept: (args) => {
      if (args.operation === "release") throw new TypeError("offline");
      return undefined;
    },
  });
  const runner = runnerFor(call, start);
  await runner.arm();
  await vi.advanceTimersByTimeAsync(1);
  await expect(runner.disarm()).rejects.toThrow("offline");
  server.queue();
  await vi.advanceTimersByTimeAsync(1500);
  expect(start).not.toHaveBeenCalled();
});

it("aborts startup within the startup bound without a recorder acknowledgement", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const { server, call } = fakeServer();
  server.queue();
  const runner = runnerFor(call, (_session, abortSignal) => {
    signal = abortSignal;
    return new Promise(() => {});
  });
  await runner.arm();
  await vi.advanceTimersByTimeAsync(session.maxDurationMs + 100);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(CAPTURE_STARTUP_BUDGET_MS);
  expect(signal?.aborted).toBe(true);
  expect(
    server.reports().some((args) => isCaptureTerminal(String(args.state))),
  ).toBe(false);
  const release = runner.disarm().then(
    () => null,
    (cause: unknown) => cause,
  );
  await vi.advanceTimersByTimeAsync(5100);
  expect(await release).toEqual(
    expect.objectContaining({
      message: expect.stringContaining("teardown is unconfirmed"),
    }),
  );
  expect(server.released).toBe(false);
});

it("retries a lost STARTING acknowledgement without duplicating a take", async () => {
  vi.useFakeTimers();
  let lost = false;
  const { server, call } = fakeServer({
    intercept: (args) => {
      if (args.state === "starting" && !lost) {
        lost = true;
        server.handle(args);
        throw new TypeError("response lost");
      }
      return undefined;
    },
  });
  server.queue();
  const start = gatedStart(capture());
  const runner = runnerFor(call, start);
  await runner.arm();
  await vi.advanceTimersByTimeAsync(900);
  expect(start).toHaveBeenCalledTimes(1);
  await runner.disarm();
});

it("releases one-shot authority after a confirmed startup failure", async () => {
  vi.useFakeTimers();
  const { server, call } = fakeServer();
  server.queue();
  const start = vi.fn(async () => {
    throw new Error("recorder rejected startup");
  });
  const runner = runnerFor(call, start);
  await runner.arm();
  await vi.advanceTimersByTimeAsync(900);
  expect(start).toHaveBeenCalledTimes(1);
  expect(server.take?.state).toBe("failed");
  expect(
    call.mock.calls.filter(([, args]) => args.operation === "release"),
  ).toHaveLength(1);
});

it("keeps an unconfirmed teardown owned until a successful cancellation retry", async () => {
  vi.useFakeTimers();
  let recovered = false;
  const { server, call } = fakeServer();
  server.queue();
  const runner = runnerFor(
    call,
    async () => {
      const error = new Error("native stop unconfirmed");
      error.name = "RecordingTeardownUnconfirmedError";
      throw error;
    },
    {
      cancelStartup: async () => {
        if (!recovered) throw new Error("still unconfirmed");
      },
    },
  );
  await runner.arm();
  await vi.advanceTimersByTimeAsync(10);
  expect(server.take?.state).toBe("starting");
  expect(server.released).toBe(false);
  await expect(runner.disarm()).rejects.toThrow("still unconfirmed");
  recovered = true;
  await runner.disarm();
  expect(server.take?.state).toBe("failed");
  expect(
    call.mock.calls.filter(([, args]) => args.operation === "release"),
  ).toHaveLength(1);
});

it("does not release a recorder whose stop is unconfirmed", async () => {
  vi.useFakeTimers();
  let recovered = false;
  const { server, call } = fakeServer();
  server.queue();
  const runner = runnerFor(
    call,
    gatedStart(
      capture(
        vi.fn(async () => {
          if (!recovered) {
            const error = new Error("native stop unconfirmed");
            error.name = "RecordingTeardownUnconfirmedError";
            throw error;
          }
        }),
      ),
    ),
  );
  await runner.arm();
  await vi.advanceTimersByTimeAsync(10);
  await expect(runner.disarm()).rejects.toThrow("native stop unconfirmed");
  expect(server.released).toBe(false);
  expect(server.take?.state).toBe("finalizing");
  recovered = true;
  await runner.disarm();
  expect(server.take?.state).toBe("complete");
  expect(
    call.mock.calls.filter(([, args]) => args.operation === "release"),
  ).toHaveLength(1);
});

it("reports a native recorder's own reason when its stop fails", async () => {
  vi.useFakeTimers();
  const { server, call } = fakeServer();
  server.queue();
  const runner = runnerFor(
    call,
    gatedStart(
      capture(vi.fn(() => Promise.reject("The local backup was kept."))),
    ),
  );
  await runner.arm();
  await vi.advanceTimersByTimeAsync(10);
  expect(server.take?.state).toBe("recording");
  await runner.stop();
  expect(server.take?.state).toBe("failed");
  expect(server.take?.error).toBe("The local backup was kept.");
});

it("leaves local paths and NULs out of the reason an agent reads", async () => {
  vi.useFakeTimers();
  const { server, call } = fakeServer();
  server.queue();
  const runner = runnerFor(
    call,
    gatedStart(
      capture(
        vi.fn(() =>
          Promise.reject(
            "open /Users/person/Library/Application Support/take.mp4: missing (C:\\Users\\person\\take.mp4)\u0000",
          ),
        ),
      ),
    ),
  );
  await runner.arm();
  await vi.advanceTimersByTimeAsync(10);
  await runner.stop();
  expect(server.take?.error).toBe("open a local file: missing (a local file)");
});

it("a person stopping during startup cancels the take before acknowledging stop", async () => {
  vi.useFakeTimers();
  let observedSignal: AbortSignal | undefined;
  const { server, call } = fakeServer();
  server.queue();
  const runner = runnerFor(
    call,
    (_session, signal) =>
      new Promise((_resolve, reject) => {
        observedSignal = signal;
        signal.addEventListener(
          "abort",
          () => reject(new Error("recorder stopped")),
          { once: true },
        );
      }),
  );
  await runner.arm();
  await vi.advanceTimersByTimeAsync(10);
  await runner.stop();
  expect(observedSignal?.aborted).toBe(true);
  expect(server.released).toBe(true);
  expect(server.take?.state).toBe("cancelled");
  expect(server.reports().some((args) => args.state === "recording")).toBe(
    false,
  );
});

it.each(["stop-requested", "failed", "complete"] as const)(
  "never starts the recorder when STARTING is answered with %s",
  async (answered) => {
    vi.useFakeTimers();
    const start = vi.fn(async () => capture());
    const { server, call } = fakeServer({
      intercept: (args) => {
        if (args.state !== "starting" || !server.take) return undefined;
        server.take.state = answered;
        if (isCaptureTerminal(answered)) server.active = false;
        return { ...server.take };
      },
    });
    server.queue();
    const runner = runnerFor(call, start);
    await runner.arm();
    await vi.advanceTimersByTimeAsync(900);
    expect(start).not.toHaveBeenCalled();
    expect(server.take?.state).toBe(
      answered === "stop-requested" ? "cancelled" : answered,
    );
    await runner.disarm();
  },
);

it("a stop requested during countdown ends the take without READY and keeps the host armed", async () => {
  vi.useFakeTimers();
  let observedSignal: AbortSignal | undefined;
  const { server, call } = fakeServer();
  server.queue();
  const start = vi.fn(
    (_session: MotionCaptureSession, signal: AbortSignal) =>
      new Promise<OwnedCapture>((_resolve, reject) => {
        observedSignal = signal;
        signal.addEventListener(
          "abort",
          () => reject(new Error("countdown cancelled")),
          { once: true },
        );
      }),
  );
  const runner = runnerFor(call, start);
  await runner.arm();
  await vi.advanceTimersByTimeAsync(10);
  expect(start).toHaveBeenCalledTimes(1);
  server.stop();
  await vi.advanceTimersByTimeAsync(900);
  expect(observedSignal?.aborted).toBe(true);
  expect(server.reports().map((args) => args.state)).toEqual([
    "starting",
    "cancelled",
  ]);
  expect(server.released).toBe(false);
  await runner.disarm();
});

it("reports the recording a start already created when a stop lands before READY", async () => {
  vi.useFakeTimers();
  const { server, call } = fakeServer();
  server.queue();
  const start = vi.fn(
    (_session: MotionCaptureSession, signal: AbortSignal) =>
      new Promise<OwnedCapture>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("countdown cancelled")),
          { once: true },
        );
      }),
  );
  const runner = runnerFor(call, start, {
    startupRecordingId: () => "countdown-recording",
  });
  await runner.arm();
  await vi.advanceTimersByTimeAsync(10);
  server.stop();
  await vi.advanceTimersByTimeAsync(900);
  expect(server.reports().slice(-1)[0]).toEqual(
    expect.objectContaining({
      state: "cancelled",
      recordingId: "countdown-recording",
      error:
        "Capture was stopped before the recorder was ready; the take was discarded.",
    }),
  );
  await runner.disarm();
});

it("counts the duration bound from READY, not from the start of the countdown", async () => {
  vi.useFakeTimers();
  const stop = vi.fn(async () => {});
  const { server, call } = fakeServer();
  server.queue();
  const start = vi.fn(
    async (
      _session: MotionCaptureSession,
      _signal: AbortSignal,
      gate: CaptureStartGate,
    ) => {
      // fixed-sleep-ok: a recorder startup that takes three seconds of fake time before READY
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await gate.confirmBegin();
      return capture(stop);
    },
  );
  const runner = runnerFor(call, start);
  await runner.arm();
  await vi.advanceTimersByTimeAsync(3500);
  expect(server.take?.state).toBe("recording");
  expect(stop).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(session.maxDurationMs);
  expect(stop).toHaveBeenCalledTimes(1);
  await runner.disarm();
});

describe("the begin gate", () => {
  it("never begins a recorder whose stop the server acknowledged first", async () => {
    vi.useFakeTimers();
    let began = false;
    const { server, call } = fakeServer();
    server.queue();
    const start = vi.fn(
      async (
        _session: MotionCaptureSession,
        _signal: AbortSignal,
        gate: CaptureStartGate,
      ) => {
        // fixed-sleep-ok: the countdown, which ends between two polls
        await new Promise((resolve) => setTimeout(resolve, 150));
        await gate.confirmBegin();
        began = true;
        return capture();
      },
    );
    const runner = runnerFor(call, start);
    await runner.arm();
    await vi.advanceTimersByTimeAsync(10);
    expect(server.take?.state).toBe("starting");
    server.stop();
    await vi.advanceTimersByTimeAsync(150);
    expect(began).toBe(false);
    await vi.advanceTimersByTimeAsync(900);
    expect(server.take?.state).toBe("cancelled");
    expect(server.take?.recordingId).toBeNull();
    expect(server.reports().map((args) => args.state)).toEqual([
      "starting",
      "beginning",
      "cancelled",
    ]);
    expect(server.released).toBe(false);
    await runner.disarm();
  });

  it("throws CaptureStartAbortedError once the start is aborted", async () => {
    vi.useFakeTimers();
    const { server, call } = fakeServer();
    server.queue();
    let gateError: unknown;
    const runner = runnerFor(call, async (_session, signal, gate) => {
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      gateError = await gate.confirmBegin().catch((cause: unknown) => cause);
      throw gateError;
    });
    await runner.arm();
    await vi.advanceTimersByTimeAsync(10);
    await runner.disarm();
    expect(gateError).toBeInstanceOf(CaptureStartAbortedError);
    expect(server.reports().some((args) => args.state === "beginning")).toBe(
      false,
    );
    expect(server.take?.state).toBe("cancelled");
  });

  it("discards a take stopped between the gate and READY and keeps no Clip", async () => {
    vi.useFakeTimers();
    const stop = vi.fn(async () => {});
    const discard = vi.fn(async () => {});
    const { server, call } = fakeServer();
    server.queue();
    const runner = runnerFor(
      call,
      gatedStart(capture(stop, discard), () => server.stop()),
    );
    await runner.arm();
    await vi.advanceTimersByTimeAsync(900);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(server.take).toEqual(
      expect.objectContaining({
        state: "cancelled",
        recordingId: null,
        startedAtMs: null,
        trashed: "recording",
      }),
    );
    expect(server.reports().map((args) => args.state)).toEqual([
      "starting",
      "beginning",
      "recording",
      "cancelled",
    ]);
    expect(server.released).toBe(false);
    await runner.disarm();
    expect(server.released).toBe(true);
  });

  it("falls back to stop for a client without discard, still keeping no Clip", async () => {
    vi.useFakeTimers();
    const stop = vi.fn(async () => {});
    const { server, call } = fakeServer();
    server.queue();
    const runner = runnerFor(
      call,
      gatedStart(capture(stop), () => server.stop()),
    );
    await runner.arm();
    await vi.advanceTimersByTimeAsync(900);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(server.take).toEqual(
      expect.objectContaining({ state: "cancelled", trashed: "recording" }),
    );
    await runner.disarm();
  });

  it("discards a take disarmed after the gate but before READY", async () => {
    vi.useFakeTimers();
    const discard = vi.fn(async () => {});
    let resolveBegin!: () => void;
    const { server, call } = fakeServer();
    server.queue();
    const runner = runnerFor(call, async (_session, _signal, gate) => {
      await gate.confirmBegin();
      await new Promise<void>((resolve) => {
        resolveBegin = resolve;
      });
      return capture(
        vi.fn(async () => {}),
        discard,
      );
    });
    await runner.arm();
    await vi.advanceTimersByTimeAsync(10);
    expect(server.take?.state).toBe("beginning");
    const disarmed = runner.disarm();
    resolveBegin();
    await disarmed;
    expect(discard).toHaveBeenCalledTimes(1);
    expect(server.take?.state).toBe("cancelled");
    expect(server.released).toBe(true);
  });

  it("saves a take stopped after READY, reporting finalizing before the save ends", async () => {
    vi.useFakeTimers();
    let finishSave!: () => void;
    const discard = vi.fn(async () => {});
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const { server, call } = fakeServer();
    server.queue({ maxDurationMs: 60_000 });
    const runner = runnerFor(call, gatedStart(capture(stop, discard)));
    await runner.arm();
    await vi.advanceTimersByTimeAsync(900);
    expect(server.take?.state).toBe("recording");
    server.stop();
    server.stop();
    await vi.advanceTimersByTimeAsync(450);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(server.take?.state).toBe("finalizing");
    const polls = () =>
      call.mock.calls.filter(([, args]) => args.operation === "poll").length;
    const before = polls();
    await vi.advanceTimersByTimeAsync(4000);
    expect(polls()).toBeGreaterThan(before + 5);
    finishSave();
    await vi.advanceTimersByTimeAsync(450);
    expect(server.take).toEqual(
      expect.objectContaining({ state: "complete", recordingId: "recording" }),
    );
    expect(server.take?.trashed).toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
    await runner.disarm();
  });

  it("meets the gate for a client that skipped it, and discards if the server refuses", async () => {
    vi.useFakeTimers();
    const discard = vi.fn(async () => {});
    const { server, call } = fakeServer();
    server.queue();
    const runner = runnerFor(call, async () => {
      server.stop();
      return capture(
        vi.fn(async () => {}),
        discard,
      );
    });
    await runner.arm();
    await vi.advanceTimersByTimeAsync(900);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(server.take?.state).toBe("cancelled");
    await runner.disarm();
  });
});

describe("terminal reports", () => {
  it("retries a transiently failing complete report until delivered", async () => {
    vi.useFakeTimers();
    let failures = 0;
    const { server, call } = fakeServer({
      intercept: (args) => {
        if (args.state === "complete" && failures < 6) {
          failures += 1;
          throw new TypeError("Failed to fetch");
        }
        return undefined;
      },
    });
    server.queue();
    const runner = runnerFor(call, gatedStart(capture()));
    await runner.arm();
    await vi.advanceTimersByTimeAsync(1300);
    expect(server.take?.state).toBe("finalizing");
    expect(server.pendingOutcome).toBe("complete");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(failures).toBe(6);
    expect(server.take?.state).toBe("complete");
    expect(server.pendingOutcome).toBeNull();
    await runner.disarm();
    expect(server.released).toBe(true);
  });

  it("never drops a terminal report the server refuses while the session is live", async () => {
    vi.useFakeTimers();
    let refusing = true;
    const { server, call } = fakeServer({
      intercept: (args) => {
        if (args.state === "complete" && refusing)
          throw new Error("Capture state changed concurrently");
        return undefined;
      },
    });
    server.queue();
    const runner = runnerFor(call, gatedStart(capture()));
    await runner.arm();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.take?.state).toBe("finalizing");
    expect(server.pendingOutcome).toBe("complete");
    await expect(runner.disarm()).rejects.toThrow("changed concurrently");
    expect(server.released).toBe(false);
    refusing = false;
    await runner.disarm();
    expect(server.take?.state).toBe("complete");
    expect(server.released).toBe(true);
  });

  it("drops a terminal report once the server settled the session", async () => {
    vi.useFakeTimers();
    const { server, call } = fakeServer({
      intercept: (args) => {
        if (args.state === "complete") throw new TypeError("Failed to fetch");
        return undefined;
      },
    });
    server.queue();
    const runner = runnerFor(call, gatedStart(capture()));
    await runner.arm();
    await vi.advanceTimersByTimeAsync(1100);
    if (server.take) server.take.state = "failed";
    server.active = false;
    await vi.advanceTimersByTimeAsync(1000);
    await runner.disarm();
    expect(server.released).toBe(true);
  });
});

describe("disarm", () => {
  it("settles a take the server queued before the runner polled, then releases", async () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const { server, call } = fakeServer();
    const runner = runnerFor(call, start);
    await runner.arm();
    await vi.advanceTimersByTimeAsync(10);
    server.queue();
    await runner.disarm();
    expect(start).not.toHaveBeenCalled();
    expect(server.take?.state).toBe("cancelled");
    expect(server.released).toBe(true);
  });
});
