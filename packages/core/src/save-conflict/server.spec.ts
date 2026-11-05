import { describe, expect, it, vi } from "vitest";

import { isActionContractError } from "../action.js";
import { isSaveConflict, SAVE_CONFLICT_ERROR_CODE } from "./index.js";
import {
  changedRowCount,
  checkSaveRevision,
  saveConflict,
  saveIfCurrent,
} from "./server.js";

const countOutcome = vi.hoisted(() => vi.fn());
vi.mock("../tracking/failure-counters.js", () => ({ countOutcome }));

/** One stored row, written the way a compare-and-set statement writes it. */
function storedRow(initial: string) {
  const row = { value: initial, revision: `rev:${initial}` };
  const set = (value: string) => {
    row.value = value;
    row.revision = `rev:${value}`;
  };
  return {
    row,
    set,
    read: async () => ({ value: row.value, revision: row.revision }),
    writeIfStill: (next: string) => async (seen: { revision: string }) => {
      if (row.revision !== seen.revision) return 0;
      set(next);
      return 1;
    },
  };
}

describe("saveConflict", () => {
  it("carries what else the caller has to know, without losing the current value", () => {
    const error = saveConflict("draft", { a: 1 }, "r1", {
      leftover: "x",
      current: "ignored",
    });
    expect(error.details).toEqual({
      leftover: "x",
      current: { a: 1 },
      currentRevision: "r1",
    });
  });

  it("is a 409 contract error that carries the current value", () => {
    const error = saveConflict("form_fields", { a: 1 }, "r1");
    expect(isActionContractError(error)).toBe(true);
    expect(isSaveConflict(error)).toBe(true);
    expect(error.statusCode).toBe(409);
    expect(error.errorCode).toBe(SAVE_CONFLICT_ERROR_CODE);
    expect(error.details).toEqual({
      current: { a: 1 },
      currentRevision: "r1",
    });
    expect(error.message).toContain("form fields changed");
  });
});

describe("checkSaveRevision", () => {
  const current = { value: "now", revision: "r2" };
  const isSameSave = (value: string) => value === "same";

  it("applies a write with the current revision", () => {
    expect(
      checkSaveRevision({
        record: "x",
        expectedRevision: "r2",
        current,
        isSameSave,
      }),
    ).toBe("apply");
  });

  it("refuses a stale revision", () => {
    expect(() =>
      checkSaveRevision({
        record: "x",
        expectedRevision: "r1",
        current,
        isSameSave,
      }),
    ).toThrow(/changed after you read it/);
  });

  it("applies with no revision only when one isn't required", () => {
    expect(
      checkSaveRevision({
        record: "x",
        expectedRevision: undefined,
        current,
        isSameSave,
      }),
    ).toBe("apply");
    expect(() =>
      checkSaveRevision({
        record: "x",
        expectedRevision: undefined,
        requireRevision: true,
        current,
        isSameSave,
      }),
    ).toThrow(/changed after you read it/);
  });

  it("reads a stale write the value already holds as a repeat", () => {
    expect(
      checkSaveRevision({
        record: "x",
        expectedRevision: "r1",
        current: { value: "same", revision: "r2" },
        isSameSave,
      }),
    ).toBe("already_applied");
  });

  it("takes null to mean the writer read nothing there", () => {
    expect(
      checkSaveRevision({
        record: "x",
        expectedRevision: null,
        current: { value: null, revision: null },
        isSameSave: () => false,
      }),
    ).toBe("apply");
    expect(() =>
      checkSaveRevision({
        record: "x",
        expectedRevision: null,
        current,
        isSameSave,
      }),
    ).toThrow(/changed after you read it/);
  });
});

describe("changedRowCount", () => {
  it("reads every driver's result", () => {
    expect(changedRowCount(1)).toBe(1);
    expect(changedRowCount(true)).toBe(1);
    expect(changedRowCount(false)).toBe(0);
    expect(changedRowCount([{ id: "a" }])).toBe(1);
    expect(changedRowCount([])).toBe(0);
    expect(changedRowCount({ rowsAffected: 1 })).toBe(1);
    expect(changedRowCount({ affectedRows: 0 })).toBe(0);
    expect(changedRowCount({ rowCount: 1 })).toBe(1);
    expect(changedRowCount({ changes: 1 })).toBe(1);
  });

  it("prefers a driver's count over the rows on an array result", () => {
    expect(changedRowCount(Object.assign([], { count: 1 }))).toBe(1);
  });

  it("throws rather than guess", () => {
    expect(() => changedRowCount(undefined)).toThrow(/how many rows/);
    expect(() => changedRowCount({})).toThrow(/how many rows/);
  });
});

describe("saveIfCurrent", () => {
  it("writes when the revision is current", async () => {
    const stored = storedRow("old");
    await expect(
      saveIfCurrent({
        record: "x",
        expectedRevision: "rev:old",
        read: stored.read,
        write: stored.writeIfStill("new"),
        isSameSave: (value) => value === "new",
      }),
    ).resolves.toMatchObject({ outcome: "written" });
    expect(stored.row.value).toBe("new");
    expect(countOutcome).toHaveBeenLastCalledWith("save_outcome_counts", {
      record: "x",
      outcome: "written",
    });
  });

  it("refuses a stale write and leaves the row alone", async () => {
    const stored = storedRow("old");
    stored.set("theirs");
    const failure = await saveIfCurrent({
      record: "x",
      expectedRevision: "rev:old",
      read: stored.read,
      write: stored.writeIfStill("mine"),
      isSameSave: (value) => value === "mine",
    }).catch((error: unknown) => error);
    expect(isSaveConflict(failure)).toBe(true);
    expect((failure as { details: unknown }).details).toEqual({
      current: "theirs",
      currentRevision: "rev:theirs",
    });
    expect(stored.row.value).toBe("theirs");
  });

  it("applies a repeated save once", async () => {
    const stored = storedRow("old");
    const save = () => {
      const write = vi.fn(stored.writeIfStill("new"));
      return {
        write,
        result: saveIfCurrent({
          record: "x",
          expectedRevision: "rev:old",
          read: stored.read,
          write,
          isSameSave: (value) => value === "new",
        }),
      };
    };
    await expect(save().result).resolves.toMatchObject({ outcome: "written" });
    const repeat = save();
    await expect(repeat.result).resolves.toMatchObject({
      outcome: "already_applied",
    });
    expect(repeat.write).not.toHaveBeenCalled();
    expect(stored.row.value).toBe("new");
  });

  it("checks again against whatever won a race", async () => {
    const stored = storedRow("old");
    const failure = await saveIfCurrent({
      record: "x",
      expectedRevision: "rev:old",
      read: stored.read,
      write: async (seen) => {
        stored.set("theirs");
        return stored.writeIfStill("mine")(seen);
      },
      isSameSave: (value) => value === "mine",
    }).catch((error: unknown) => error);
    expect(isSaveConflict(failure)).toBe(true);
    expect(stored.row.value).toBe("theirs");
  });

  it("retries a race on the same value and then gives up with a conflict", async () => {
    const stored = storedRow("old");
    const write = vi.fn(async () => 0);
    const failure = await saveIfCurrent({
      record: "x",
      expectedRevision: "rev:old",
      read: stored.read,
      write,
      isSameSave: () => false,
    }).catch((error: unknown) => error);
    expect(write).toHaveBeenCalledTimes(3);
    expect(isSaveConflict(failure)).toBe(true);
  });

  it("throws when a write changes more than one row", async () => {
    const stored = storedRow("old");
    await expect(
      saveIfCurrent({
        record: "x",
        expectedRevision: "rev:old",
        read: stored.read,
        write: async () => 2,
        isSameSave: () => false,
      }),
    ).rejects.toThrow(/changed 2 rows/);
  });

  it("lets the read decide whether a revision is required", async () => {
    const stored = storedRow("old");
    const failure = await saveIfCurrent({
      record: "x",
      expectedRevision: undefined,
      requireRevision: (current) => current.value === "old",
      read: stored.read,
      write: stored.writeIfStill("new"),
      isSameSave: () => false,
    }).catch((error: unknown) => error);
    expect(isSaveConflict(failure)).toBe(true);
    expect(stored.row.value).toBe("old");
  });
});
