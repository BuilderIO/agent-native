import { useCallback, useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { IconExternalLink, IconShare3 } from "@tabler/icons-react";
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

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-background">
      <Spinner className="h-8 w-8 text-muted-foreground" />
    </div>
  );
}

const STORAGE_KEY_PREFIX = "clips-share-pw-";

export default function ShareRoute() {
  const { shareId } = useParams<{ shareId: string }>();
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
  const { session } = useSession();
  const [signInIntent, setSignInIntent] = useState<"comment" | "react" | null>(
    null,
  );
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
        message="This recording isn't public, or the link is invalid."
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
    const label = explicitFailure
      ? "Something went wrong while saving this clip."
      : "Finishing up this clip...";
    const message = explicitFailure
      ? ((recording as any).failureReason ?? "The creator may need to retry.")
      : "Uploading and assembling the video. This page will update automatically.";
    const storageSetupFailure =
      explicitFailure &&
      /file upload provider|storage provider|connect builder|s3-compatible/i.test(
        message,
      );

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-6">
        {!explicitFailure ? (
          <Spinner className="h-8 w-8 mb-4 text-muted-foreground" />
        ) : null}
        <h1 className="text-lg font-semibold mb-1">{label}</h1>
        <p className="text-sm text-muted-foreground mb-4 max-w-md text-center">
          {message}
        </p>
        {!explicitFailure && progress > 0 ? (
          <div className="w-64 h-1.5 rounded-full bg-accent overflow-hidden mb-4">
            <div
              className="h-full bg-foreground"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        ) : null}
        {storageSetupFailure ? (
          <div className="mb-4 w-full">
            <StorageSetupCard
              title="Connect storage to finish saving"
              description="If this is your clip, connect Builder.io here and this page will check again."
              onConfigured={() => {
                void dataQ.refetch();
              }}
            />
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            onClick={() => dataQ.refetch()}
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img
            src={appPath("/agent-native-icon-light.svg")}
            alt=""
            aria-hidden="true"
            className="block h-4 w-auto dark:hidden"
          />
          <img
            src={appPath("/agent-native-icon-dark.svg")}
            alt=""
            aria-hidden="true"
            className="hidden h-4 w-auto dark:block"
          />
          <span className="font-medium">Clips</span>
        </div>
        <div className="flex items-center gap-2">
          {viewerCanEdit ? (
            <Button variant="ghost" size="sm" asChild>
              <a href={appPath(`/r/${recording.id}`)} className="gap-1.5">
                Open dashboard <IconExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : (
            <a
              href={appPath("/")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              Try Clips <IconExternalLink className="h-3 w-3" />
            </a>
          )}
          {viewerCanEdit ? (
            <ShareRecordingPopover
              recordingId={recording.id}
              recordingTitle={recording.title}
              videoUrl={recording.videoUrl}
              animatedThumbnailUrl={recording.animatedThumbnailUrl}
            >
              <Button size="sm" className="gap-1.5">
                <IconShare3 className="h-4 w-4" />
                Share
              </Button>
            </ShareRecordingPopover>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-8 grid grid-cols-[1fr_360px] gap-6">
        <div className="min-w-0 space-y-4">
          <div className="aspect-video rounded-xl overflow-hidden bg-black">
            <VideoPlayer
              ref={playerRef}
              recordingId={recording.id}
              videoUrl={recording.videoUrl}
              durationMs={recording.durationMs}
              editsJson={recording.editsJson}
              thumbnailUrl={recording.thumbnailUrl}
              defaultSpeed={parsePlaybackSpeed(recording.defaultSpeed) ?? 1.2}
              comments={comments}
              chapters={chapters}
              reactions={reactions}
              transcriptSegments={transcriptSegments}
              cta={firstCta}
              onCtaClick={() => tracking.reportCtaClick()}
              onTimeUpdate={(ms) => setCurrentMs(ms)}
              className="w-full h-full"
            />
          </div>

          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {showTitleSkeleton ? (
                <Skeleton
                  aria-label="Generating title"
                  className="h-7 w-80 max-w-full"
                />
              ) : (
                <h1 className="text-xl font-semibold">{visibleTitle}</h1>
              )}
              {recording.description ? (
                <p className="text-sm text-foreground/70 mt-1 whitespace-pre-wrap">
                  {recording.description}
                </p>
              ) : null}
            </div>
            {recording.enableReactions ? (
              <ReactionsTray
                onReact={(emoji) => {
                  if (!session) {
                    requireSignIn("react");
                    return;
                  }
                  tracking.reportReaction(emoji);
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
                        videoTimestampMs: currentMs,
                      }),
                    },
                  )
                    .then(() => dataQ.refetch())
                    .catch(() => {});
                }}
              />
            ) : null}
          </div>

          {recording.enableDownloads && recording.videoUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={downloadRecording}
              disabled={downloading}
              className="border-foreground/20 bg-muted/50 hover:bg-accent text-foreground"
            >
              {downloading ? "Downloading..." : "Download MP4"}
            </Button>
          ) : null}
        </div>

        <aside className="min-w-0">
          <Tabs defaultValue="transcript" className="flex flex-col">
            <TabsList className="w-full bg-muted/50">
              <TabsTrigger value="transcript" className="flex-1">
                Transcript
              </TabsTrigger>
              {recording.enableComments ? (
                <TabsTrigger value="comments" className="flex-1">
                  Comments
                </TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent value="transcript" className="mt-3">
              <div className="rounded-lg border border-border bg-muted/50 h-[600px] overflow-hidden">
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
              </div>
            </TabsContent>
            {recording.enableComments ? (
              <TabsContent value="comments" className="mt-3">
                <div className="rounded-lg border border-border bg-muted/50 h-[600px] overflow-hidden">
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
                      d
                        ? { ...d, data: { ...(d.data ?? {}), comments: next } }
                        : d
                    }
                  />
                </div>
              </TabsContent>
            ) : null}
          </Tabs>
        </aside>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-6 flex justify-center">
        <PoweredByBadge />
      </div>

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

function EndState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-6">
      <h1 className="text-2xl font-semibold mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground mb-6">{message}</p>
      <a href={appPath("/")} className="text-sm text-primary hover:underline">
        Go home
      </a>
    </div>
  );
}
