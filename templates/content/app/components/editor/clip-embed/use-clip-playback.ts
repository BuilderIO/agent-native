import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  isClipPlaybackErrorCode,
  type ClipCommentMarker,
  type ClipPlayback,
  type ClipPlaybackErrorCode,
} from "@shared/clips-peer-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  GRANT_REFRESH_RETRY_DELAYS_MS,
  grantRefreshDelay,
  youtubeEmbedSrc,
} from "./clip-media";

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

/** Clips didn't answer, or asked to be asked later: the next try may work. */
const OUTAGES = new Set<ClipPlayerError>([
  "clips_unreachable",
  "clip_rate_limited",
  "refresh_failed",
  "failed",
]);

type RefreshCause =
  /** The grant is about to run out, and its source still plays. */
  | "expiring"
  /** The source failed to load or play. */
  | "media-error"
  /** The reader asked again, or came back to the tab, from a failure. */
  | "asked";

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
 * a newer answer arrived. A refresh Clips doesn't answer leaves the source
 * playing; the outage shows only once the source fails or the grant runs out.
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
  // Refreshes Clips didn't answer while the source still played.
  const [stalled, setStalled] = useState<{
    reason: ClipPlayerError;
    tries: number;
  } | null>(null);
  const [retrying, setRetrying] = useState(false);
  // The source a media error already refreshed to; failing again is final.
  const refreshedAfterErrorTo = useRef<string | null | undefined>(undefined);

  const grant = held ?? query.data ?? null;
  useEffect(() => {
    if (!held && query.data) setHeld(query.data);
  }, [held, query.data]);

  const refresh = useCallback(
    async (cause: RefreshCause) => {
      const result = await refetch();
      if (result.isError || !result.data) {
        const reason = errorCodeOf(result.error) ?? "refresh_failed";
        if (cause === "expiring" && OUTAGES.has(reason)) {
          setStalled((last) => ({ reason, tries: (last?.tries ?? 0) + 1 }));
        } else {
          setFailure(reason);
        }
        return;
      }
      if (cause === "media-error") {
        refreshedAfterErrorTo.current = result.data.playback.videoUrl;
      }
      setHeld(result.data);
      setStalled(null);
      setFailure(null);
    },
    [refetch],
  );

  const expiresAt = grant?.playback.expiresAt;
  const playsFromYoutube = youtubeEmbedSrc(grant?.playback.videoUrl ?? null);
  useEffect(() => {
    // A YouTube player streams on its own; swapping its URL restarts it.
    if (!expiresAt || failure || playsFromYoutube) return;
    const now = Date.now();
    if (!stalled) {
      const timer = setTimeout(
        () => void refresh("expiring"),
        grantRefreshDelay(expiresAt, now),
      );
      return () => clearTimeout(timer);
    }
    // Tries stop when the grant runs out, which is when its source fails.
    const left = Date.parse(expiresAt) - now;
    const wait = GRANT_REFRESH_RETRY_DELAYS_MS[stalled.tries - 1];
    const retryTimer =
      wait !== undefined && wait < left
        ? setTimeout(() => void refresh("expiring"), wait)
        : undefined;
    const expiryTimer = setTimeout(
      () => setFailure(stalled.reason),
      Math.max(0, left),
    );
    return () => {
      clearTimeout(retryTimer);
      clearTimeout(expiryTimer);
    };
  }, [expiresAt, failure, playsFromYoutube, refresh, stalled]);

  const videoUrl = grant?.playback.videoUrl ?? null;
  const onMediaError = useCallback(() => {
    if (refreshedAfterErrorTo.current === videoUrl) {
      setFailure("unplayable");
      return;
    }
    void refresh("media-error");
  }, [refresh, videoUrl]);

  // The query keeps the answer a failed refetch replaced, so a retry plays
  // only what its own refetch returns. The failure it is retrying stays set
  // until then, which keeps the expiry timer from refetching alongside it.
  const retry = useCallback(() => {
    refreshedAfterErrorTo.current = undefined;
    setRetrying(true);
    void refresh("asked").finally(() => setRetrying(false));
  }, [refresh]);

  const loadError =
    !grant && query.isError ? (errorCodeOf(query.error) ?? "failed") : null;
  const error = failure ?? loadError;

  // Through an outage nothing asks on a timer; coming back to the tab asks
  // once, and a hidden tab never asks.
  const outage = !retrying && error !== null && OUTAGES.has(error);
  useEffect(() => {
    if (!outage) return;
    let asking = false;
    const askOnce = () => {
      if (asking || document.visibilityState === "hidden") return;
      asking = true;
      void refresh("asked").finally(() => {
        asking = false;
      });
    };
    window.addEventListener("focus", askOnce);
    document.addEventListener("visibilitychange", askOnce);
    return () => {
      window.removeEventListener("focus", askOnce);
      document.removeEventListener("visibilitychange", askOnce);
    };
  }, [outage, refresh]);

  if (retrying) {
    return { grant: null, loading: true, error: null, onMediaError, retry };
  }
  return {
    grant,
    loading: !grant && !loadError,
    error,
    onMediaError,
    retry,
  };
}

export type ClipMarkersState =
  | { status: "loading" }
  /** `truncated`: Clips has more threads than the first ones listed. */
  | { status: "ready"; markers: ClipCommentMarker[]; truncated: boolean }
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
  if (query.data) {
    return {
      status: "ready",
      markers: query.data.markers,
      truncated: query.data.truncated,
    };
  }
  return { status: "loading" };
}
