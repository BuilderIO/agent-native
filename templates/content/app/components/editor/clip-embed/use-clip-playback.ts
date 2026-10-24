import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  isClipPlaybackErrorCode,
  type ClipCommentMarker,
  type ClipPlayback,
  type ClipPlaybackErrorCode,
} from "@shared/clips-peer-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import { grantRefreshDelay, youtubeEmbedSrc } from "./clip-media";

/** No write changes a grant, so Clip queries refetch only when asked. */
const CLIP_PLAYBACK_RESOURCE = "clip-playback";

export type ClipPlayerError =
  | ClipPlaybackErrorCode
  /** A refresh failed with no reason Content knows. */
  | "refresh_failed"
  /** The source still failed after a fresh grant. */
  | "unplayable"
  /** The action failed with no reason Content knows. */
  | "failed";

function errorCodeOf(error: unknown): ClipPlaybackErrorCode | null {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return isClipPlaybackErrorCode(code) ? code : null;
}

export interface ClipPlaybackState {
  /** The grant the player is on. Later refetches don't move it. */
  grant: ClipPlayback | null;
  loading: boolean;
  error: ClipPlayerError | null;
  /** The `<video>` failed to load or play its source. */
  onMediaError: () => void;
  retry: () => void;
}

/**
 * Plays a Clip on one grant at a time. Any write refetches untagged action
 * queries and every answer carries new URLs, so the player swaps sources
 * only when its grant is about to run out or its source fails, never because
 * a newer answer arrived.
 */
export function useClipPlayback(
  documentId: string,
  recordingId: string,
): ClipPlaybackState {
  const query = useActionQuery(
    "get-clip-playback",
    { documentId, recordingId },
    {
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
      refetchOnWindowFocus: false,
      resources: [CLIP_PLAYBACK_RESOURCE],
    },
  );
  const { refetch } = query;
  const [held, setHeld] = useState<ClipPlayback | null>(null);
  const [failure, setFailure] = useState<ClipPlayerError | null>(null);
  const [retrying, setRetrying] = useState(false);
  // The source a media error already refreshed to; failing again is final.
  const refreshedAfterErrorTo = useRef<string | null | undefined>(undefined);

  const grant = held ?? query.data ?? null;
  useEffect(() => {
    if (!held && query.data) setHeld(query.data);
  }, [held, query.data]);

  const refresh = useCallback(
    async (afterMediaError: boolean) => {
      const result = await refetch();
      if (result.isError || !result.data) {
        setFailure(errorCodeOf(result.error) ?? "refresh_failed");
        return;
      }
      if (afterMediaError) {
        refreshedAfterErrorTo.current = result.data.playback.videoUrl;
      }
      setHeld(result.data);
      setFailure(null);
    },
    [refetch],
  );

  const expiresAt = grant?.playback.expiresAt;
  const playsFromYoutube = youtubeEmbedSrc(grant?.playback.videoUrl ?? null);
  useEffect(() => {
    // A YouTube player streams on its own; swapping its URL restarts it.
    if (!expiresAt || failure || playsFromYoutube) return;
    const timer = setTimeout(
      () => void refresh(false),
      grantRefreshDelay(expiresAt, Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, failure, playsFromYoutube, refresh]);

  const videoUrl = grant?.playback.videoUrl ?? null;
  const onMediaError = useCallback(() => {
    if (refreshedAfterErrorTo.current === videoUrl) {
      setFailure("unplayable");
      return;
    }
    void refresh(true);
  }, [refresh, videoUrl]);

  // The query keeps the answer a failed refetch replaced, so a retry plays
  // only what its own refetch returns. The failure it is retrying stays set
  // until then, which keeps the expiry timer from refetching alongside it.
  const retry = useCallback(() => {
    refreshedAfterErrorTo.current = undefined;
    setRetrying(true);
    void refresh(false).finally(() => setRetrying(false));
  }, [refresh]);

  if (retrying) {
    return { grant: null, loading: true, error: null, onMediaError, retry };
  }
  const loadError =
    !grant && query.isError ? (errorCodeOf(query.error) ?? "failed") : null;
  return {
    grant,
    loading: !grant && !loadError,
    error: failure ?? loadError,
    onMediaError,
    retry,
  };
}

export type ClipMarkersState =
  | { status: "loading" }
  | { status: "ready"; markers: ClipCommentMarker[] }
  | { status: "off" }
  /** Markers from an earlier answer may still be there to show. */
  | { status: "failed"; markers: ClipCommentMarker[] };

/** The Clip's comment threads for the scrubber, when its comments are on. */
export function useClipMarkers(
  documentId: string,
  recordingId: string,
  commentsOn: boolean,
): ClipMarkersState {
  const query = useActionQuery(
    "list-clip-comments",
    { documentId, recordingId },
    {
      enabled: commentsOn,
      retry: false,
      refetchOnWindowFocus: false,
      resources: [CLIP_PLAYBACK_RESOURCE],
    },
  );
  if (!commentsOn) return { status: "off" };
  // A failed refetch keeps the earlier answer's data, so check the error first.
  if (query.isError) {
    // Comments turned off after the grant was issued: same as off.
    return errorCodeOf(query.error) === "clip_comments_disabled"
      ? { status: "off" }
      : { status: "failed", markers: query.data?.markers ?? [] };
  }
  if (query.data) return { status: "ready", markers: query.data.markers };
  return { status: "loading" };
}
