import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconDownload,
  IconDots,
  IconExternalLink,
  IconLogin2,
  IconShare3,
} from "@tabler/icons-react";
import { eq } from "drizzle-orm";
import {
  agentNativePath,
  appBasePath,
  appPath,
  useSession,
  AgentPanel,
  getBrowserTabId,
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
import { CaptureInstallButton } from "@/components/capture-install-options";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { isDefaultTitle } from "@/hooks/use-auto-title";
import { getDb, schema } from "../../server/db";
import {
  getRequestUserEmail,
  signShortLivedToken,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { parsePlaybackSpeed } from "@/lib/playback-speed";
import { isStorageSetupFailureReason } from "@/lib/storage-failures";
import { buildAgentApiUrls, safeJsonForHtml } from "../../shared/agent-context";
import {
  isLoomEmbedBackedRecording,
  isLoomRecordingSource,
} from "../../shared/loom";
import {
  buildClipsShareMeta,
  clipsSharePageTitle,
  displayRecordingTitle,
} from "../../shared/share-meta";

type SharePageMetaRecording = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  animatedThumbnailUrl: string | null;
  visibility: "private" | "org" | "public";
  status: "uploading" | "processing" | "ready" | "failed";
  archivedAt: string | null;
  trashedAt: string | null;
};

type SharePageLoaderData = {
  recording: SharePageMetaRecording | null;
  agentContextUrl: string | null;
  origin: string | null;
  shareUrl: string | null;
};

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

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = params.shareId;
  const requestUrl = new URL(request.url);
  if (!id)
    return {
      recording: null,
      agentContextUrl: null,
      origin: requestUrl.origin,
      shareUrl: null,
    };

  const [rec] = await getDb()
    .select({
      id: schema.recordings.id,
      title: schema.recordings.title,
      description: schema.recordings.description,
      thumbnailUrl: schema.recordings.thumbnailUrl,
      animatedThumbnailUrl: schema.recordings.animatedThumbnailUrl,
      visibility: schema.recordings.visibility,
      status: schema.recordings.status,
      ownerEmail: schema.recordings.ownerEmail,
      password: schema.recordings.password,
      archivedAt: schema.recordings.archivedAt,
      trashedAt: schema.recordings.trashedAt,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, id))
    .limit(1);

  if (!rec)
    return {
      recording: null,
      agentContextUrl: null,
      origin: requestUrl.origin,
      shareUrl: null,
    };

  if (rec.visibility !== "public") {
    const userEmail = getRequestUserEmail();
    const access = userEmail ? await resolveAccess("recording", id) : null;
    if (!access)
      return {
        recording: null,
        agentContextUrl: null,
        origin: requestUrl.origin,
        shareUrl: null,
      };
  }

  const recording: SharePageMetaRecording = {
    id: rec.id,
    title: rec.title,
    description: rec.description,
    thumbnailUrl: rec.thumbnailUrl,
    animatedThumbnailUrl: rec.animatedThumbnailUrl,
    visibility: rec.visibility,
    status: rec.status,
    archivedAt: rec.archivedAt,
    trashedAt: rec.trashedAt,
  };
  const canExposeAgentContext =
    rec.visibility === "public" && !rec.archivedAt && !rec.trashedAt;
  const token =
    canExposeAgentContext &&
    rec.password &&
    getRequestUserEmail() === rec.ownerEmail
      ? signShortLivedToken({ resourceId: id })
      : undefined;
  const canExposeAnonymousAgentContext = canExposeAgentContext && !rec.password;
  const canExposeOwnerAgentContext = canExposeAgentContext && Boolean(token);
  return {
    recording,
    origin: requestUrl.origin,
    shareUrl: `${requestUrl.origin}${requestUrl.pathname}`,
    agentContextUrl:
      canExposeAnonymousAgentContext || canExposeOwnerAgentContext
        ? buildAgentApiUrls(id, {
            origin: requestUrl.origin,
            basePath:
              process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "",
            token,
          }).contextUrl
        : null,
  };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return buildClipsShareMeta({
    recording: data?.recording ?? null,
    origin: data?.origin ?? null,
    shareUrl: data?.shareUrl ?? null,
  });
};

const STORAGE_KEY_PREFIX = "clips-share-pw-";
const CLIPS_SOURCE_URL =
  "https://github.com/BuilderIO/agent-native/tree/main/templates/clips";
const CLIPS_TEMPLATE_URL = "https://www.agent-native.com/templates/clips";
const CLIPS_AGENT_DOCS_URL =
  "https://www.agent-native.com/docs/template-clips#agent-readable-clips";

type ViewerPlatform = "mac" | "windows";

function detectViewerPlatform(): ViewerPlatform | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "mac";
  return null;
}

function AgentDiscovery({
  recording,
  agentContextUrl,
}: {
  recording: Pick<SharePageMetaRecording, "id" | "title"> | null;
  agentContextUrl: string | null;
}) {
  if (!recording || !agentContextUrl) return null;

  const payload = {
    type: "agent-native.clip.discovery",
    clipId: recording.id,
    title: recording.title,
    agentContextUrl,
    instructions:
      "Fetch agentContextUrl for timestamped transcript segments and frame API links.",
  };

  return (
    <>
      <a
        href={agentContextUrl}
        rel="alternate"
        type="application/json"
        className="sr-only"
        data-agent-context-url={agentContextUrl}
      >
        Agent-readable clip context
      </a>
      <script
        type="application/json"
        id="clips-agent-context"
        dangerouslySetInnerHTML={{ __html: safeJsonForHtml(payload) }}
      />
    </>
  );
}

export default function ShareRoute() {
  const loaderData = useLoaderData<typeof loader>() as SharePageLoaderData;
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
  const isLoomEmbedBacked = isLoomEmbedBackedRecording(recording);
  const unlockedAgentContextUrl =
    typeof dataQ.data?.data?.agentContextUrl === "string"
      ? dataQ.data.data.agentContextUrl
      : null;
  const agentDiscovery = (
    <AgentDiscovery
      recording={recording ?? loaderData.recording}
      agentContextUrl={unlockedAgentContextUrl ?? loaderData.agentContextUrl}
    />
  );

  useEffect(() => {
    if (!recording) return;
    document.title = clipsSharePageTitle(recording.title);
  }, [recording?.title]);

  // The /share/* shell skips DbSyncSetup (and thus useNavigationState), so the
  // agent mounted in the side panel has no navigation context. Write it
  // explicitly for signed-in viewers so view-screen grounds the chat to this
  // clip instead of falling back to a generic library view.
  useEffect(() => {
    if (!session || !recording?.id) return;
    fetch(
      agentNativePath(
        `/_agent-native/application-state/navigation:${getBrowserTabId()}`,
      ),
      {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          view: "share",
          shareId: recording.id,
          recordingId: recording.id,
          path: `/share/${recording.id}`,
        }),
      },
    ).catch(() => {});
  }, [session, recording?.id]);

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
    trackOpenWithoutVideo: isLoomEmbedBacked,
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
      <>
        {agentDiscovery}
        <div className="flex items-center justify-center h-screen w-full bg-background">
          <Spinner className="h-8 w-8 text-muted-foreground" />
        </div>
      </>
    );
  }

  if (needsPassword) {
    return (
      <>
        {agentDiscovery}
        <AccessPasswordPrompt
          onSubmit={onSubmitPassword}
          error={pwError}
          title="This clip is password-protected"
        />
      </>
    );
  }

  if (dataQ.data?.status === 410) {
    return (
      <>
        {agentDiscovery}
        <EndState
          title="Link expired"
          message="The creator set an expiry on this share link."
        />
      </>
    );
  }

  if (dataQ.data?.status === 401 || dataQ.data?.status === 404) {
    return (
      <>
        {agentDiscovery}
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
      </>
    );
  }

  if (!recording) {
    return (
      <>
        {agentDiscovery}
        <EndState
          title="Something went wrong"
          message={dataQ.data?.data?.error ?? "Please try again."}
        />
      </>
    );
  }

  if (recording.status !== "ready" || !recording.videoUrl) {
    const progress = Number(recording.uploadProgress ?? 0);
    const explicitFailure = recording.status === "failed";
    const rawFailureReason =
      ((recording as any).failureReason as string | null | undefined) ?? null;
    const storageSetupFailure = isStorageSetupFailureReason(rawFailureReason);
    const loomStorageSetupFailure =
      storageSetupFailure && isLoomRecordingSource(recording);
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
        ? loomStorageSetupFailure
          ? "The Loom source link is preserved. Connect Builder.io or S3 storage, then retry the import."
          : "The video is preserved. Connect Builder.io or S3 storage and Clips will finish uploading it."
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
      <>
        {agentDiscovery}
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
      </>
    );
  }

  const canDownloadRecording = Boolean(
    recording.enableDownloads && recording.videoUrl && !isLoomEmbedBacked,
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:h-screen lg:flex-row lg:overflow-hidden">
      {agentDiscovery}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 lg:flex-nowrap">
          {session ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              aria-label="Back to home"
            >
              <IconArrowLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="min-w-0 flex-1">
            {showTitleSkeleton ? (
              <Skeleton
                aria-label="Generating title"
                className="h-4 w-56 max-w-full"
              />
            ) : (
              <h1 className="truncate text-sm font-medium">{visibleTitle}</h1>
            )}
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
            ) : session ? null : (
              <Button variant="ghost" size="sm" asChild>
                <a href={appPath("/")} className="gap-1.5">
                  Try Clips
                  <IconExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
            {!viewerCanEdit && canDownloadRecording ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 shrink-0 px-0"
                    aria-label="Clip options"
                  >
                    <IconDots className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onSelect={() => {
                      void downloadRecording();
                    }}
                    disabled={downloading}
                  >
                    <IconDownload className="h-4 w-4" />
                    {downloading ? "Downloading..." : "Download MP4"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
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
                isLoomRecording={isLoomEmbedBacked}
                hasPassword={Boolean(recording.hasPassword)}
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
              embedProvider={isLoomEmbedBacked ? "loom" : null}
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
                    const liveCt = isLoomEmbedBacked
                      ? null
                      : playerRef.current?.video?.currentTime;
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
              {viewerCanEdit && canDownloadRecording ? (
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
        <Tabs defaultValue="agent" className="flex h-full flex-col">
          <TabsList className="mx-3 mt-3 grid w-auto grid-cols-4">
            <TabsTrigger value="agent" className="text-xs">
              Agent
            </TabsTrigger>
            <TabsTrigger value="comments" className="text-xs gap-1">
              Comments
              {comments.length > 0 ? (
                <span className="ml-0.5 rounded-full bg-accent px-1.5 text-[10px] tabular-nums">
                  {comments.length}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="transcript" className="text-xs">
              Transcript
            </TabsTrigger>
            <TabsTrigger value="insights" className="text-xs">
              Insights
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="agent"
            className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            {sessionLoading ? null : session ? (
              <AgentPanel
                emptyStateText="Ask about this clip…"
                dynamicSuggestions={false}
                suggestions={[
                  "Summarize this clip",
                  "Find the key moments",
                  "List follow-up actions",
                  "Draft questions for the author",
                ]}
                browserTabId={getBrowserTabId()}
              />
            ) : (
              <PublicAgentEmptyState />
            )}
          </TabsContent>
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
              presentation="share"
            />
          </TabsContent>
          <TabsContent
            value="insights"
            className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden"
          >
            <PublicInsightsState />
          </TabsContent>
        </Tabs>
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

function PublicAgentEmptyState() {
  const [platform, setPlatform] = useState<ViewerPlatform | null>(null);

  useEffect(() => {
    setPlatform(detectViewerPlatform());
  }, []);

  const downloadLabel =
    platform === "mac"
      ? "Download for Mac"
      : platform === "windows"
        ? "Download for Windows"
        : "Download desktop app";

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <div className="mb-6 flex flex-col items-center gap-3">
        <img
          src={appPath("/agent-native-icon-light.svg")}
          alt="Agent-Native"
          className="block h-8 w-auto dark:hidden"
        />
        <img
          src={appPath("/agent-native-icon-dark.svg")}
          alt="Agent-Native"
          className="hidden h-8 w-auto dark:block"
        />
      </div>
      <p className="max-w-[280px] text-sm leading-6 text-muted-foreground">
        <a
          href={CLIPS_TEMPLATE_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          Agent-Native Clips
        </a>{" "}
        is a free,{" "}
        <a
          href={CLIPS_SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          open-source
        </a>
        ,{" "}
        <a
          href={CLIPS_AGENT_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          agent-friendly
        </a>{" "}
        Loom alternative
      </p>
      <div className="mt-7 flex w-full max-w-[220px] flex-col gap-2">
        <CaptureInstallButton className="w-full gap-2" align="center">
          <IconDownload className="h-4 w-4" />
          {downloadLabel}
        </CaptureInstallButton>
        <Button asChild variant="outline" className="w-full">
          <a href={appPath("/signup")}>Sign up</a>
        </Button>
      </div>
    </div>
  );
}

function PublicInsightsState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <p className="text-sm font-medium text-foreground">Owner insights</p>
      <p className="mt-2 max-w-[240px] text-sm leading-5 text-muted-foreground">
        Views, completion, and viewer details are visible to editors of this
        clip.
      </p>
    </div>
  );
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
