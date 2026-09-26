import { appBasePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { DefaultSpinner } from "@agent-native/core/client/ui";
import { getConfiguredAppBasePath } from "@agent-native/core/server";
import { isImageRecording } from "@shared/recording-kind";
import { useQuery } from "@tanstack/react-query";
import { and, eq, isNull } from "drizzle-orm";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useParams, useSearchParams } from "react-router";

import { AccessPasswordPrompt } from "@/components/player/access-password-prompt";
import { ClipAgentWebMcp } from "@/components/player/clip-agent-webmcp";
import { ScreenshotStage } from "@/components/player/screenshot-stage";
import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/player/video-player";
import { useViewTracking } from "@/hooks/use-view-tracking";
import { withMediaVersion } from "@/lib/media-url";
import { parsePlaybackSpeed } from "@/lib/playback-speed";
import { parseTimeParam, resolveStartMs } from "@/lib/time-param";

import { getDb, schema } from "../../server/db";
import { isRecordingExpired } from "../../server/lib/recording-page-access";
import { isLoomEmbedBackedRecording } from "../../shared/loom";
import {
  buildClipsShareMeta,
  clipsSharePageTitle,
  type ClipsShareMetaRecording,
} from "../../shared/share-meta";

type EmbedMetaLoaderData = {
  recording: ClipsShareMetaRecording | null;
  origin: string;
  basePath: string;
  shareUrl: string;
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const basePath = getConfiguredAppBasePath();
  const [row] = params.shareId
    ? await getDb()
        .select({
          id: schema.recordings.id,
          title: schema.recordings.title,
          description: schema.recordings.description,
          thumbnailUrl: schema.recordings.thumbnailUrl,
          animatedThumbnailUrl: schema.recordings.animatedThumbnailUrl,
          visibility: schema.recordings.visibility,
          status: schema.recordings.status,
          updatedAt: schema.recordings.updatedAt,
          sourceAppName: schema.recordings.sourceAppName,
          videoUrl: schema.recordings.videoUrl,
          expiresAt: schema.recordings.expiresAt,
        })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, params.shareId),
            eq(schema.recordings.visibility, "public"),
            isNull(schema.recordings.password),
            isNull(schema.recordings.archivedAt),
            isNull(schema.recordings.trashedAt),
          ),
        )
        .limit(1)
    : [];
  const recording =
    row && !isRecordingExpired(row.expiresAt)
      ? {
          id: row.id,
          title: row.title,
          description: row.description,
          thumbnailUrl: row.thumbnailUrl,
          animatedThumbnailUrl: row.animatedThumbnailUrl,
          visibility: "public" as const,
          status: row.status,
          updatedAt: row.updatedAt,
          hasPassword: false,
          archivedAt: null,
          trashedAt: null,
          isLoomEmbedBacked: isLoomEmbedBackedRecording(row),
        }
      : null;

  return {
    recording,
    origin: url.origin,
    basePath,
    shareUrl: `${url.origin}${url.pathname}`,
  } satisfies EmbedMetaLoaderData;
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) =>
  buildClipsShareMeta({
    recording: loaderData?.recording ?? null,
    origin: loaderData?.origin ?? null,
    basePath: loaderData?.basePath ?? "",
    shareUrl: loaderData?.shareUrl ?? null,
  });

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
      // A screenshot never gets a video file; waiting for one polls forever.
      const recHasMedia = isImageRecording(rec)
        ? Boolean(rec.imageUrl || rec.thumbnailUrl)
        : Boolean(rec.videoUrl);
      if (rec.status !== "ready" || !recHasMedia) {
        readyMediaPollRef.current = null;
        return 2000;
      }
      // Nothing else about a finished screenshot changes on its own; the
      // settle poll below is for a video's repaired file.
      if (isImageRecording(rec)) return false;
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
      // guard:allow-raw-color — standalone embeds must match the black player backdrop
      <div className="fixed inset-0 flex h-dvh w-dvw items-center justify-center overflow-hidden bg-black text-background/70 dark:text-foreground/70">
        <DefaultSpinner height="100%" />
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

  if (isImageRecording(recording)) {
    return (
      // guard:allow-raw-color — standalone embeds match the black player backdrop
      <div className="fixed inset-0 flex h-dvh w-dvw items-center justify-center overflow-hidden bg-black">
        <ClipAgentWebMcp
          recordingId={recording.id}
          agentContextUrl={
            typeof dataQ.data?.data?.agentContextUrl === "string"
              ? dataQ.data.data.agentContextUrl
              : null
          }
          recordingStatus={recording.status}
          frameAvailable
        />
        {/* Through the same gated route as the share page, so the password
            and expiry cover the picture, not just this page. */}
        <ScreenshotStage
          src={withMediaVersion(
            recording.imageUrl ?? recording.thumbnailUrl ?? "",
            recording.mediaUpdatedAt ?? null,
          )}
          alt={recording.title}
          width={recording.width}
          height={recording.height}
          className="max-h-full w-full"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 h-dvh w-dvw overflow-hidden bg-black">
      <ClipAgentWebMcp
        recordingId={recording.id}
        agentContextUrl={
          typeof dataQ.data?.data?.agentContextUrl === "string"
            ? dataQ.data.data.agentContextUrl
            : null
        }
        recordingStatus={recording.status}
        frameAvailable={!isLoomEmbedBacked}
      />
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
