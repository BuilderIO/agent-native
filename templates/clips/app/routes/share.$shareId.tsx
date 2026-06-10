import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconDownload,
  IconExternalLink,
  IconLogin2,
  IconShare3,
} from "@tabler/icons-react";
import { eq } from "drizzle-orm";
import {
  agentNativePath,
  appBasePath,
  appPath,
  PoweredByBadge,
  useSession,
} from "@agent-native/core/client";
import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/player/video-player";
import { TranscriptPanel } from "@/components/player/transcript-panel";
import { CommentsPanel } from "@/components/player/comments-panel";
import { ReactionsTray } from "@/components/player/reactions-tray";
import { AccessPasswordPrompt } from "@/components/player/access-password-prompt";
import { SignInPromptDialog } from "@/components/player/sign-in-prompt-dialog";
import { StorageSetupCard } from "@/components/recorder/storage-setup-card";
import { ShareRecordingPopover } from "@/components/player/share-dialog";
import { DeleteRecordingMenu } from "@/components/player/delete-recording-menu";
import { usePlayerShortcuts } from "@/hooks/use-player-shortcuts";
import { useViewTracking } from "@/hooks/use-view-tracking";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { isDefaultTitle } from "@/hooks/use-auto-title";
import { getDb, schema } from "../../server/db";
import { getRequestUserEmail } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { parsePlaybackSpeed } from "@/lib/playback-speed";
import { isStorageSetupFailureReason } from "@/lib/storage-failures";

type SharePageMetaRecording = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  animatedThumbnailUrl: string | null;
  visibility: "private" | "org" | "public";
  status: "uploading" | "processing" | "ready" | "failed";
};

const CLIPS_DEFAULT_TITLE = "Untitled recording";

function hasGeneratedTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  return Boolean(trimmed && trimmed !== CLIPS_DEFAULT_TITLE);
}

function pageTitle(title: string | null | undefined): string {
  return hasGeneratedTitle(title)
    ? `${title!.trim()} · Clips`
    : "Clip recording · Clips";
}

function displayRecordingTitle(title: string | null | undefined): string {
  return hasGeneratedTitle(title) ? (title ?? "").trim() : "Untitled Clip";
}

function failureDetail(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return trimmed.length > 800 ? `${trimmed.slice(0, 800)}...` : trimmed;
}

function buildSignInHref(returnTo: string): string {
  return agentNativePath(
    `/_agent-native/sign-in?return=${encodeURIComponent(returnTo)}`,
  );
}

function shouldShowGeneratedTitleSkeleton(
  recording: { title: string | null | undefined; createdAt?: string | null },
  transcriptStatus?: string,
): boolean {
  if (!isDefaultTitle(recording.title)) return false;
  if (transcriptStatus === "failed") return false;

  const createdAtMs = Date.parse(recording.createdAt ?? "");
  if (
    Number.isFinite(createdAtMs) &&
    Date.now() - createdAtMs > 2 * 60 * 1000 &&
    transcriptStatus !== "pending"
  ) {
    return false;
  }

  return true;
}

function metaDescription(recording: SharePageMetaRecording | null): string {
  const description = recording?.description?.trim();
  if (description) return description.slice(0, 160);
  if (hasGeneratedTitle(recording?.title)) {
    return `Watch "${recording!.title.trim()}" on Clips.`;
  }
  return "Watch this screen recording on Clips.";
}

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params.shareId;
  if (!id) return { recording: null };

  const [rec] = await getDb()
    .select({
      id: schema.recordings.id,
      title: schema.recordings.title,
      description: schema.recordings.description,
      thumbnailUrl: schema.recordings.thumbnailUrl,
      animatedThumbnailUrl: schema.recordings.animatedThumbnailUrl,
      visibility: schema.recordings.visibility,
      status: schema.recordings.status,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, id))
    .limit(1);

  if (!rec) return { recording: null };

  if (rec.visibility !== "public") {
    const userEmail = getRequestUserEmail();
    const access = userEmail ? await resolveAccess("recording", id) : null;
    if (!access) return { recording: null };
  }

  const recording: SharePageMetaRecording = rec;
  return { recording };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const recording = data?.recording ?? null;
  const title = pageTitle(recording?.title);
  const description = metaDescription(recording);
  const image =
    recording?.animatedThumbnailUrl || recording?.thumbnailUrl || undefined;

  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "video.other" },
    ...(image ? [{ property: "og:image", content: image }] : []),
    {
      name: "twitter:card",
      content: image ? "summary_large_image" : "summary",
    },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
};

const STORAGE_KEY_PREFIX = "clips-share-pw-";

export default function ShareRoute() {
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [password, setPassword] = useState<string | null>(() => {
    if (typeof window === "undefined" || !shareId) return null;
    try {
      return sessionStorage.getItem(STORAGE_KEY_PREFIX + shareId);
    } catch {
      return null;
    }
  });
  const [pwError, setPwError] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const { session, isLoading: sessionLoading } = useSession();
  const [signInIntent, setSignInIntent] = useState<"comment" | "react" | null>(
    null,
  );
  const [processingTimeout, setProcessingTimeout] = useState(false);
  const requireSignIn = useCallback(
    (intent: "comment" | "react") => setSignInIntent(intent),
    [],
  );
  const [downloading, setDownloading] = useState(false);

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
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });

  const recording = dataQ.data?.data?.recording;
  const comments = dataQ.data?.data?.comments ?? [];
  const reactions = dataQ.data?.data?.reactions ?? [];
  const chapters = dataQ.data?.data?.chapters ?? [];
  const transcriptSegments = dataQ.data?.data?.transcript?.segments ?? [];
  const transcriptFullText = dataQ.data?.data?.transcript?.fullText ?? null;
  const transcriptStatus = dataQ.data?.data?.transcript?.status;
  const transcriptFailureReason =
    dataQ.data?.data?.transcript?.failureReason ?? null;
  const ctas = dataQ.data?.data?.ctas ?? [];
  const firstCta = ctas[0] ?? null;
  const viewerCanEdit = Boolean(dataQ.data?.data?.viewer?.canEdit);
  const viewerIsOwner = Boolean(dataQ.data?.data?.viewer?.isOwner);
  const showTitleSkeleton = recording
    ? shouldShowGeneratedTitleSkeleton(recording, transcriptStatus)
    : false;
  const visibleTitle = recording
    ? displayRecordingTitle(recording.title)
    : "Untitled Clip";

  useEffect(() => {
    if (!recording) return;
    document.title = pageTitle(recording.title);
  }, [recording?.title]);

  useEffect(() => {
    if (!recording) {
      setProcessingTimeout(false);
      return;
    }
    if (recording.status === "ready" && recording.videoUrl) {
      setProcessingTimeout(false);
      return;
    }
    if (recording.status === "failed") {
      setProcessingTimeout(false);
      return;
    }

    const progress = Number(recording.uploadProgress ?? 0);
    const timeoutMs =
      recording.status === "processing" || progress >= 95 ? 12_000 : 30_000;
    const handle = setTimeout(() => setProcessingTimeout(true), timeoutMs);
    return () => clearTimeout(handle);
  }, [
    recording?.id,
    recording?.status,
    recording?.videoUrl,
    recording?.uploadProgress,
  ]);

  usePlayerShortcuts({ playerRef });

  const tracking = useViewTracking({
    recordingId: shareId ?? "",
    videoRef: {
      get current() {
        return playerRef.current?.video ?? null;
      },
    } as any,
    durationMs: recording?.durationMs ?? 0,
  });

  // If the backend returned 401 with passwordRequired, prompt.
  const needsPassword =
    dataQ.data?.status === 401 && dataQ.data.data?.passwordRequired;

  useEffect(() => {
    if (!needsPassword) return;
    if (password) {
      // Wrong password entered → clear and show error.
      setPwError("Incorrect password");
      setPassword(null);
      try {
        sessionStorage.removeItem(STORAGE_KEY_PREFIX + shareId);
      } catch {}
    }
  }, [needsPassword, password, shareId]);

  function onSubmitPassword(pw: string) {
    setPwError(null);
    setPassword(pw);
    try {
      sessionStorage.setItem(STORAGE_KEY_PREFIX + (shareId ?? ""), pw);
    } catch {}
  }

  async function downloadRecording() {
    if (!recording?.videoUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(recording.videoUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(recording.title || "clip")}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(recording.videoUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  if (dataQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-background">
        <Spinner className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (needsPassword) {
    return (
      <AccessPasswordPrompt
        onSubmit={onSubmitPassword}
        error={pwError}
        title="This clip is password-protected"
      />
    );
  }

  if (dataQ.data?.status === 410) {
    return (
      <EndState
        title="Link expired"
        message="The creator set an expiry on this share link."
      />
    );
  }

  if (dataQ.data?.status === 401 || dataQ.data?.status === 404) {
    return (
      <EndState
        title="Clip unavailable"
        message="This recording isn't public, or the link is invalid. If it's your clip, sign in to check access."
        action={
          shareId ? (
            <Button asChild size="sm">
              <a href={buildSignInHref(`/r/${shareId}`)} className="gap-1.5">
                <IconLogin2 className="h-4 w-4" />
                Sign in
              </a>
            </Button>
          ) : null
        }
      />
    );
  }

  if (!recording) {
    return (
      <EndState
        title="Something went wrong"
        message={dataQ.data?.data?.error ?? "Please try again."}
      />
    );
  }

  if (recording.status !== "ready" || !recording.videoUrl) {
    const progress = Number(recording.uploadProgress ?? 0);
    const explicitFailure = recording.status === "failed";
    const rawFailureReason =
      ((recording as any).failureReason as string | null | undefined) ?? null;
    const storageSetupFailure = isStorageSetupFailureReason(rawFailureReason);
    const stuckFailure = !explicitFailure && processingTimeout;
    const isFailure = explicitFailure || storageSetupFailure || stuckFailure;
    const canManageStorage = viewerCanEdit;
    const signInHref = buildSignInHref(`/r/${recording.id}`);
    const detail = failureDetail(rawFailureReason);
    const label = storageSetupFailure
      ? "Connect storage to finish this clip."
      : stuckFailure
        ? "This clip needs attention to finish."
        : explicitFailure
          ? "Something went wrong while saving this clip."
          : "Finishing up this clip...";
    const message = storageSetupFailure
      ? canManageStorage
        ? "The video is preserved. Connect Builder.io or S3 storage and Clips will finish uploading it."
        : session
          ? "The creator needs to connect Builder.io or S3 storage before this clip can finish."
          : "If this is your clip, sign in here to connect Builder.io or S3 storage and finish the upload."
      : stuckFailure
        ? session
          ? "The upload has not completed yet. Open the dashboard for this clip or ask the creator to check storage."
          : "The upload has not completed yet. If this is your clip, sign in to open the owner controls and check storage."
        : explicitFailure
          ? (rawFailureReason ?? "The creator may need to retry.")
          : "Uploading and assembling the video. This page will update automatically.";

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-6">
        {!isFailure ? (
          <Spinner className="h-8 w-8 mb-4 text-muted-foreground" />
        ) : (
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
            <IconAlertTriangle className="h-5 w-5" />
          </div>
        )}
        <h1 className="mb-1 text-center text-lg font-semibold">{label}</h1>
        <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
          {message}
        </p>
        {isFailure && detail && canManageStorage ? (
          <div className="mb-4 w-full max-w-xl rounded-md border border-border bg-card p-4 text-left shadow-sm">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Details
            </div>
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
              {detail}
            </pre>
          </div>
        ) : null}
        {!isFailure && progress > 0 ? (
          <div className="w-64 h-1.5 rounded-full bg-accent overflow-hidden mb-4">
            <div
              className="h-full bg-foreground"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        ) : null}
        {storageSetupFailure && canManageStorage ? (
          <div className="mb-4 w-full">
            <StorageSetupCard
              title="Connect storage to finish saving"
              description="Choose where Clips should store videos. After it connects, this page will check again."
              connectedDescription="Storage connected. Checking this clip..."
              onConfigured={() => {
                void dataQ.refetch();
              }}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {!session && isFailure ? (
            <Button asChild size="sm">
              <a href={signInHref} className="gap-1.5">
                <IconLogin2 className="h-4 w-4" />
                Sign in to finish
              </a>
            </Button>
          ) : !session && !sessionLoading && !isFailure ? (
            <Button asChild variant="ghost" size="sm">
              <a href={signInHref} className="gap-1.5">
                <IconLogin2 className="h-4 w-4" />
                Sign in if this is yours
              </a>
            </Button>
          ) : canManageStorage && isFailure ? (
            <Button asChild size="sm">
              <a href={appPath(`/r/${recording.id}`)}>Open dashboard</a>
            </Button>
          ) : null}
          <Button
            onClick={() => {
              setProcessingTimeout(false);
              void dataQ.refetch();
            }}
            variant="outline"
            size="sm"
            className="border-foreground/20 bg-muted/50 hover:bg-accent text-foreground"
          >
            Check again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:h-screen lg:flex-row lg:overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 lg:flex-nowrap">
          <div className="min-w-0 flex-1">
            {showTitleSkeleton ? (
              <Skeleton
                aria-label="Generating title"
                className="h-4 w-56 max-w-full"
              />
            ) : (
              <h1 className="truncate text-sm font-medium">{visibleTitle}</h1>
            )}
            <p className="truncate text-xs text-muted-foreground">
              Shared with Clips
              {recording.visibility !== "private" ? (
                <> · {capitalize(recording.visibility)}</>
              ) : null}
            </p>
          </div>

          <div className="flex w-full min-w-0 items-center justify-between gap-2 sm:w-auto sm:justify-end">
            {viewerCanEdit ? (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={appPath(`/r/${recording.id}`)}
                  className="min-w-0 gap-1.5"
                >
                  <span className="truncate">Open dashboard</span>
                  <IconExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              </Button>
            ) : (
              <Button variant="ghost" size="sm" asChild>
                <a href={appPath("/")} className="gap-1.5">
                  Try Clips
                  <IconExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
            {viewerIsOwner ? (
              <DeleteRecordingMenu
                recordingId={recording.id}
                onDeleted={() => navigate("/library", { replace: true })}
              />
            ) : null}
            {viewerCanEdit ? (
              <ShareRecordingPopover
                recordingId={recording.id}
                recordingTitle={recording.title}
                videoUrl={recording.videoUrl}
                animatedThumbnailUrl={recording.animatedThumbnailUrl}
              >
                <Button size="sm" className="shrink-0 gap-1.5">
                  <IconShare3 className="h-4 w-4" />
                  Share
                </Button>
              </ShareRecordingPopover>
            ) : null}
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-visible p-4 lg:min-h-0 lg:overflow-hidden">
          <div className="min-h-[240px] flex-1 lg:min-h-0">
            <VideoPlayer
              ref={playerRef}
              recordingId={recording.id}
              videoUrl={recording.videoUrl}
              durationMs={recording.durationMs}
              editsJson={recording.editsJson}
              thumbnailUrl={recording.thumbnailUrl}
              role={viewerCanEdit ? "owner" : "viewer"}
              defaultSpeed={parsePlaybackSpeed(recording.defaultSpeed) ?? 1.2}
              comments={comments}
              chapters={chapters}
              reactions={reactions}
              transcriptSegments={transcriptSegments}
              cta={firstCta}
              onCtaClick={() => tracking.reportCtaClick()}
              onTimeUpdate={(ms) => setCurrentMs(ms)}
              className="h-full w-full"
            />
          </div>

          <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              {showTitleSkeleton ? (
                <Skeleton
                  aria-label="Generating title"
                  className="h-5 w-72 max-w-full"
                />
              ) : (
                <h2 className="break-words text-base font-semibold leading-tight">
                  {visibleTitle}
                </h2>
              )}
              {recording.description ? (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {recording.description}
                </p>
              ) : null}
            </div>
            <div className="flex max-w-full flex-col items-stretch gap-2 sm:items-end">
              {recording.enableReactions ? (
                <ReactionsTray
                  onReact={(emoji) => {
                    if (!session) {
                      requireSignIn("react");
                      return;
                    }
                    tracking.reportReaction(emoji);
                    const liveCt = playerRef.current?.video?.currentTime;
                    const liveMs =
                      typeof liveCt === "number" &&
                      Number.isFinite(liveCt) &&
                      liveCt >= 0 &&
                      liveCt < 1e7
                        ? Math.floor(liveCt * 1000)
                        : currentMs;
                    fetch(
                      agentNativePath(
                        "/_agent-native/actions/react-to-recording",
                      ),
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          recordingId: recording.id,
                          emoji,
                          videoTimestampMs: liveMs,
                        }),
                      },
                    )
                      .then(() => dataQ.refetch())
                      .catch(() => {});
                  }}
                />
              ) : null}
              {recording.enableDownloads && recording.videoUrl ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadRecording}
                  disabled={downloading}
                  className="gap-1.5"
                >
                  <IconDownload className="h-4 w-4" />
                  {downloading ? "Downloading..." : "Download MP4"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <aside className="flex min-h-[420px] w-full shrink-0 flex-col border-t border-border bg-background lg:min-h-0 lg:w-[380px] lg:border-l lg:border-t-0">
        <Tabs defaultValue="transcript" className="flex h-full flex-col">
          <TabsList
            className={`mx-3 mt-3 grid w-auto ${
              recording.enableComments ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            <TabsTrigger value="transcript" className="text-xs">
              Transcript
            </TabsTrigger>
            {recording.enableComments ? (
              <TabsTrigger value="comments" className="text-xs gap-1">
                Comments
                {comments.length > 0 ? (
                  <span className="ml-0.5 rounded-full bg-accent px-1.5 text-[10px] tabular-nums">
                    {comments.length}
                  </span>
                ) : null}
              </TabsTrigger>
            ) : null}
          </TabsList>
          <TabsContent
            value="transcript"
            className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <TranscriptPanel
              segments={transcriptSegments}
              fullText={transcriptFullText}
              durationMs={recording.durationMs}
              currentMs={currentMs}
              onSeek={(ms) => playerRef.current?.seek(ms)}
              status={transcriptStatus}
              failureReason={transcriptFailureReason}
              recordingTitle={recording.title}
            />
          </TabsContent>
          {recording.enableComments ? (
            <TabsContent
              value="comments"
              className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden"
            >
              <CommentsPanel
                recordingId={recording.id}
                comments={comments}
                currentMs={currentMs}
                currentUserEmail={session?.email}
                enableComments={recording.enableComments}
                onSeek={(ms) => playerRef.current?.seek(ms)}
                onUnauthenticated={requireSignIn}
                queryKey={["public-recording", shareId, password]}
                selectComments={(d: any) => d?.data?.comments}
                applyComments={(d: any, next) =>
                  d ? { ...d, data: { ...(d.data ?? {}), comments: next } } : d
                }
              />
            </TabsContent>
          ) : null}
        </Tabs>

        <div className="flex justify-center border-t border-border p-3">
          <PoweredByBadge />
        </div>
      </aside>

      <SignInPromptDialog
        open={signInIntent !== null}
        onOpenChange={(open) => {
          if (!open) setSignInIntent(null);
        }}
        intent={signInIntent ?? "comment"}
      />
    </div>
  );
}

function sanitizeFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "clip"
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function EndState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-6">
      <h1 className="text-2xl font-semibold mb-2">{title}</h1>
      <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
        {message}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {action}
        <Button asChild variant="ghost" size="sm">
          <a href={appPath("/")}>Go home</a>
        </Button>
      </div>
    </div>
  );
}
