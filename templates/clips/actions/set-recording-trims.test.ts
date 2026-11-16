import { beforeEach, describe, expect, it, vi } from "vitest";

import { trimsRevisionOf } from "../app/lib/timestamp-mapping.js";

const store = vi.hoisted(() => ({
  editsJson: "{}",
  writes: 0,
  beforeWrite: null as null | (() => void),
}));
const writeAppState = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", async (original) => ({
  ...(await original<typeof import("@agent-native/core/action")>()),
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({ writeAppState }));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({ role: "editor", resource: {} })),
}));
vi.mock("../server/lib/recording-read-access.js", () => ({
  assertRecordingNotExpired: () => undefined,
}));
vi.mock("./lib/native-media.js", () => ({
  assertNativeRecordingMedia: () => undefined,
}));
vi.mock("drizzle-orm", async (original) => ({
  ...(await original<typeof import("drizzle-orm")>()),
  and: (...conditions: unknown[]) => conditions,
  eq: (_column: unknown, value: unknown) => ({ value }),
}));
vi.mock("../server/db/index.js", () => ({
  schema: { recordings: {} },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => [{ id: "rec-1", editsJson: store.editsJson }],
      }),
    }),
    update: () => ({
      set: (values: { editsJson: string }) => ({
        where: (conditions: Array<{ value: string }>) => ({
          returning: async () => {
            store.beforeWrite?.();
            if (conditions[1].value !== store.editsJson) return [];
            store.editsJson = values.editsJson;
            store.writes += 1;
            return [{ id: "rec-1" }];
          },
        }),
      }),
    }),
  }),
}));

import setRecordingTrims from "./set-recording-trims.js";

const cut = (id: string, startMs: number, endMs: number) => ({
  id,
  startMs,
  endMs,
  excluded: true,
});
const editsWith = (trims: unknown[], overlays: unknown[] = []) =>
  JSON.stringify({ trims, overlays });
const run = (args: { expectedRevision?: string; trims: unknown[] }) =>
  setRecordingTrims.run({ recordingId: "rec-1", ...args } as never);

describe("set-recording-trims", () => {
  beforeEach(() => {
    writeAppState.mockClear();
    store.editsJson = editsWith([cut("a", 0, 100)]);
    store.writes = 0;
    store.beforeWrite = null;
  });

  it("replaces the trims when they're still the ones it read", async () => {
    const trims = [cut("a", 0, 100), cut("b", 200, 300)];

    const result = await run({
      expectedRevision: trimsRevisionOf(store.editsJson),
      trims,
    });

    expect(result.editsJson.trims).toEqual(trims);
    expect(result.revision).toBe(trimsRevisionOf(store.editsJson));
    expect(store.writes).toBe(1);
    expect(writeAppState).toHaveBeenCalledTimes(1);
  });

  it("refuses to replace the trims without the revision it read", async () => {
    const before = store.editsJson;

    await expect(run({ trims: [] })).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "save_conflict",
      details: {
        current: [cut("a", 0, 100)],
        currentRevision: trimsRevisionOf(before),
      },
    });
    expect(store.editsJson).toBe(before);
  });

  it("refuses trims that changed after the read", async () => {
    const readRevision = trimsRevisionOf(store.editsJson);
    const changed = editsWith([cut("a", 0, 100), cut("other", 500, 600)]);
    store.editsJson = changed;

    await expect(
      run({ expectedRevision: readRevision, trims: [] }),
    ).rejects.toMatchObject({
      errorCode: "save_conflict",
      details: { currentRevision: trimsRevisionOf(changed) },
    });
    expect(store.editsJson).toBe(changed);
  });

  it("isn't staled by a save that left the trims alone, and keeps that save", async () => {
    const readRevision = trimsRevisionOf(store.editsJson);
    const overlay = { id: "overlay-1", kind: "text" };
    store.editsJson = editsWith([cut("a", 0, 100)], [overlay]);

    const result = await run({ expectedRevision: readRevision, trims: [] });

    expect(result.editsJson.trims).toEqual([]);
    expect(JSON.parse(store.editsJson).overlays).toEqual([overlay]);
  });

  it("applies a repeated save once", async () => {
    const readRevision = trimsRevisionOf(store.editsJson);
    const trims = [cut("b", 200, 300)];
    const first = await run({ expectedRevision: readRevision, trims });

    const repeat = await run({ expectedRevision: readRevision, trims });

    expect(repeat.revision).toBe(first.revision);
    expect(repeat.editsJson.trims).toEqual(trims);
    expect(store.writes).toBe(1);
    expect(writeAppState).toHaveBeenCalledTimes(1);
  });

  it("refuses when another writer lands the trims between read and write", async () => {
    const changed = editsWith([cut("other", 500, 600)]);
    store.beforeWrite = () => {
      store.editsJson = changed;
      store.beforeWrite = null;
    };

    await expect(
      run({ expectedRevision: trimsRevisionOf(store.editsJson), trims: [] }),
    ).rejects.toMatchObject({
      errorCode: "save_conflict",
      details: { current: [cut("other", 500, 600)] },
    });
    expect(store.editsJson).toBe(changed);
  });

  it("keeps a concurrent overlay save when only the overlays moved", async () => {
    const overlay = { id: "overlay-1", kind: "text" };
    const trims = [cut("b", 200, 300)];
    store.beforeWrite = () => {
      store.editsJson = editsWith([cut("a", 0, 100)], [overlay]);
      store.beforeWrite = null;
    };

    const result = await run({
      expectedRevision: trimsRevisionOf(store.editsJson),
      trims,
    });

    expect(result.editsJson.trims).toEqual(trims);
    expect(JSON.parse(store.editsJson).overlays).toEqual([overlay]);
  });
});
