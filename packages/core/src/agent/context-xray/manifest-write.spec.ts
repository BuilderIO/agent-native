import { describe, expect, it, vi } from "vitest";

import {
  _resetContextManifestWriteOutcomes,
  buildManifest,
  getContextManifestWriteOutcome,
  writeContextManifest,
} from "./manifest.js";

const appStatePut = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../application-state/store.js", () => ({ appStatePut }));

describe("writeContextManifest outcomes", () => {
  it("reports a failed persist instead of looking like a completed one", async () => {
    _resetContextManifestWriteOutcomes();
    appStatePut.mockRejectedValueOnce(new Error("store unavailable"));
    const manifest = await buildManifest({
      threadId: "thread-write",
      turnId: "turn-2",
      rawMessages: [],
      sentMessages: [],
      appliedStatus: new Map(),
      directives: new Map(),
    });

    const failed = await writeContextManifest("thread-write", manifest);
    expect(failed).toMatchObject({
      status: "failed",
      turnId: "turn-2",
      error: "store unavailable",
    });
    expect(getContextManifestWriteOutcome("thread-write")).toBe(failed);

    const written = await writeContextManifest("thread-write", manifest);
    expect(written.status).toBe("written");
    expect(appStatePut).toHaveBeenLastCalledWith(
      "thread-write",
      expect.any(String),
      expect.objectContaining({ writeStatus: "written", turnId: "turn-2" }),
      expect.objectContaining({ requestSource: "context-xray" }),
    );
    _resetContextManifestWriteOutcomes();
  });
});
