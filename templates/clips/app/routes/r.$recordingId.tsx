import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import {
  IconShare3,
  IconSettings,
  IconMessage,
  IconFileText,
  IconChartLine,
  IconArrowLeft,
  IconChevronDown,
} from "@tabler/icons-react";
import {
  useActionQuery,
  useSession,
  sendToAgentChat,
} from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/player/video-player";
import { TranscriptPanel } from "@/components/player/transcript-panel";
import { CommentsPanel } from "@/components/player/comments-panel";
import { ReactionsTray } from "@/components/player/reactions-tray";
import { SettingsPanel } from "@/components/player/settings-panel";
import { InsightsPanel } from "@/components/player/insights-panel";
import { ShareRecordingDialog } from "@/components/player/share-dialog";
import { usePlayerShortcuts } from "@/hooks/use-player-shortcuts";
import { useViewTracking } from "@/hooks/use-view-tracking";

export function meta({ params }: { params: { recordingId?: string } }) {
  return [{ title: `Clip · ${params.recordingId ?? ""}` }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-background">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

type SidePanel = "transcript" | "comments" | "insights" | "settings";

export default function RecordingPage() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  const [panel, setPanel] = useState<SidePanel>("transcript");
  const [theaterMode, setTheaterMode] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [speed, setSpeed] = useState(1.2);

  const playerDataQ = useActionQuery<any>(
    "get-recording-player-data",
    {
      recordingId: recordingId ?? "",
    },
    {
      enabled: !!recordingId,
      refetchInterval: (q) => {
        const rec = (q.state.data as any)?.recording;
        if (!rec) return false;
        // Poll while the recording is still being assembled / transcoded so
        // the page auto-upgrades from "Processing" to the real player the
        // moment the server flips status to 'ready' and writes videoUrl.
        if (rec.status !== "ready" || !rec.videoUrl) return 1000;
        return false;
      },
    },
  );

  const recording = playerDataQ.data?.recording;
  const role = playerDataQ.data?.role as
    | "owner"
    | "admin"
    | "editor"
    | "viewer"
    | undefined;
  const comments = playerDataQ.data?.comments ?? [];
  const reactions = playerDataQ.data?.reactions ?? [];
  const chapters = playerDataQ.data?.chapters ?? [];
  const transcriptSegments = playerDataQ.data?.transcript?.segments ?? [];
  const transcriptStatus = playerDataQ.data?.transcript?.status;
  const ctas = playerDataQ.data?.ctas ?? [];

  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const firstCta = ctas[0] ?? null;

  useEffect(() => {
    if (!recording) return;
    const s = parseFloat(recording.defaultSpeed || "1.2");
    if (!Number.isNaN(s)) setSpeed(s);
  }, [recording?.defaultSpeed]);

  // Sync navigation state
  useEffect(() => {
    if (!recordingId) return;
    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view: "recording",
        recordingId,
        path: `/r/${recordingId}`,
      }),
    }).catch(() => {});
  }, [recordingId]);

  usePlayerShortcuts({ playerRef, speed, setSpeed });

  const tracking = useViewTracking({
    recordingId: recordingId ?? "",
    videoRef: {
      get current() {
        return playerRef.current?.video ?? null;
      },
    } as any,
    durationMs: recording?.durationMs ?? 0,
    // Skip tracking for the owner — they shouldn't inflate their own views.
    disabled: role === "owner",
  });

  if (!recordingId) return null;

  if (playerDataQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-background">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (playerDataQ.isError || !recording) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-full bg-background px-6">
        <h1 className="text-xl font-semibold mb-2">Recording not found</h1>
        <p className="text-sm text-muted-foreground mb-4">
          {(playerDataQ.error as Error | undefined)?.message ??
            "You may not have access to this clip."}
        </p>
        <Button onClick={() => navigate("/")} variant="outline">
          Back to library
        </Button>
      </div>
    );
  }

  // Desktop app opens this page the moment stop is pressed — finalize runs
  // in the background. Show a dedicated "still processing" state and let the
  // refetch-interval above upgrade it to the full player as soon as the
  // server writes videoUrl + flips status to 'ready'.
  if (recording.status !== "ready" || !recording.videoUrl) {
    const progress = Number(recording.uploadProgress ?? 0);
    const label =
      recording.status === "failed"
        ? "Something went wrong while saving this clip."
        : "Finishing up your clip…";
    return (
      <div className="flex flex-col items-center justify-center h-screen w-full bg-background px-6">
        {recording.status !== "failed" ? (
          <Spinner className="h-8 w-8 mb-4" />
        ) : null}
        <h1 className="text-lg font-semibold mb-1">{label}</h1>
        <p className="text-sm text-muted-foreground mb-4">
          {recording.status === "failed"
            ? ((recording as any).failureReason ??
              "You can retry from the library.")
            : "Uploading and assembling your video — this usually takes just a few seconds."}
        </p>
        {recording.status !== "failed" && progress > 0 ? (
          <div className="w-64 h-1.5 rounded-full bg-muted overflow-hidden mb-4">
            <div
              className="h-full bg-foreground transition-all"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            onClick={() => playerDataQ.refetch()}
            variant="outline"
            size="sm"
          >
            Check again
          </Button>
          <Button onClick={() => navigate("/")} variant="ghost" size="sm">
            Back to library
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Main video column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            aria-label="Back"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-medium truncate">{recording.title}</h1>
            <p className="text-xs text-muted-foreground truncate">
              {recording.ownerEmail}
              {recording.visibility !== "private" ? (
                <> · {capitalize(recording.visibility)}</>
              ) : null}
            </p>
          </div>

          {canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  AI tools
                  <IconChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>Enhance this recording</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    sendToAgentChat({
                      message: `Regenerate the title for this recording (${recordingId}).`,
                      submit: true,
                    })
                  }
                >
                  Regenerate title
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    sendToAgentChat({
                      message: `Regenerate the description for this recording (${recordingId}).`,
                      submit: true,
                    })
                  }
                >
                  Regenerate description
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    sendToAgentChat({
                      message: `Generate chapters for this recording (${recordingId}).`,
                      submit: true,
                    })
                  }
                >
                  Auto chapters
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    sendToAgentChat({
                      message: `Remove filler words (um, uh, like) from recording ${recordingId}.`,
                      submit: true,
                    })
                  }
                >
                  Remove filler words
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    sendToAgentChat({
                      message: `Remove long silences from recording ${recordingId}.`,
                      submit: true,
                    })
                  }
                >
                  Remove silences
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    sendToAgentChat({
                      message: `Generate a PR description from recording ${recordingId}.`,
                      submit: true,
                    })
                  }
                >
                  Generate PR summary
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    sendToAgentChat({
                      message: `Generate an SOP doc from recording ${recordingId}.`,
                      submit: true,
                    })
                  }
                >
                  Generate SOP
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    sendToAgentChat({
                      message: `Generate a ticket from recording ${recordingId}.`,
                      submit: true,
                    })
                  }
                >
                  Generate ticket
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    sendToAgentChat({
                      message: `Generate a summary email from recording ${recordingId}.`,
                      submit: true,
                    })
                  }
                >
                  Generate email
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <Button
            onClick={() => setShareOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
            size="sm"
          >
            <IconShare3 className="h-4 w-4" />
            Share
          </Button>
        </header>

        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
          <div className="flex-1 min-h-0">
            <VideoPlayer
              ref={playerRef}
              recordingId={recording.id}
              videoUrl={recording.videoUrl}
              durationMs={recording.durationMs}
              thumbnailUrl={recording.thumbnailUrl}
              defaultSpeed={speed}
              comments={comments}
              chapters={chapters}
              reactions={reactions}
              transcriptSegments={transcriptSegments}
              theaterMode={theaterMode}
              onTheaterToggle={() => setTheaterMode((v) => !v)}
              cta={firstCta}
              onCtaClick={() => tracking.reportCtaClick()}
              onTimeUpdate={(ms) => setCurrentMs(ms)}
              className="h-full"
            />
          </div>

          {/* Title + reactions row */}
          <div className="flex items-start gap-3 shrink-0">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold truncate">
                {recording.title}
              </h2>
              {recording.description ? (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {recording.description}
                </p>
              ) : null}
            </div>
            {recording.enableReactions ? (
              <ReactionsTray
                disabled={!recording.enableReactions}
                onReact={(emoji) => {
                  tracking.reportReaction(emoji);
                  fetch("/_agent-native/actions/react-to-recording", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      recordingId: recording.id,
                      emoji,
                      videoTimestampMs: currentMs,
                    }),
                  })
                    .then(() => playerDataQ.refetch())
                    .catch(() => {});
                }}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Side panel */}
      <aside className="w-[380px] border-l border-border flex flex-col shrink-0 bg-background">
        {panel === "settings" && canEdit ? (
          <SettingsPanel
            recording={recording}
            visibility={recording.visibility}
            ctas={ctas}
            onClose={() => setPanel("transcript")}
            onRefetch={() => playerDataQ.refetch()}
          />
        ) : (
          <>
            <Tabs
              value={panel}
              onValueChange={(v) => setPanel(v as SidePanel)}
              className="flex flex-col h-full"
            >
              <TabsList
                className={cn(
                  "mx-3 mt-3 grid w-auto",
                  canEdit ? "grid-cols-3" : "grid-cols-2",
                )}
              >
                <TabsTrigger value="transcript" className="gap-1.5">
                  <IconFileText className="h-4 w-4" />
                  Transcript
                </TabsTrigger>
                <TabsTrigger value="comments" className="gap-1.5">
                  <IconMessage className="h-4 w-4" />
                  Comments
                  {comments.length > 0 ? (
                    <span className="ml-0.5 text-xs rounded-full bg-accent px-1.5 tabular-nums">
                      {comments.length}
                    </span>
                  ) : null}
                </TabsTrigger>
                {canEdit ? (
                  <TabsTrigger value="insights" className="gap-1.5">
                    <IconChartLine className="h-4 w-4" />
                    Insights
                  </TabsTrigger>
                ) : null}
              </TabsList>

              <TabsContent
                value="transcript"
                className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden"
              >
                <TranscriptPanel
                  segments={transcriptSegments}
                  currentMs={currentMs}
                  onSeek={(ms) => playerRef.current?.seek(ms)}
                  status={transcriptStatus}
                  recordingTitle={recording.title}
                />
              </TabsContent>
              <TabsContent
                value="comments"
                className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden"
              >
                <CommentsPanel
                  recordingId={recording.id}
                  comments={comments}
                  currentMs={currentMs}
                  currentUserEmail={session?.email}
                  enableComments={recording.enableComments}
                  onSeek={(ms) => playerRef.current?.seek(ms)}
                  onRefetch={() => playerDataQ.refetch()}
                />
              </TabsContent>
              {canEdit ? (
                <TabsContent
                  value="insights"
                  className="flex-1 min-h-0 mt-3 overflow-y-auto data-[state=inactive]:hidden"
                >
                  <InsightsPanel
                    recordingId={recording.id}
                    durationMs={recording.durationMs}
                  />
                </TabsContent>
              ) : null}
            </Tabs>

            {canEdit ? (
              <div className="border-t border-border p-2">
                <Button
                  onClick={() => setPanel("settings")}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                >
                  <IconSettings className="h-4 w-4" />
                  Settings
                </Button>
              </div>
            ) : null}
          </>
        )}
      </aside>

      <ShareRecordingDialog
        recordingId={recording.id}
        recordingTitle={recording.title}
        videoUrl={recording.videoUrl}
        animatedThumbnailUrl={recording.animatedThumbnailUrl}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Silence unused-import warnings where applicable.
void cn;
