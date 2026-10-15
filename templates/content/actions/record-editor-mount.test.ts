import { afterEach, describe, expect, it, vi } from "vitest";
const countOutcome = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/tracking", () => ({ countOutcome }));
vi.mock("./_document-mutation-access.js", () => ({
  assertDocumentMutationAccess: access,
}));
import action from "./record-editor-mount";

describe("editor mount counts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });
  it("acknowledges the mount when telemetry cannot even be scheduled", async () => {
    const original = globalThis.setTimeout;
    const scheduler = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((...args) => {
        if (args[1] === 0) throw new Error("scheduler unavailable");
        return original(...args);
      });
    try {
      await expect(
        action.run(
          { id: "page", visitId: "visit", outcome: "remount", mode: "editing" },
          { caller: "frontend" },
        ),
      ).resolves.toEqual({ recorded: true });
      expect(countOutcome).not.toHaveBeenCalled();
    } finally {
      scheduler.mockRestore();
    }
  });
  it("counts bounded classes after acknowledgement without identity dimensions", async () => {
    vi.useFakeTimers();
    for (const outcome of [
      "initial",
      "navigation",
      "mode_switch",
      "remount",
    ] as const) {
      await action.run(
        {
          id: "page",
          visitId: "visit",
          outcome,
          mode: "editing",
        },
        { caller: "frontend" },
      );
    }
    expect(countOutcome).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(countOutcome).toHaveBeenCalledTimes(4);
    expect(countOutcome.mock.calls).toEqual(
      ["initial", "navigation", "mode_switch", "remount"].map((outcome) => [
        "content_editor_mount_counts",
        { outcome, mode: "editing" },
      ]),
    );
    expect(access).toHaveBeenCalledWith("page", "viewer", "id");
  });
  it("does not wait for slow telemetry and contains delivery failures", async () => {
    vi.useFakeTimers();
    countOutcome
      .mockReturnValueOnce(new Promise(() => {}))
      .mockImplementationOnce(() => {
        throw new Error("telemetry failed");
      });
    for (let i = 0; i < 2; i++) {
      await expect(
        action.run(
          {
            id: "page",
            visitId: "visit",
            outcome: "remount",
            mode: "suggesting",
          },
          { caller: "frontend" },
        ),
      ).resolves.toEqual({ recorded: true });
    }
    await vi.runAllTimersAsync();
    expect(countOutcome).toHaveBeenCalledTimes(2);
  });
});
