import { describe, expect, it } from "vitest";

import {
  embedFramesUnavailableReason,
  isEmbedBackedRecording,
  recordingEmbedProvider,
} from "./embed-provider";

describe("recordingEmbedProvider", () => {
  it("names the service whose player plays the clip", () => {
    expect(
      recordingEmbedProvider({
        sourceAppName: "YouTube",
        videoUrl: "https://www.youtube.com/embed/jNQXAC9IVRw",
      }),
    ).toBe("youtube");
    expect(
      recordingEmbedProvider({
        sourceAppName: "Loom",
        videoUrl: "https://www.loom.com/embed/abcdefgh",
      }),
    ).toBe("loom");
  });

  it("treats Clips-hosted videos, including reuploaded Loom imports, as native", () => {
    expect(
      recordingEmbedProvider({ videoUrl: "https://store.example/clip.mp4" }),
    ).toBeNull();
    expect(
      isEmbedBackedRecording({
        sourceAppName: "Loom",
        videoUrl: "https://store.example/loom-reupload.mp4",
      }),
    ).toBe(false);
    expect(isEmbedBackedRecording(undefined)).toBe(false);
  });

  it("explains why each provider has no frames", () => {
    expect(embedFramesUnavailableReason("youtube")).toContain(
      "YouTube's embedded player",
    );
    expect(embedFramesUnavailableReason("loom")).toContain("Loom embed");
  });
});
