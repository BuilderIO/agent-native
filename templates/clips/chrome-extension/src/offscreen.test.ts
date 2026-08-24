import type { ScreenCaptureSurface } from "@shared/recording-capture";
import { beforeAll, describe, expect, it } from "vitest";

// The offscreen document registers a chrome.runtime.onMessage listener as
// soon as the module loads, so the chrome stub must be in place before
// offscreen.ts is imported — a dynamic import() (rather than a static one,
// which ES modules hoist above this file's own top-level code) keeps the
// load until after the stub below runs.
let displayConstraints: (
  surface: ScreenCaptureSurface,
  wantsMic: boolean,
) => MediaStreamConstraints;

beforeAll(async () => {
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      onMessage: { addListener: () => undefined },
      getManifest: () => ({ version: "test" }),
    },
    storage: {
      sync: { get: async () => ({}) },
    },
  };
  ({ displayConstraints } = await import("./offscreen"));
});

describe("offscreen display capture audio policy", () => {
  it("does not request screen/tab audio when the microphone toggle is off", () => {
    const constraints = displayConstraints("monitor", false) as {
      audio: unknown;
      systemAudio?: string;
    };
    expect(constraints.audio).toBe(false);
    expect(constraints.systemAudio).toBe("exclude");
  });

  it("requests screen/tab audio when the microphone toggle is on", () => {
    const constraints = displayConstraints("monitor", true) as {
      audio: unknown;
      systemAudio?: string;
    };
    expect(constraints.audio).toBe(true);
    expect(constraints.systemAudio).toBe("include");
  });
});
