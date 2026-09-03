import { describe, expect, it, vi } from "vitest";

const writeAppState = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({ writeAppState }));

import {
  brainExportStateKey,
  parseBrainExportState,
  writeBrainExportState,
} from "./brain-export-state.js";

describe("brain export state", () => {
  it("uses a recording-scoped key and stores delivery proof without credentials", async () => {
    await writeBrainExportState({
      recordingId: "rec-1",
      status: "exported",
      attempts: 1,
      updatedAt: "2026-07-22T00:00:00.000Z",
      captureId: "capture-1",
    });
    expect(brainExportStateKey("rec-1")).toBe("clips-brain-export-rec-1");
    expect(writeAppState).toHaveBeenCalledWith("clips-brain-export-rec-1", {
      recordingId: "rec-1",
      status: "exported",
      attempts: 1,
      updatedAt: "2026-07-22T00:00:00.000Z",
      captureId: "capture-1",
    });
  });

  it("rejects malformed persisted state", () => {
    expect(
      parseBrainExportState({ recordingId: "rec-1", status: "exported" }),
    ).toBeNull();
  });
});
