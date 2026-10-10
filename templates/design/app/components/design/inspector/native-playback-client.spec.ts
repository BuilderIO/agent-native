import { describe, expect, it } from "vitest";

import {
  NativePlaybackClientError,
  readNativeInstancePlaybackState,
} from "./native-playback-client";

function frameWith(value: unknown): HTMLIFrameElement {
  return {
    contentWindow: {
      __anNativeShaders: { playbackState: () => value },
    },
  } as unknown as HTMLIFrameElement;
}

describe("native instance playback snapshots", () => {
  it("returns the selected instance's local clock rather than the document clock", () => {
    expect(
      readNativeInstancePlaybackState(
        frameWith({
          timeSeconds: 91,
          playing: true,
          instanceLocalTimeSeconds: 3.75,
          instancePaused: false,
        }),
        "selected",
      ),
    ).toEqual({ instanceLocalTimeSeconds: 3.75, instancePaused: false });
  });

  it("rejects missing and unreadable playback instead of writing a stale saved time", () => {
    expect(() =>
      readNativeInstancePlaybackState(
        frameWith({ instanceLocalTimeSeconds: NaN, instancePaused: false }),
        "selected",
      ),
    ).toThrowError(NativePlaybackClientError);
    expect(() =>
      readNativeInstancePlaybackState(
        { contentWindow: {} } as HTMLIFrameElement,
        "selected",
      ),
    ).toThrowError(NativePlaybackClientError);
  });
});
