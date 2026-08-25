import type { ScreenCaptureSurface } from "@shared/recording-capture";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MEDIA_PERMISSION_REQUIRED_CODE,
  MediaPermissionRequiredError,
} from "./media-permission";

// The offscreen document registers a chrome.runtime.onMessage listener as
// soon as the module loads, so the chrome stub must be in place before
// offscreen.ts is imported — a dynamic import() (rather than a static one,
// which ES modules hoist above this file's own top-level code) keeps the
// load until after the stub below runs.
let displayConstraints: (
  surface: ScreenCaptureSurface,
  wantsMic: boolean,
) => MediaStreamConstraints;
let errorResponse: (error: unknown) => {
  ok: false;
  error: string;
  errorCode?: string;
  errorDevice?: string;
};

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
  ({ displayConstraints, errorResponse } = await import("./offscreen"));
});

describe("offscreen error replies", () => {
  it("carries a missing grant across the message boundary as a code", () => {
    const response = errorResponse(
      new MediaPermissionRequiredError("microphone"),
    );

    expect(response.errorCode).toBe(MEDIA_PERMISSION_REQUIRED_CODE);
    expect(response.errorDevice).toBe("microphone");
  });

  it("reports every other capture failure as a plain message", () => {
    const response = errorResponse(new Error("No chunks found"));

    expect(response.error).toBe("No chunks found");
    expect(response.errorCode).toBeUndefined();
  });
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
