import { appBasePath, useT } from "@agent-native/core/client";
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

import { isLoomEmbedBackedRecording } from "../../shared/loom";

export function meta() {
  return [{ title: "Clip" }];
}

const STORAGE_KEY_PREFIX = "clips-share-pw-";

/**
 * Parse `t` URL param into ms (supports plain seconds or `1m20s` / `1h2m3s`).
 *   "80"      → 80_000
 *   "1m20s"   → 80_000
 *   "1h2m3s"  → 3_723_000
 *   "1:20"    → 80_000  (MM:SS)
 */
function parseTimeParam(raw: string | null): number {
  if (!raw) return 0;
  const v = raw.trim();
  if (!v) return 0;

  // Plain seconds
  if (/^\d+(\.\d+)?$/.test(v)) return Math.floor(parseFloat(v) * 1000);

  // MM:SS or HH:MM:SS
  if (/^\d+:\d+(:\d+)?$/.test(v)) {
    const parts = v.split(":").map((n) => parseInt(n, 10));
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
    if (parts.length === 3)
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }

  // 1h2m3s style
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (m) {
    const h = parseInt(m[1] ?? "0", 10);
    const mm = parseInt(m[2] ?? "0", 10);
    const s = parseInt(m[3] ?? "0", 10);
    return (h * 3600 + mm * 60 + s) * 1000;
  }
  return 0;
}

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

  const [password, setPassword] = useState<string | null>(() => {
    if (typeof window === "undefined" || !shareId) return null;
    try {
      return sessionStorage.getItem(STORAGE_KEY_PREFIX + shareId);
    } catch {
      return null;
    }
  });
  const [pwError, setPwError] = useState<string | null>(null);

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
  });

  const recording = dataQ.data?.data?.recording;
  const transcriptSegments = dataQ.data?.data?.transcript?.segments ?? [];
  const chapters = dataQ.data?.data?.chapters ?? [];
  const ctas = dataQ.data?.data?.ctas ?? [];
  const firstCta = ctas[0] ?? null;
  const isLoomEmbedBacked = isLoomEmbedBackedRecording(recording);

  const tracking = useViewTracking({
    recordingId: shareId ?? "",
    videoRef: {
      get current() {
        return playerRef.current?.video ?? null;
      },
    } as any,
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
        recordingId={recording.id}
        videoUrl={recording.videoUrl}
        embedProvider={isLoomEmbedBacked ? "loom" : null}
        durationMs={recording.durationMs}
        editsJson={recording.editsJson}
        thumbnailUrl={recording.thumbnailUrl}
        defaultSpeed={parsePlaybackSpeed(recording.defaultSpeed) ?? 1.2}
        autoPlay={autoplay}
        startMs={startMs}
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
