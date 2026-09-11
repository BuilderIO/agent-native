import { describe, expect, it, vi } from "vitest";

const { write } = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("@agent-native/core/client/hooks", () => ({
  setClientAppState: write,
}));
import { setHistoryApplicationState } from "./history-application-state";

describe("history application state ordering", () => {
  it("finishes old cleanup before publishing a remounted panel", async () => {
    let finishDelete!: () => void;
    const deleted = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    write
      .mockReset()
      .mockReturnValueOnce(deleted)
      .mockResolvedValueOnce({ open: true });
    const cleanup = setHistoryApplicationState(
      "content-history:one",
      null,
      true,
    );
    const reopened = setHistoryApplicationState("content-history:one", {
      open: true,
      selectedCheckpointId: "new",
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith(
      "content-history:one",
      null,
      expect.objectContaining({ keepalive: true }),
    );
    finishDelete();
    await Promise.all([cleanup, reopened]);
    expect(write).toHaveBeenLastCalledWith(
      "content-history:one",
      { open: true, selectedCheckpointId: "new" },
      expect.anything(),
    );
  });

  it("exposes a failed cleanup while allowing the next panel write", async () => {
    write
      .mockReset()
      .mockRejectedValueOnce(new Error("cleanup failed"))
      .mockResolvedValueOnce({ open: true });
    const cleanup = setHistoryApplicationState(
      "content-history:two",
      null,
      true,
    );
    const reopened = setHistoryApplicationState("content-history:two", {
      open: true,
    });
    await expect(cleanup).rejects.toThrow("cleanup failed");
    await expect(reopened).resolves.toEqual({ open: true });
  });
});
