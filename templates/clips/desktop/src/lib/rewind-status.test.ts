import { describe, expect, it } from "vitest";

import type { ScreenMemoryConfig, ScreenMemoryStatus } from "../shared/config";
import { getRewindStatusPresentation } from "./rewind-status";

const config: ScreenMemoryConfig = {
  enabled: true,
  paused: false,
  retentionHours: 8,
  maxBytes: 5 * 1024 * 1024 * 1024,
  segmentSeconds: 300,
  sampleIntervalSeconds: 5,
  captureMode: "visuals",
  reviewBeforeSending: true,
  autoPreviewBeforeSending: true,
  agentClipRetention: "forever",
  excludedBundleIds: [],
  excludePrivateWindows: true,
};

function status(patch: Partial<ScreenMemoryStatus> = {}): ScreenMemoryStatus {
  return {
    available: true,
    state: "recording",
    config,
    storageDir: "/tmp/rewind",
    activeSegment: null,
    recentSegments: [],
    lastError: null,
    exclusionActive: false,
    coverage: "Rewind is retaining local media coverage.",
    ...patch,
  };
}

describe("getRewindStatusPresentation", () => {
  it.each([
    {
      name: "disabled",
      input: status({
        state: "disabled",
        config: { ...config, enabled: false },
      }),
      kind: "off",
      title: "Rewind is off",
    },
    {
      name: "paused",
      input: status({ state: "paused", config: { ...config, paused: true } }),
      kind: "paused",
      title: "Rewind is paused",
    },
    {
      name: "recording",
      input: status(),
      kind: "recording",
      title: "Rewind is remembering",
    },
    {
      name: "excluded",
      input: status({ exclusionActive: true }),
      kind: "excluded",
      title: "Rewind is protecting a private moment",
    },
    {
      name: "idle",
      input: status({ state: "idle", activeSegment: null }),
      kind: "idle",
      title: "Rewind is enabled but not currently capturing",
    },
    {
      name: "unavailable",
      input: status({ available: false, state: "idle" }),
      kind: "unavailable",
      title: "Rewind is unavailable",
    },
  ])("maps $name from native runtime truth", ({ input, kind, title }) => {
    const presentation = getRewindStatusPresentation({
      status: input,
      config,
    });

    expect(presentation.kind).toBe(kind);
    expect(presentation.title).toBe(title);
    expect(presentation.isLive).toBe(kind === "recording");
  });

  it("does not call an unexplained idle state a permission failure", () => {
    const presentation = getRewindStatusPresentation({
      status: status({ state: "idle" }),
      config,
    });

    expect(presentation.detail).toBe(
      "No new local coverage is being retained right now.",
    );
    expect(presentation.detail.toLowerCase()).not.toContain("permission");
  });

  it("explains idle while a Clip owns capture without claiming Rewind is live", () => {
    const presentation = getRewindStatusPresentation({
      status: status({ state: "idle" }),
      config,
      clipRecordingActive: true,
    });

    expect(presentation.detail).toBe("Rewind will resume when this Clip ends.");
    expect(presentation.isLive).toBe(false);
  });

  it("shows the concrete native permission error without guessing from idle", () => {
    const error =
      "Screen Recording permission denied. Open System Settings > Privacy & Security > Screen Recording, enable Clips, then try again.";
    const presentation = getRewindStatusPresentation({
      status: status({ state: "idle", lastError: error }),
      config,
    });

    expect(presentation.kind).toBe("error");
    expect(presentation.title).toBe("Rewind needs attention");
    expect(presentation.detail).toBe(error);
    expect(presentation.isLive).toBe(false);
  });

  it("keeps live capture truthful while surfacing an auxiliary error", () => {
    const error = "Could not write visual index metadata.";
    const presentation = getRewindStatusPresentation({
      status: status({ state: "recording", lastError: error }),
      config,
    });

    expect(presentation.kind).toBe("recording");
    expect(presentation.title).toBe("Rewind is remembering");
    expect(presentation.detail).toBe(error);
    expect(presentation.isLive).toBe(true);
    expect(presentation.hasError).toBe(true);
  });

  it("uses native config when status and observed config disagree", () => {
    const presentation = getRewindStatusPresentation({
      status: status({ state: "paused", config: { ...config, paused: true } }),
      config,
    });

    expect(presentation.kind).toBe("paused");
  });

  it("uses observed intent while the first native status is loading", () => {
    const presentation = getRewindStatusPresentation({
      status: null,
      config,
    });

    expect(presentation.kind).toBe("idle");
    expect(presentation.isLive).toBe(false);
  });
});
