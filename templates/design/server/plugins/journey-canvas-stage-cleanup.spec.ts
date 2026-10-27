import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registerSweep = vi.hoisted(() =>
  vi.fn(
    (
      _id: string,
      _handler: (context: {
        deadlineAt: number;
        signal?: AbortSignal;
      }) => Promise<void>,
    ) =>
      () => {},
  ),
);
const cleanupSweep = vi.hoisted(() => vi.fn());
const shouldDisableInProcessSweeps = vi.hoisted(() => vi.fn(() => false));
const stopInProcessCleanup = vi.hoisted(() => vi.fn());
const startIntervalJob = vi.hoisted(() =>
  vi.fn(
    (
      _run: (signal: AbortSignal) => Promise<void>,
      _options: Record<string, unknown>,
    ) => ({ stop: stopInProcessCleanup }),
  ),
);

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  registerRecurringSweepHandler: registerSweep,
  shouldDisableInProcessSweeps,
  startIntervalJob,
}));
vi.mock("../lib/journey-canvas-stage-cleanup.js", () => ({
  runJourneyCanvasStageCleanupSweep: cleanupSweep,
}));

import registerJourneyCanvasStageCleanup from "./journey-canvas-stage-cleanup.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("journey canvas stage cleanup plugin", () => {
  it("runs recurring cleanup on long-lived hosts and stops it on close", async () => {
    let onClose: (() => void) | undefined;
    registerJourneyCanvasStageCleanup({
      hooks: {
        hook: vi.fn((name: string, handler: () => void) => {
          if (name === "close") onClose = handler;
        }),
      },
    });

    expect(registerSweep).toHaveBeenCalledWith(
      "design-journey-canvas-stage-cleanup",
      cleanupSweep,
    );
    expect(startIntervalJob).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(startIntervalJob).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        intervalMs: 24 * 60 * 60 * 1_000,
        leading: true,
        timeoutMs: 5 * 60 * 1_000,
      }),
    );
    await startIntervalJob.mock.calls[0]![0](new AbortController().signal);
    expect(cleanupSweep).toHaveBeenCalledWith({
      deadlineAt: expect.any(Number),
      signal: expect.any(AbortSignal),
    });
    onClose?.();
    expect(stopInProcessCleanup).toHaveBeenCalledOnce();
  });

  it("leaves serverless cleanup to the durable sweep route", () => {
    shouldDisableInProcessSweeps.mockReturnValueOnce(true);
    registerJourneyCanvasStageCleanup({ hooks: { hook: vi.fn() } });

    expect(registerSweep).toHaveBeenCalledOnce();
    expect(startIntervalJob).not.toHaveBeenCalled();
  });
});
