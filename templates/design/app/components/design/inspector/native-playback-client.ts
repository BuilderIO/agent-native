export interface NativeInstancePlaybackState {
  instanceLocalTimeSeconds: number;
  instancePaused: boolean;
}

export class NativePlaybackClientError extends Error {
  constructor(
    readonly code:
      | "frame-unavailable"
      | "playback-unavailable"
      | "playback-unreadable",
  ) {
    super(code);
    this.name = "NativePlaybackClientError";
  }
}

export function readNativeInstancePlaybackState(
  frame: HTMLIFrameElement,
  instanceId: string,
): NativeInstancePlaybackState {
  let value: unknown;
  try {
    const runtime = (
      frame.contentWindow as
        | (Window & {
            __anNativeShaders?: { playbackState?: (id: string) => unknown };
          })
        | null
    )?.__anNativeShaders;
    if (!runtime?.playbackState)
      throw new NativePlaybackClientError("playback-unavailable");
    value = runtime.playbackState(instanceId);
  } catch (error) {
    if (error instanceof NativePlaybackClientError) throw error;
    throw new NativePlaybackClientError("frame-unavailable");
  }
  if (!value || typeof value !== "object")
    throw new NativePlaybackClientError("playback-unreadable");
  const state = value as Record<string, unknown>;
  if (
    typeof state.instanceLocalTimeSeconds !== "number" ||
    !Number.isFinite(state.instanceLocalTimeSeconds) ||
    state.instanceLocalTimeSeconds < 0 ||
    typeof state.instancePaused !== "boolean"
  )
    throw new NativePlaybackClientError("playback-unreadable");
  return {
    instanceLocalTimeSeconds: state.instanceLocalTimeSeconds,
    instancePaused: state.instancePaused,
  };
}
