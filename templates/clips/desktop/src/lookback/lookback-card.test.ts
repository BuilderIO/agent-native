import { describe, expect, it } from "vitest";

import type { RecordingContextItem } from "./context-api";
import {
  canEditLookbackWindow,
  isLookbackSaving,
  lookbackCardLine,
} from "./lookback-card";

function view(
  status: RecordingContextItem["status"] | null,
  requestedSeconds = 30,
) {
  const item =
    status === null
      ? null
      : ({
          id: "ctx1",
          recordingId: "rec1",
          requestedSeconds,
          status,
        } as RecordingContextItem);
  return { status: "loaded" as const, item };
}

describe("lookbackCardLine", () => {
  it("shows the saving line while the export is pending or running", () => {
    expect(lookbackCardLine(view("pending"))).toEqual({
      kind: "saving",
      window: "30 s",
    });
    expect(lookbackCardLine(view("processing", 300))).toEqual({
      kind: "saving",
      window: "5 min",
    });
  });

  it("shows the window once it is ready and the error state when it failed", () => {
    expect(lookbackCardLine(view("ready", 150))).toEqual({
      kind: "ready",
      window: "2 min 30 s",
    });
    expect(lookbackCardLine(view("failed"))).toEqual({ kind: "failed" });
  });

  it("hides the line when there is no item or it was removed", () => {
    expect(lookbackCardLine(view(null))).toEqual({ kind: "hidden" });
    expect(lookbackCardLine(view("removed"))).toEqual({ kind: "hidden" });
  });

  it("reports an unreadable read as its own state, not as no context", () => {
    expect(lookbackCardLine({ status: "error", item: null })).toEqual({
      kind: "unreadable",
    });
    expect(lookbackCardLine({ status: "idle", item: null })).toEqual({
      kind: "hidden",
    });
  });
});

describe("edit and saving predicates", () => {
  it("allows editing only after the export has settled", () => {
    const item = (status: RecordingContextItem["status"]) =>
      ({ status }) as RecordingContextItem;
    expect(canEditLookbackWindow(item("ready"))).toBe(true);
    expect(canEditLookbackWindow(item("failed"))).toBe(true);
    expect(canEditLookbackWindow(item("pending"))).toBe(false);
    expect(canEditLookbackWindow(item("processing"))).toBe(false);
    expect(canEditLookbackWindow(null)).toBe(false);
    expect(isLookbackSaving(item("processing"))).toBe(true);
    expect(isLookbackSaving(item("ready"))).toBe(false);
  });
});
