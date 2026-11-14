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
  it("counts each outcome and path within the request, without the page's identity", async () => {
    const counted = [
      { outcome: "kept_all", path: "open_editor" },
      { outcome: "set_aside", path: "save_rebase" },
    ] as const;
    for (const dimensions of counted) {
      await expect(
        action.run({ id: "page", ...dimensions }, { caller: "frontend" }),
      ).resolves.toEqual({ recorded: true });
    }
    expect(countOutcome.mock.calls).toEqual(
      counted.map((dimensions) => ["content_editor_merge_counts", dimensions]),
    );
    expect(access).toHaveBeenCalledWith("page", "viewer", "id");
  });
  it("acknowledges the merge when counting throws", async () => {
    countOutcome.mockImplementationOnce(() => {
      throw new Error("telemetry failed");
    });
    await expect(
      action.run(
        { id: "page", outcome: "set_aside", path: "open_editor" },
        { caller: "frontend" },
      ),
    ).resolves.toEqual({ recorded: true });
    expect(countOutcome).toHaveBeenCalledOnce();
  });
  it("rejects outcomes and paths outside the bounded sets", () => {
    for (const args of [
      { id: "page", outcome: "dropped", path: "open_editor" },
      { id: "page", outcome: "kept_all", path: "server" },
      { id: "page", outcome: "kept_all" },
    ]) {
      expect(action.schema.safeParse(args).success).toBe(false);
    }
  });
});
