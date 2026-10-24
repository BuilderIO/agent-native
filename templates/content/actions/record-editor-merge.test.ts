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
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });
  it("counts each outcome within the request, without the page's identity", async () => {
    for (const outcome of ["kept_all", "set_aside"] as const) {
      await expect(
        action.run({ id: "page", outcome }, { caller: "frontend" }),
      ).resolves.toEqual({ recorded: true });
    }
    expect(countOutcome.mock.calls).toEqual(
      ["kept_all", "set_aside"].map((outcome) => [
        "content_editor_merge_counts",
        { outcome },
      ]),
    );
    expect(access).toHaveBeenCalledWith("page", "viewer", "id");
  });
  it("acknowledges the merge when counting is slow or fails", async () => {
    countOutcome
      .mockReturnValueOnce(new Promise(() => {}))
      .mockReturnValueOnce(Promise.reject(new Error("telemetry failed")))
      .mockImplementationOnce(() => {
        throw new Error("telemetry failed");
      });
    for (let i = 0; i < 3; i++) {
      await expect(
        action.run(
          { id: "page", outcome: "set_aside" },
          { caller: "frontend" },
        ),
      ).resolves.toEqual({ recorded: true });
    }
    expect(countOutcome).toHaveBeenCalledTimes(3);
  });
  it("rejects outcomes outside the bounded set", () => {
    expect(
      action.schema.safeParse({ id: "page", outcome: "dropped" }).success,
    ).toBe(false);
  });
});
