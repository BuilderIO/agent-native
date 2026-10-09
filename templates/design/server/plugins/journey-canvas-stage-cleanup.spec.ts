import { describe, expect, it, vi } from "vitest";

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

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  registerRecurringSweepHandler: registerSweep,
}));
vi.mock("../lib/journey-canvas-stage-cleanup.js", () => ({
  runJourneyCanvasStageCleanupSweep: cleanupSweep,
}));

import registerJourneyCanvasStageCleanup from "./journey-canvas-stage-cleanup.js";

describe("journey canvas stage cleanup plugin", () => {
  it("registers the bounded cleanup as a recurring sweep", () => {
    registerJourneyCanvasStageCleanup();

    expect(registerSweep).toHaveBeenCalledWith(
      "design-journey-canvas-stage-cleanup",
      cleanupSweep,
    );
  });
});
