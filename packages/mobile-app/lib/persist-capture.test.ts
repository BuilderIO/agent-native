import { describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {},
  Paths: { document: "file:///documents" },
}));

import {
  findOrphanedCaptureUris,
  recoverableCaptureFromFile,
} from "./persist-capture";

describe("capture file cleanup", () => {
  it("only selects files that no queue job references", () => {
    expect(
      findOrphanedCaptureUris(
        ["file:///captures/kept.m4a", "file:///captures/orphan.m4a"],
        ["file:///captures/kept.m4a"],
      ),
    ).toEqual(["file:///captures/orphan.m4a"]);
  });

  it("rebuilds safe audio and video queue metadata after a store reset", () => {
    expect(
      recoverableCaptureFromFile({
        extension: "m4a",
        name: "capture_recovered_123.m4a",
        size: 1_024,
        uri: "file:///captures/capture_recovered_123.m4a",
      }),
    ).toEqual([
      {
        captureId: "capture_recovered_123",
        kind: "meeting",
        localUri: "file:///captures/capture_recovered_123.m4a",
        mimeType: "audio/mp4",
        title: "Recovered audio capture",
      },
    ]);
    expect(
      recoverableCaptureFromFile({
        extension: "bin",
        name: "capture_unknown_123.bin",
        size: 1_024,
        uri: "file:///captures/capture_unknown_123.bin",
      }),
    ).toEqual([]);
  });
});
