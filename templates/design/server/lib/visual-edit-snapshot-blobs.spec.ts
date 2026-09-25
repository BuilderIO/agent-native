import { beforeEach, describe, expect, it, vi } from "vitest";

const deletePrivateBlob = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob,
}));

import {
  deleteVisualEditSnapshotBlobs,
  parseVisualEditSnapshotBlobHandle,
} from "./visual-edit-snapshot-blobs.js";

const handle = {
  id: "snapshot-blob",
  provider: "private-provider",
  opaque: true,
  encrypted: true,
};

describe("visual-edit snapshot blob cleanup", () => {
  beforeEach(() => {
    deletePrivateBlob.mockReset();
    deletePrivateBlob.mockResolvedValue({ deleted: true });
  });

  it("parses an opaque private blob handle and rejects malformed stored values", () => {
    expect(parseVisualEditSnapshotBlobHandle(JSON.stringify(handle))).toEqual(
      handle,
    );
    expect(() => parseVisualEditSnapshotBlobHandle("not-json")).toThrow(
      /malformed/,
    );
    expect(() =>
      parseVisualEditSnapshotBlobHandle(
        JSON.stringify({ ...handle, opaque: false }),
      ),
    ).toThrow(/invalid/);
  });

  it("deletes each committed handle once and logs provider failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deletePrivateBlob.mockResolvedValueOnce({
      deleted: false,
      provider: "private-provider",
      reason: "unsupported",
    });

    await deleteVisualEditSnapshotBlobs([
      JSON.stringify(handle),
      JSON.stringify(handle),
      null,
    ]);

    expect(deletePrivateBlob).toHaveBeenCalledTimes(1);
    expect(deletePrivateBlob).toHaveBeenCalledWith(handle);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
