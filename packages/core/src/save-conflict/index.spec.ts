import { describe, expect, it, vi } from "vitest";

import {
  SAVE_CONFLICT_ERROR_CODE,
  SaveOverlapError,
  isSaveConflict,
  mergeRecords,
  rebaseOntoSaved,
  saveRevisionOf,
  saveWithMerge,
} from "./index.js";

function conflict(current: unknown, currentRevision: string | null) {
  return Object.assign(new Error("Action failed"), {
    errorCode: SAVE_CONFLICT_ERROR_CODE,
    details: { current, currentRevision },
  });
}

describe("saveRevisionOf", () => {
  it("ignores key order and changes with the value", () => {
    expect(saveRevisionOf({ a: 1, b: { c: 2, d: 3 } })).toBe(
      saveRevisionOf({ b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(saveRevisionOf({ a: 1 })).not.toBe(saveRevisionOf({ a: 2 }));
    expect(saveRevisionOf(null)).not.toBe(saveRevisionOf({}));
  });

  it("treats a missing key and an undefined one alike", () => {
    expect(saveRevisionOf({ a: 1, b: undefined })).toBe(
      saveRevisionOf({ a: 1 }),
    );
  });
});

describe("isSaveConflict", () => {
  it("recognizes the typed error however it arrived", () => {
    expect(isSaveConflict(conflict({}, "r1"))).toBe(true);
    expect(isSaveConflict(conflict(null, null))).toBe(true);
  });

  it("rejects other errors, and conflicts without the current value", () => {
    expect(isSaveConflict(new Error("nope"))).toBe(false);
    expect(isSaveConflict(null)).toBe(false);
    expect(isSaveConflict({ errorCode: "form_changed", details: {} })).toBe(
      false,
    );
    expect(
      isSaveConflict({ errorCode: SAVE_CONFLICT_ERROR_CODE, details: {} }),
    ).toBe(false);
  });
});

describe("mergeRecords", () => {
  it("keeps both writers' changes to different fields", () => {
    expect(
      mergeRecords(
        { subject: "a", body: "b", to: "c" },
        { subject: "mine", body: "b", to: "c" },
        { subject: "a", body: "theirs", to: "c" },
      ),
    ).toEqual({
      ok: true,
      merged: { subject: "mine", body: "theirs", to: "c" },
    });
  });

  it("treats the same change from both writers as no overlap", () => {
    expect(mergeRecords({ a: 1 }, { a: 2 }, { a: 2 })).toEqual({
      ok: true,
      merged: { a: 2 },
    });
  });

  it("reports an overlap with both ways of settling it", () => {
    expect(
      mergeRecords(
        { subject: "a", body: "b" },
        { subject: "mine", body: "b" },
        { subject: "theirs", body: "new" },
      ),
    ).toEqual({
      ok: false,
      fields: ["subject"],
      keepMine: { subject: "mine", body: "new" },
      useTheirs: { subject: "theirs", body: "new" },
    });
  });

  it("merges lists of objects by id", () => {
    const base = [
      { id: "a", label: "A", required: false },
      { id: "b", label: "B", required: false },
    ];
    expect(
      mergeRecords(
        base,
        [
          { id: "a", label: "A2", required: false },
          { id: "b", label: "B", required: false },
          { id: "mine", label: "M", required: false },
        ],
        [
          { id: "a", label: "A", required: true },
          { id: "b", label: "B", required: false },
          { id: "theirs", label: "T", required: false },
        ],
      ),
    ).toEqual({
      ok: true,
      merged: [
        { id: "a", label: "A2", required: true },
        { id: "b", label: "B", required: false },
        { id: "mine", label: "M", required: false },
        { id: "theirs", label: "T", required: false },
      ],
    });
  });

  it("names the field when both writers change it inside a list", () => {
    const merge = mergeRecords(
      [{ id: "a", label: "A" }],
      [{ id: "a", label: "mine" }],
      [{ id: "a", label: "theirs" }],
    );
    expect(merge).toMatchObject({ ok: false, fields: ["a.label"] });
  });

  it("treats a delete against an edit as an overlap, settled either way", () => {
    const merge = mergeRecords(
      [{ id: "a", label: "A" }],
      [],
      [{ id: "a", label: "edited" }],
    );
    expect(merge).toEqual({
      ok: false,
      fields: ["a"],
      keepMine: [],
      useTheirs: [{ id: "a", label: "edited" }],
    });
  });

  it("drops a delete cleanly when the other side left the item alone", () => {
    expect(
      mergeRecords(
        [
          { id: "a", n: 1 },
          { id: "b", n: 2 },
        ],
        [{ id: "b", n: 2 }],
        [
          { id: "a", n: 1 },
          { id: "b", n: 3 },
        ],
      ),
    ).toEqual({ ok: true, merged: [{ id: "b", n: 3 }] });
  });

  it("lets the side that reordered set the order, and flags both reordering", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const c = { id: "c" };
    expect(mergeRecords([a, b, c], [c, a, b], [a, b, c, { id: "d" }])).toEqual({
      ok: true,
      merged: [c, { id: "d" }, a, b],
    });
    expect(mergeRecords([a, b, c], [c, a, b], [b, a, c])).toEqual({
      ok: false,
      fields: ["order"],
      keepMine: [c, a, b],
      useTheirs: [b, a, c],
    });
  });

  it("treats a changed list without ids as one value", () => {
    expect(
      mergeRecords(
        { options: ["a"] },
        { options: ["a", "b"] },
        {
          options: ["a", "c"],
        },
      ),
    ).toMatchObject({ ok: false, fields: ["options"] });
  });
});

describe("rebaseOntoSaved", () => {
  it("brings in what others changed and keeps edits made during the save", () => {
    expect(
      rebaseOntoSaved(
        { subject: "sent", body: "b" },
        { subject: "typed more", body: "b" },
        { subject: "sent", body: "agent" },
      ),
    ).toEqual({ subject: "typed more", body: "agent" });
  });

  it("keeps the local value where both changed the same field", () => {
    expect(rebaseOntoSaved({ a: 1 }, { a: 2 }, { a: 3 })).toEqual({ a: 2 });
  });
});

describe("saveWithMerge", () => {
  const base = { value: { a: 1, b: 1 }, revision: "r0" };

  it("returns the first save when nothing conflicts", async () => {
    const save = vi.fn(async () => ({ value: { a: 2, b: 1 }, revision: "r1" }));
    await expect(
      saveWithMerge({ base, mine: { a: 2, b: 1 }, save }),
    ).resolves.toEqual({ value: { a: 2, b: 1 }, revision: "r1" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      value: { a: 2, b: 1 },
      revision: "r0",
      base: base.value,
    });
  });

  it("merges onto the conflict's current value and saves again", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(conflict({ a: 1, b: 9 }, "r1"))
      .mockImplementationOnce(async ({ value }) => ({
        value,
        revision: "r2",
      }));
    await expect(
      saveWithMerge({ base, mine: { a: 2, b: 1 }, save }),
    ).resolves.toEqual({ value: { a: 2, b: 9 }, revision: "r2" });
    expect(save).toHaveBeenLastCalledWith({
      value: { a: 2, b: 9 },
      revision: "r1",
      base: { a: 1, b: 9 },
    });
  });

  it("doesn't save again when their copy already holds my change", async () => {
    const save = vi.fn().mockRejectedValueOnce(conflict({ a: 2, b: 1 }, "r1"));
    await expect(
      saveWithMerge({ base, mine: { a: 2, b: 1 }, save }),
    ).resolves.toEqual({ value: { a: 2, b: 1 }, revision: "r1" });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("throws the overlap when nobody can be asked", async () => {
    const save = vi.fn().mockRejectedValueOnce(conflict({ a: 9, b: 1 }, "r1"));
    const failure = await saveWithMerge({
      base,
      mine: { a: 2, b: 1 },
      save,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SaveOverlapError);
    expect((failure as SaveOverlapError).overlap).toMatchObject({
      fields: ["a"],
      mine: { a: 2, b: 1 },
      theirs: { a: 9, b: 1 },
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves what the person chose, against their revision", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(conflict({ a: 9, b: 1 }, "r1"))
      .mockImplementationOnce(async ({ value }) => ({
        value,
        revision: "r2",
      }));
    const resolveOverlap = vi.fn(async (overlap) => overlap.keepMine);
    await expect(
      saveWithMerge({ base, mine: { a: 2, b: 1 }, save, resolveOverlap }),
    ).resolves.toEqual({ value: { a: 2, b: 1 }, revision: "r2" });
    expect(resolveOverlap).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: "r1" }),
    );
  });

  it("doesn't save again when the person takes their version", async () => {
    const save = vi.fn().mockRejectedValueOnce(conflict({ a: 9, b: 1 }, "r1"));
    await expect(
      saveWithMerge({
        base,
        mine: { a: 2, b: 1 },
        save,
        resolveOverlap: async (overlap) => overlap.useTheirs,
      }),
    ).resolves.toEqual({ value: { a: 9, b: 1 }, revision: "r1" });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("gives up after a few merges, throwing the last conflict", async () => {
    let round = 0;
    const save = vi.fn(async () => {
      round += 1;
      throw conflict({ a: 1, b: 100 + round }, `r${round}`);
    });
    await expect(
      saveWithMerge({ base, mine: { a: 2, b: 1 }, save }),
    ).rejects.toSatisfy(isSaveConflict);
    expect(save).toHaveBeenCalledTimes(4);
  });

  it("passes other errors through untouched", async () => {
    const failure = new Error("offline");
    await expect(
      saveWithMerge({
        base,
        mine: { a: 2, b: 1 },
        save: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });

  it("parses the current value into the caller's form before merging", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(conflict('{"a":1,"b":9}', "r1"))
      .mockImplementationOnce(async ({ value }) => ({
        value,
        revision: "r2",
      }));
    await expect(
      saveWithMerge({
        base,
        mine: { a: 2, b: 1 },
        save,
        parseCurrent: (current) => JSON.parse(current as string),
      }),
    ).resolves.toEqual({ value: { a: 2, b: 9 }, revision: "r2" });
  });
});
