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
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });
  // oracle-change: the count now runs before the action returns.
  it("counts bounded classes within the request, without identity dimensions", async () => {
    for (const outcome of [
      "initial",
      "navigation",
      "mode_switch",
      "remount",
    ] as const) {
      await expect(
        action.run(
          {
            id: "page",
            visitId: "visit",
            outcome,
            mode: "editing",
          },
          { caller: "frontend" },
        ),
      ).resolves.toEqual({ recorded: true });
    }
    expect(countOutcome.mock.calls).toEqual(
      ["initial", "navigation", "mode_switch", "remount"].map((outcome) => [
        "content_editor_mount_counts",
        { outcome, mode: "editing" },
      ]),
    );
    expect(access).toHaveBeenCalledWith("page", "viewer", "id");
  });
  it("acknowledges the mount when counting is slow or fails", async () => {
    countOutcome
      .mockReturnValueOnce(new Promise(() => {}))
      .mockReturnValueOnce(Promise.reject(new Error("telemetry failed")))
      .mockImplementationOnce(() => {
        throw new Error("telemetry failed");
      });
    for (let i = 0; i < 3; i++) {
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
    expect(countOutcome).toHaveBeenCalledTimes(3);
  });
});
