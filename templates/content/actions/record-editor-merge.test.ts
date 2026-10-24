import { afterEach, describe, expect, it, vi } from "vitest";
const countOutcome = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/tracking", () => ({ countOutcome }));
vi.mock("./_document-mutation-access.js", () => ({
  assertDocumentMutationAccess: access,
}));
import action from "./record-editor-merge";

describe("editor merge counts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });
  it("acknowledges the merge when telemetry cannot even be scheduled", async () => {
    const original = globalThis.setTimeout;
    const scheduler = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((...args) => {
        if (args[1] === 0) throw new Error("scheduler unavailable");
        return original(...args);
      });
    try {
      await expect(
        action.run({ id: "page", outcome: "kept_all" }, { caller: "frontend" }),
      ).resolves.toEqual({ recorded: true });
      expect(countOutcome).not.toHaveBeenCalled();
    } finally {
      scheduler.mockRestore();
    }
  });
  it("counts each outcome after acknowledgement without the page's identity", async () => {
    vi.useFakeTimers();
    for (const outcome of ["kept_all", "set_aside"] as const) {
      await action.run({ id: "page", outcome }, { caller: "frontend" });
    }
    expect(countOutcome).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(countOutcome.mock.calls).toEqual(
      ["kept_all", "set_aside"].map((outcome) => [
        "content_editor_merge_counts",
        { outcome },
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
          { id: "page", outcome: "set_aside" },
          { caller: "frontend" },
        ),
      ).resolves.toEqual({ recorded: true });
    }
    await vi.runAllTimersAsync();
    expect(countOutcome).toHaveBeenCalledTimes(2);
  });
  it("rejects outcomes outside the bounded set", () => {
    expect(
      action.schema.safeParse({ id: "page", outcome: "dropped" }).success,
    ).toBe(false);
  });
});
