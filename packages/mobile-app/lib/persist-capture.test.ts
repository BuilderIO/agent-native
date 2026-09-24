import { beforeEach, describe, expect, it, vi } from "vitest";

const fileSystem = vi.hoisted(() => {
  const state = {
    deletedUris: [] as string[],
    entries: [] as MockFile[],
  };

  class MockFile {
    creationTime: number | null = null;
    exists = true;
    extension = "";
    modificationTime: number | null = null;
    name = "";
    size = 0;
    uri: string;

    constructor(first: string, second?: string) {
      this.uri = second ? `${String(first)}/${second}` : String(first);
    }

    delete() {
      this.exists = false;
      state.deletedUris.push(this.uri);
    }
  }

  class MockDirectory {
    exists = true;

    create() {}

    list() {
      return state.entries;
    }
  }

  return { MockDirectory, MockFile, state };
});

vi.mock("expo-file-system", () => ({
  Directory: fileSystem.MockDirectory,
  File: fileSystem.MockFile,
  Paths: { document: "file:///documents" },
}));

import {
  findOrphanedCaptureUris,
  recoverableCaptureFromFile,
  sweepOrphanedCaptureFiles,
} from "./persist-capture";

describe("capture file cleanup", () => {
  beforeEach(() => {
    fileSystem.state.deletedUris = [];
    fileSystem.state.entries = [];
  });

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

  it("only sweeps old unreferenced files and retains fresh unknown captures", () => {
    const nowMs = 10_000;
    const oldOrphan = Object.assign(
      new fileSystem.MockFile("file:///captures/old-orphan.bin"),
      { modificationTime: 1_000 },
    );
    const freshOrphan = Object.assign(
      new fileSystem.MockFile("file:///captures/fresh-orphan.bin"),
      { modificationTime: 9_500 },
    );
    const unknownAgeOrphan = new fileSystem.MockFile(
      "file:///captures/unknown-age.bin",
    );
    const referenced = Object.assign(
      new fileSystem.MockFile("file:///captures/referenced.m4a"),
      { modificationTime: 1_000 },
    );
    fileSystem.state.entries = [
      oldOrphan,
      freshOrphan,
      unknownAgeOrphan,
      referenced,
    ];

    expect(
      sweepOrphanedCaptureFiles([referenced.uri], {
        minimumAgeMs: 1_000,
        nowMs,
      }),
    ).toEqual([oldOrphan.uri]);
    expect(fileSystem.state.deletedUris).toEqual([oldOrphan.uri]);
    expect(freshOrphan.exists).toBe(true);
    expect(unknownAgeOrphan.exists).toBe(true);
    expect(referenced.exists).toBe(true);
  });
});
