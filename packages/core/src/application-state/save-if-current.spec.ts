import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAppStateGet = vi.fn();
const mockAppStateCompareAndSet = vi.fn();

vi.mock("./store.js", () => ({
  appStateGet: (...args: unknown[]) => mockAppStateGet(...args),
  appStateCompareAndSet: (...args: unknown[]) =>
    mockAppStateCompareAndSet(...args),
}));

import { saveRevisionOf } from "../save-conflict/index.js";
import { appStateSaveIfCurrent } from "./save-if-current.js";

const stored = { subject: "stored" };
const next = { subject: "next" };

describe("appStateSaveIfCurrent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppStateCompareAndSet.mockResolvedValue(true);
  });

  it("writes over the value the writer read", async () => {
    mockAppStateGet.mockResolvedValue(stored);
    const options = { requestSource: "tab" };

    const result = await appStateSaveIfCurrent(
      "session",
      "compose-1",
      saveRevisionOf(stored),
      next,
      options,
    );

    expect(result.outcome).toBe("written");
    expect(mockAppStateGet).toHaveBeenCalledWith("session", "compose-1");
    expect(mockAppStateCompareAndSet).toHaveBeenCalledWith(
      "session",
      "compose-1",
      stored,
      next,
      options,
    );
  });

  it("creates the value when the writer read nothing and nothing is there", async () => {
    mockAppStateGet.mockResolvedValue(null);

    const result = await appStateSaveIfCurrent(
      "session",
      "compose-1",
      null,
      next,
    );

    expect(result.outcome).toBe("written");
    expect(result.current).toEqual({ value: null, revision: null });
    expect(mockAppStateCompareAndSet).toHaveBeenCalledWith(
      "session",
      "compose-1",
      null,
      next,
      undefined,
    );
  });

  it("refuses a stale write with the current value and its revision", async () => {
    mockAppStateGet.mockResolvedValue(stored);

    await expect(
      appStateSaveIfCurrent("session", "compose-1", "rev_stale", next),
    ).rejects.toMatchObject({
      errorCode: "save_conflict",
      details: { current: stored, currentRevision: saveRevisionOf(stored) },
    });
    expect(mockAppStateCompareAndSet).not.toHaveBeenCalled();
  });

  it("refuses a first write when someone else already stored one", async () => {
    mockAppStateGet.mockResolvedValue(stored);

    await expect(
      appStateSaveIfCurrent("session", "compose-1", null, next),
    ).rejects.toMatchObject({ errorCode: "save_conflict" });
    expect(mockAppStateCompareAndSet).not.toHaveBeenCalled();
  });

  it("applies a repeat of a save once", async () => {
    mockAppStateGet.mockResolvedValue(next);

    const result = await appStateSaveIfCurrent(
      "session",
      "compose-1",
      saveRevisionOf(stored),
      next,
    );

    expect(result.outcome).toBe("already_applied");
    expect(mockAppStateCompareAndSet).not.toHaveBeenCalled();
  });

  it("doesn't take a deleted value for a repeat", async () => {
    mockAppStateGet.mockResolvedValue(null);

    await expect(
      appStateSaveIfCurrent(
        "session",
        "compose-1",
        saveRevisionOf(stored),
        next,
      ),
    ).rejects.toMatchObject({
      errorCode: "save_conflict",
      details: { current: null, currentRevision: null },
    });
  });

  it("checks again against whatever won a lost race", async () => {
    const winner = { subject: "winner" };
    mockAppStateGet.mockResolvedValueOnce(stored).mockResolvedValue(winner);
    mockAppStateCompareAndSet.mockResolvedValueOnce(false);

    await expect(
      appStateSaveIfCurrent(
        "session",
        "compose-1",
        saveRevisionOf(stored),
        next,
      ),
    ).rejects.toMatchObject({
      errorCode: "save_conflict",
      details: { current: winner, currentRevision: saveRevisionOf(winner) },
    });
    expect(mockAppStateCompareAndSet).toHaveBeenCalledTimes(1);
  });
});
