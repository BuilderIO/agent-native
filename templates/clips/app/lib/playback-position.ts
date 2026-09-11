import {
  callAction,
  tryCallActionKeepalive,
} from "@agent-native/core/client/hooks";

import { getViewerSessionId } from "./viewer-session";

export interface PlaybackPositionRecord {
  recordingId: string;
  viewerKey: string;
  viewerEmail: string | null;
  positionMs: number;
  updatedAt: string | null;
}

interface PlaybackPositionActionResult {
  playbackPosition: PlaybackPositionRecord | null;
}

function parsePlaybackPosition(payload: unknown): number | null {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("playbackPosition" in payload)
  ) {
    throw new Error("Invalid playback position response");
  }
  const playbackPosition = (payload as { playbackPosition?: unknown })
    .playbackPosition;
  if (playbackPosition === null) return null;
  if (typeof playbackPosition !== "object") {
    throw new Error("Invalid playback position payload");
  }
  const positionMs = (playbackPosition as { positionMs?: unknown }).positionMs;
  if (
    typeof positionMs !== "number" ||
    !Number.isFinite(positionMs) ||
    positionMs < 0
  ) {
    throw new Error("Invalid playback position payload");
  }
  return positionMs;
}

export async function getPlaybackPosition(
  recordingId: string,
  options: {
    sessionId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<number | null> {
  const sessionId = options.sessionId ?? getViewerSessionId();
  const payload = await callAction<PlaybackPositionActionResult>(
    "get-playback-position",
    { recordingId, sessionId },
    { method: "GET", signal: options.signal },
  );
  return parsePlaybackPosition(payload);
}

export async function savePlaybackPosition(
  recordingId: string,
  positionMs: number,
  options: {
    sessionId?: string;
    signal?: AbortSignal;
    keepalive?: boolean;
  } = {},
): Promise<void> {
  const sessionId = options.sessionId ?? getViewerSessionId();
  const params = { recordingId, positionMs, sessionId };

  if (options.keepalive) {
    const request = tryCallActionKeepalive<PlaybackPositionActionResult>(
      "save-playback-position",
      params,
      { signal: options.signal },
    );
    if (!request.accepted) {
      throw new Error(
        `Failed to save playback position during unload (${request.reason})`,
      );
    }
    const payload = await request.completion;
    if (parsePlaybackPosition(payload) === null) {
      throw new Error("Invalid playback position payload");
    }
    return;
  }

  const payload = await callAction<PlaybackPositionActionResult>(
    "save-playback-position",
    params,
    { signal: options.signal },
  );
  if (parsePlaybackPosition(payload) === null) {
    throw new Error("Invalid playback position payload");
  }
}
