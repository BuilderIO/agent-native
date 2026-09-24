import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The action itself, with storage and the database stubbed: what it refuses,
 * and when a file it could not delete is worth failing the save over.
 */

const mocks = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  /** How many row updates find the row unchanged; the rest match nothing. */
  matching: Infinity,
  deleteStoredMediaUrl: vi.fn(async (_url: string) => true),
  uploadFile: vi.fn(async () => ({ url: "" })),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(async () => undefined),
}));
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...(args as [])),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
}));
vi.mock("../server/lib/recording-media-cleanup.js", () => ({
  deleteStoredMediaUrl: (url: string) => mocks.deleteStoredMediaUrl(url),
}));
vi.mock("../server/db/index.js", () => ({
  schema: { recordings: { id: "recordings.id" } },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => (mocks.existing ? [mocks.existing] : []),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (mocks.matching <= 0) return [];
            mocks.matching -= 1;
            mocks.updates.push(values);
            return [{ id: "shot-1" }];
          },
        }),
      }),
    }),
  }),
}));

import action from "./save-screenshot-edits";

// The smallest bytes that pass the PNG signature check.
const PNG = `data:image/png;base64,${Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]).toString("base64")}`;

let uploads = 0;

function run(args: Record<string, unknown>) {
  const parsed = (action as any).schema.parse({
    recordingId: "shot-1",
    dataUrl: PNG,
    width: 1000,
    height: 800,
    ...args,
  });
  return (action as any).run(parsed);
}

function pending(w: number, h: number) {
  return {
    id: "r1",
    kind: "redact",
    style: "mosaic",
    startMs: 0,
    endMs: 1,
    keys: [{ atMs: 0, x: 0.1, y: 0.1, w, h }],
  };
}

beforeEach(() => {
  uploads = 0;
  mocks.updates = [];
  mocks.matching = Infinity;
  mocks.deleteStoredMediaUrl.mockReset();
  mocks.deleteStoredMediaUrl.mockResolvedValue(true);
  mocks.uploadFile.mockReset();
  mocks.uploadFile.mockImplementation(async () => ({
    url: `https://store.example/new-${++uploads}.png`,
  }));
  mocks.existing = {
    id: "shot-1",
    kind: "image",
    title: "Checkout",
    imageUrl: "https://store.example/flattened.png",
    thumbnailUrl: "https://store.example/flattened.png",
    baseImageUrl: "https://store.example/original.png",
    editsJson: null,
  };
});

describe("save-screenshot-edits", () => {
  it("does not fail an ordinary save over an old copy it could not delete", async () => {
    // The row has already moved on to the new picture by then, and the old
    // flattened copy had nothing unredacted in it. Failing here left the
    // editor open over a saved edit, telling the owner to delete it.
    mocks.deleteStoredMediaUrl.mockResolvedValue(false);
    const result = await run({ annotations: [] });
    expect(result.staleFileLeft).toBe(true);
    expect(mocks.updates).toHaveLength(1);
  });

  it("keeps the screenshot held when a burn could not delete the original", async () => {
    // The pending list is what holds it back from viewers. Clearing it before
    // the original is gone would publish a screenshot whose unredacted file
    // is still in storage.
    mocks.existing!.editsJson = JSON.stringify({
      overlays: [pending(0.05, 0.05)],
    });
    mocks.deleteStoredMediaUrl.mockImplementation(
      async (url: string) => !url.endsWith("original.png"),
    );
    await expect(
      run({
        baseDataUrl: PNG,
        redactions: [{ x: 1, y: 1, width: 50, height: 50 }],
      }),
    ).rejects.toThrow(/unredacted original could not be deleted/);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).not.toHaveProperty("editsJson");
    expect(mocks.updates[0]).not.toHaveProperty("title");
  });

  it("lifts the hold on a burn only after the original is deleted", async () => {
    mocks.existing!.editsJson = JSON.stringify({
      overlays: [pending(0.05, 0.05)],
    });
    const order: string[] = [];
    mocks.deleteStoredMediaUrl.mockImplementation(async (url: string) => {
      order.push(`delete ${url.split("/").pop()}`);
      return true;
    });
    await run({
      baseDataUrl: PNG,
      redactions: [{ x: 1, y: 1, width: 50, height: 50 }],
    });
    expect(mocks.updates).toHaveLength(2);
    expect(mocks.updates[0]).not.toHaveProperty("editsJson");
    expect(JSON.parse(String(mocks.updates[1].editsJson)).overlays).toEqual([]);
    expect(mocks.updates[1].title).toBe("(Redacted) Checkout");
    expect(order).toContain("delete original.png");
  });

  it("refuses a save that lost a race, and removes what it uploaded", async () => {
    // Another tab saved first, e.g. a burn. Landing on top of it could put
    // the unredacted picture back.
    mocks.matching = 0;
    await expect(run({ annotations: [] })).rejects.toThrow(
      /changed somewhere else/,
    );
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.deleteStoredMediaUrl).toHaveBeenCalledWith(
      "https://store.example/new-1.png",
    );
    expect(mocks.deleteStoredMediaUrl).not.toHaveBeenCalledWith(
      "https://store.example/original.png",
    );
  });

  it("refuses a pending redaction the stored form would drop", async () => {
    // Under the minimum size: storing it would lift the hold while the
    // served copy still shows it drawn in.
    await expect(
      run({ pendingRedactions: [pending(0.001, 0.001)] }),
    ).rejects.toThrow(/redaction box could not be saved/);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });

  it("keeps a pending redaction of a usable size", async () => {
    await run({ pendingRedactions: [pending(0.05, 0.05)] });
    const stored = JSON.parse(String(mocks.updates[0].editsJson));
    expect(stored.overlays).toHaveLength(1);
  });

  it("refuses an oversized image before decoding it", async () => {
    const huge = `data:image/png;base64,${"A".repeat(21 * 1024 * 1024)}`;
    await expect(run({ dataUrl: huge })).rejects.toThrow(/too large/);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });
});
