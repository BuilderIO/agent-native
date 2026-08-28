import { appBasePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { AccessPasswordPrompt } from "@/components/player/access-password-prompt";
import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/player/video-player";
import { Spinner } from "@/components/ui/spinner";
import { useViewTracking } from "@/hooks/use-view-tracking";
import { parsePlaybackSpeed } from "@/lib/playback-speed";
import { parseTimeParam, resolveStartMs } from "@/lib/time-param";

import { isLoomEmbedBackedRecording } from "../../shared/loom";
import { clipsSharePageTitle } from "../../shared/share-meta";

export function meta() {
  return [{ title: "Clip" }];
}

const STORAGE_KEY_PREFIX = "clips-share-pw-";
const READY_MEDIA_SETTLE_POLL_MS = 20 * 1000;
const READY_MEDIA_SETTLE_POLL_INTERVAL_MS = 1000;

export default function EmbedRoute() {
  const t = useT();
  const { shareId } = useParams<{ shareId: string }>();
  const [searchParams] = useSearchParams();
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  const autoplay = searchParams.get("autoplay") === "1";
  const hideControls = searchParams.get("hideControls") === "1";
  const hideCaptions = searchParams.get("hideCaptions") === "1";
  const startMs = useMemo(
    () => parseTimeParam(searchParams.get("t")),
    [searchParams],
  );

  // Same hydration trap the share route had: reading sessionStorage in the
  // initializer makes the first client render disagree with the server's,
  // which has no storage and always renders the locked state. React discards
  // the hydrated tree and re-renders from scratch, so an embedded player goes
  // blank for a returning viewer. Start where the server started and adopt the
  // stored password after mount.
  const [password, setPassword] = useState<string | null>(null);

  useEffect(() => {
    if (!shareId) return;
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_PREFIX + shareId);
      if (stored) setPassword(stored);
      // Unreadable storage and no stored password are the same state here:
      // both leave `password` null, which renders the password prompt.
      // coercion-ok: the fallback is visible to the viewer, not swallowed.
    } catch {}
  }, [shareId]);
  const [pwError, setPwError] = useState<string | null>(null);
  const readyMediaPollRef = useRef<{ key: string; until: number } | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      bodyBackground: body.style.background,
    };

    html.style.overflow = "hidden";
    html.style.height = "100%";
    body.style.overflow = "hidden";
    body.style.height = "100%";
    body.style.background = "#000";

    return () => {
      html.style.overflow = previous.htmlOverflow;
      html.style.height = previous.htmlHeight;
      body.style.overflow = previous.bodyOverflow;
      body.style.height = previous.bodyHeight;
      body.style.background = previous.bodyBackground;
    };
  }, []);

  const dataQ = useQuery({
    queryKey: ["public-recording", shareId, password],
    queryFn: async () => {
      const url = new URL(
        `${appBasePath()}/api/public-recording`,
        window.location.origin,
      );
      url.searchParams.set("id", shareId ?? "");
      if (password) url.searchParams.set("password", password);
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    },
    enabled: !!shareId,
    refetchInterval: (q) => {
      const payload = (q.state.data as { data?: any } | undefined)?.data;
      const rec = payload?.recording;
      if (!rec) return false;
      if (rec.status !== "ready" || !rec.videoUrl) {
        readyMediaPollRef.current = null;
        return 2000;
      }
      if (rec.seekableRepairPending === true) {
        readyMediaPollRef.current = null;
        return READY_MEDIA_SETTLE_POLL_INTERVAL_MS;
      }
      const mediaKey = [
        rec.id,
        rec.durationMs ?? "",
        rec.videoSizeBytes ?? "",
        rec.videoFormat ?? "",
        rec.updatedAt ?? "",
      ].join(":");
      const now = Date.now();
      if (readyMediaPollRef.current?.key !== mediaKey) {
        readyMediaPollRef.current = {
          key: mediaKey,
          until: now + READY_MEDIA_SETTLE_POLL_MS,
        };
      }
      return now < readyMediaPollRef.current.until
        ? READY_MEDIA_SETTLE_POLL_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: false,
  });

  const recording = dataQ.data?.data?.recording;

  useEffect(() => {
    if (!recording) return;
    const nextTitle = clipsSharePageTitle(recording.title);
    const previousTitle = document.title;
    document.title = nextTitle;
    return () => {
      if (document.title === nextTitle) document.title = previousTitle;
    };
  }, [recording?.title]);

  const comments = dataQ.data?.data?.comments ?? [];
  const transcriptSegments = dataQ.data?.data?.transcript?.segments ?? [];
  const chapters = dataQ.data?.data?.chapters ?? [];
  const ctas = dataQ.data?.data?.ctas ?? [];
  const firstCta = ctas[0] ?? null;
  const isLoomEmbedBacked = isLoomEmbedBackedRecording(recording);

  const [trackedVideoEl, setTrackedVideoEl] = useState<HTMLVideoElement | null>(
    null,
  );

  const tracking = useViewTracking({
    recordingId: shareId ?? "",
    videoEl: trackedVideoEl,
    durationMs: recording?.durationMs ?? 0,
    trackOpenWithoutVideo: isLoomEmbedBacked,
  });

  const needsPassword =
    dataQ.data?.status === 401 && dataQ.data.data?.passwordRequired;

  function onSubmitPassword(pw: string) {
    setPwError(null);
    setPassword(pw);
    try {
      sessionStorage.setItem(STORAGE_KEY_PREFIX + (shareId ?? ""), pw);
    } catch {}
  }

  useEffect(() => {
    if (needsPassword && password) {
      setPwError("Incorrect password");
      setPassword(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY_PREFIX + (shareId ?? ""));
      } catch {}
    }
  }, [needsPassword, password, shareId]);

  if (dataQ.isLoading) {
    return (
      <div className="fixed inset-0 flex h-dvh w-dvw items-center justify-center overflow-hidden bg-black">
        <Spinner className="h-8 w-8 text-white/70" />
      </div>
    );
  }

  if (needsPassword) {
    return (
      <AccessPasswordPrompt
        onSubmit={onSubmitPassword}
        error={pwError}
        title={t("embedRoute.passwordRequired")}
      />
    );
  }

  if (!recording) {
    return (
      <div className="fixed inset-0 flex h-dvh w-dvw items-center justify-center overflow-hidden bg-black text-white">
        <p className="text-sm">{t("embedRoute.unavailable")}</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 h-dvh w-dvw overflow-hidden bg-black">
      <VideoPlayer
        ref={playerRef}
        onVideoElementChange={setTrackedVideoEl}
        recordingId={recording.id}
        videoUrl={recording.videoUrl}
        mediaVersion={
          recording.mediaUpdatedAt ?? recording.videoSizeBytes ?? null
        }
        videoFormat={recording.videoFormat}
        embedProvider={isLoomEmbedBacked ? "loom" : null}
        durationMs={recording.durationMs}
        persistPlaybackPosition={false}
        editsJson={recording.editsJson}
        thumbnailUrl={recording.thumbnailUrl}
        defaultSpeed={parsePlaybackSpeed(recording.defaultSpeed) ?? 1.2}
        autoPlay={autoplay}
        startMs={resolveStartMs(startMs, recording.durationMs)}
        comments={comments}
        chapters={chapters}
        transcriptSegments={transcriptSegments}
        cta={firstCta}
        hideChrome={hideControls}
        hideCaptions={hideCaptions}
        onCtaClick={() => tracking.reportCtaClick()}
        alwaysShowControls={false}
        className="h-full w-full rounded-none"
      />
    </div>
  );
}
