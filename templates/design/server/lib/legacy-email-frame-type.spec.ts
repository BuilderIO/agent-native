import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./screen-frame-type-store.js", () => ({
  persistScreenFrameType: vi.fn().mockResolvedValue(undefined),
}));

import {
  LegacyEmailFrameTypeNotStoredError,
  writeWithLegacyEmailFrameTypes,
} from "./legacy-email-frame-type.js";
import { persistScreenFrameType } from "./screen-frame-type-store.js";

const backfill = (fileId: string) => ({
  designId: "design-1",
  fileId,
  frameType: "hubspot-email",
  onlyIfAbsent: true,
});

describe("writeWithLegacyEmailFrameTypes", () => {
  beforeEach(() => {
    vi.mocked(persistScreenFrameType).mockReset();
    vi.mocked(persistScreenFrameType).mockResolvedValue(undefined);
  });

  it("stores marked screens' types before the write", async () => {
    const order: string[] = [];
    vi.mocked(persistScreenFrameType).mockImplementation(async () => {
      order.push("store");
    });
    const result = await writeWithLegacyEmailFrameTypes({
      designId: "design-1",
      markedFileIds: ["a"],
      write: async (stored) => {
        order.push(`write:${[...stored].join(",")}`);
        return "done";
      },
    });

    expect(result).toBe("done");
    expect(order).toEqual(["store", "write:a"]);
    expect(persistScreenFrameType).toHaveBeenCalledWith(backfill("a"));
  });

  it("stores a type the write found only in live content, then writes again", async () => {
    const write = vi
      .fn<(stored: ReadonlySet<string>) => Promise<string>>()
      .mockImplementation(async (stored) => {
        if (!stored.has("b")) throw new LegacyEmailFrameTypeNotStoredError("b");
        return "done";
      });

    await expect(
      writeWithLegacyEmailFrameTypes({
        designId: "design-1",
        markedFileIds: [],
        write,
      }),
    ).resolves.toBe("done");
    expect(write).toHaveBeenCalledTimes(2);
    expect(persistScreenFrameType).toHaveBeenCalledTimes(1);
    expect(persistScreenFrameType).toHaveBeenCalledWith(backfill("b"));
  });

  it("rethrows when a write still reports a stored screen", async () => {
    const error = new LegacyEmailFrameTypeNotStoredError("a");
    await expect(
      writeWithLegacyEmailFrameTypes({
        designId: "design-1",
        markedFileIds: ["a"],
        write: () => Promise.reject(error),
      }),
    ).rejects.toBe(error);
  });

  it("never writes when storing the type fails", async () => {
    const failure = new Error("metadata write failed");
    vi.mocked(persistScreenFrameType).mockRejectedValueOnce(failure);
    const write = vi.fn();

    await expect(
      writeWithLegacyEmailFrameTypes({
        designId: "design-1",
        markedFileIds: ["a"],
        write,
      }),
    ).rejects.toBe(failure);
    expect(write).not.toHaveBeenCalled();
  });
});
