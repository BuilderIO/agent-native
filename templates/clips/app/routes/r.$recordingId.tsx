import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, NavLink } from "react-router";
import { toast } from "sonner";
import {
  IconShare3,
  IconSettings,
  IconArrowLeft,
  IconChevronDown,
  IconCalendar,
  IconScissors,
} from "@tabler/icons-react";
import {
  useActionMutation,
  useActionQuery,
  useSession,
  AgentPanel,
  agentNativePath,
} from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { isDefaultTitle } from "@/hooks/use-auto-title";
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
import { EditorLayout } from "@/components/editor/editor-layout";
import { TranscriptPanel } from "@/components/player/transcript-panel";
import { CommentsPanel } from "@/components/player/comments-panel";
import { ReactionsTray } from "@/components/player/reactions-tray";
import { SettingsPanel } from "@/components/player/settings-panel";
import { InsightsPanel } from "@/components/player/insights-panel";
import { ShareRecordingPopover } from "@/components/player/share-dialog";
import { StorageSetupCard } from "@/components/recorder/storage-setup-card";
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

type SidePanel = "transcript" | "comments" | "insights" | "agent" | "settings";

export default function RecordingPage() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  const [panel, setPanel] = useState<SidePanel>("transcript");
  const [theaterMode, setTheaterMode] = useState(false);
  const [editing, setEditing] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [speed, setSpeed] = useState(1.2);
  const transcriptKickedRef = useRef<string | null>(null);
  // When the recording lands in the processing state but never flips to
  // 'ready', stop spinning forever and surface an error banner so the user
  // can retry or report the issue instead of staring at a spinner.
  const [processingTimeout, setProcessingTimeout] = useState(false);

  const playerDataQ = useActionQuery<any>(
    "get-recording-player-data",
    {
      recordingId: recordingId ?? "",
    },
    {
      enabled: !!recordingId,
      refetchInterval: (q) => {
        const data = q.state.data as any;
        const rec = data?.recording;
        if (!rec) return false;
        // Poll while the recording is still being assembled / transcoded so
        // the page auto-upgrades from "Processing" to the real player the
        // moment the server flips status to 'ready' and writes videoUrl.
        if (rec.status !== "ready" || !rec.videoUrl) return 1000;
        // Also keep polling while a transcript is pending so "Transcribing…"
        // auto-flips to the ready transcript (or to the failure card).
        if (data?.transcript?.status === "pending") return 3000;
        // And keep polling while the title is still the server-seeded
        // default — the agent will land a generated title via
        // `update-recording` and we want the skeleton to swap in promptly.
        if (isDefaultTitle(rec.title)) return 3000;
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
  const transcriptFailureReason = playerDataQ.data?.transcript?.failureReason;
  const ctas = playerDataQ.data?.ctas ?? [];

  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const firstCta = ctas[0] ?? null;
  const handleAiError = (err: Error) =>
    toast.error(err?.message ?? "AI request failed");
  const regenerateTitle = useActionMutation("regenerate-title" as any, {
    onSuccess: () => toast.success("Title request queued"),
    onError: handleAiError,
  });
  const regenerateSummary = useActionMutation("regenerate-summary" as any, {
    onSuccess: () => toast.success("Description request queued"),
    onError: handleAiError,
  });
  const regenerateChapters = useActionMutation("regenerate-chapters" as any, {
    onSuccess: () => toast.success("Chapter request queued"),
    onError: handleAiError,
  });
  const removeFillerWords = useActionMutation("remove-filler-words" as any, {
    onSuccess: () => toast.success("Filler-word removal queued"),
    onError: handleAiError,
  });
  const removeSilences = useActionMutation("remove-silences" as any, {
    onSuccess: () => toast.success("Silence removal queued"),
    onError: handleAiError,
  });
  const generateWorkflow = useActionMutation("generate-workflow" as any, {
    onSuccess: () => toast.success("Workflow request queued"),
    onError: handleAiError,
  });

  useEffect(() => {
    if (!canEdit && editing) setEditing(false);
  }, [canEdit, editing]);

  useEffect(() => {
    if (!recording) return;
    const s = parseFloat(recording.defaultSpeed || "1.2");
    if (!Number.isNaN(s)) setSpeed(s);
  }, [recording?.defaultSpeed]);

  // Self-heal stuck transcripts. Older recordings (before finalize-recording
  // learned to auto-trigger Whisper) can sit in `pending` forever with no
  // worker to pick them up. When the owner opens one, kick off a transcript
  // once per page mount — the upsert inside request-transcript is idempotent
  // so a second "real" run would just overwrite the pending row.
  useEffect(() => {
    if (!recording) return;
    if (role !== "owner" && role !== "admin" && role !== "editor") return;
    if (recording.status !== "ready") return;
    if (transcriptStatus !== "pending") return;
    if (transcriptKickedRef.current === recording.id) return;
    transcriptKickedRef.current = recording.id;
    fetch(agentNativePath("/_agent-native/actions/request-transcript"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: recording.id }),
    })
      .catch(() => {})
      .finally(() => playerDataQ.refetch());
  }, [recording?.id, recording?.status, transcriptStatus, role, playerDataQ]);

  // After 30 seconds of non-ready status (without an explicit failure), flip
  // a local flag so we can stop pretending this is normal and show an error.
  // Even a 10-minute recording's finalize completes in a few seconds with
  // the SQL fallback, so anything past 30s means something is wrong.
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
    const handle = setTimeout(() => setProcessingTimeout(true), 30_000);
    return () => clearTimeout(handle);
  }, [recording?.status, recording?.videoUrl, recordingId]);

  // Sync navigation state
  useEffect(() => {
    if (!recordingId) return;
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
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

  usePlayerShortcuts({ playerRef, speed, setSpeed, chapters });

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
    const explicitFailure = recording.status === "failed";
    // Treat "stuck on processing/uploading past the 30s mark" as a failure
    // too — otherwise the user stares at a spinner forever when finalize
    // silently dies (e.g. chunk route 401s, storage provider throws).
    const stuckFailure = !explicitFailure && processingTimeout;
    const isFailure = explicitFailure || stuckFailure;
    const label = isFailure
      ? "Something went wrong while saving this clip."
      : "Finishing up your clip…";
    const failureReason = explicitFailure
      ? ((recording as any).failureReason ?? "You can retry from the library.")
      : stuckFailure
        ? `Processing hasn't completed after 30 seconds (status=${recording.status}). The clip may not have finished uploading — check the server logs for [chunk]/[finalize] messages.`
        : "Uploading and assembling your video — this usually takes just a few seconds.";
    const storageSetupFailure =
      isFailure &&
      /file upload provider|storage provider|connect builder|s3-compatible/i.test(
        failureReason,
      );
    return (
      <div className="flex flex-col items-center justify-center h-screen w-full bg-background px-6">
        {!isFailure ? <Spinner className="h-8 w-8 mb-4" /> : null}
        <h1 className="text-lg font-semibold mb-1">{label}</h1>
        <p className="text-sm text-muted-foreground mb-4 max-w-md text-center">
          {failureReason}
        </p>
        {!isFailure && progress > 0 ? (
          <div className="w-64 h-1.5 rounded-full bg-muted overflow-hidden mb-4">
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
              description="Clips needs storage before it can save and share this recording."
              onConfigured={() => {
                setProcessingTimeout(false);
                playerDataQ.refetch();
              }}
            />
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setProcessingTimeout(false);
              playerDataQ.refetch();
            }}
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
            {isDefaultTitle(recording.title) ? (
              // Placeholder while the agent drafts a title. The
              // useAutoTitleBridge in `_app.tsx` queues the delegation the
              // moment the transcript is ready; polling then swaps the
              // skeleton for the real title.
              <Skeleton
                aria-label="Generating title"
                className="h-4 w-56 max-w-full"
              />
            ) : (
              <h1 className="text-sm font-medium truncate">
                {recording.title}
              </h1>
            )}
            <p className="text-xs text-muted-foreground truncate">
              {recording.ownerEmail}
              {recording.visibility !== "private" ? (
                <> · {capitalize(recording.visibility)}</>
              ) : null}
            </p>
          </div>

          {canEdit ? (
            <Button
              variant={editing ? "secondary" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setEditing((v) => !v)}
            >
              <IconScissors className="h-4 w-4" />
              {editing ? "Done" : "Edit"}
            </Button>
          ) : null}

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
                  disabled={regenerateTitle.isPending}
                  onSelect={() =>
                    regenerateTitle.mutate({
                      recordingId: recording.id,
                    } as any)
                  }
                >
                  Regenerate title
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={regenerateSummary.isPending}
                  onSelect={() =>
                    regenerateSummary.mutate({
                      recordingId: recording.id,
                    } as any)
                  }
                >
                  Regenerate description
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={regenerateChapters.isPending}
                  onSelect={() =>
                    regenerateChapters.mutate({
                      recordingId: recording.id,
                    } as any)
                  }
                >
                  Auto chapters
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={removeFillerWords.isPending}
                  onSelect={() =>
                    removeFillerWords.mutate({
                      recordingId: recording.id,
                    } as any)
                  }
                >
                  Remove filler words
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={removeSilences.isPending}
                  onSelect={() =>
                    removeSilences.mutate({
                      recordingId: recording.id,
                      thresholdMs: 1200,
                    } as any)
                  }
                >
                  Remove silences (&gt;1.2s)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={generateWorkflow.isPending}
                  onSelect={() =>
                    generateWorkflow.mutate({
                      recordingId: recording.id,
                      kind: "pr",
                    } as any)
                  }
                >
                  Generate PR summary
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={generateWorkflow.isPending}
                  onSelect={() =>
                    generateWorkflow.mutate({
                      recordingId: recording.id,
                      kind: "sop",
                    } as any)
                  }
                >
                  Generate SOP
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={generateWorkflow.isPending}
                  onSelect={() =>
                    generateWorkflow.mutate({
                      recordingId: recording.id,
                      kind: "ticket",
                    } as any)
                  }
                >
                  Generate ticket
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={generateWorkflow.isPending}
                  onSelect={() =>
                    generateWorkflow.mutate({
                      recordingId: recording.id,
                      kind: "email",
                    } as any)
                  }
                >
                  Generate email
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <ShareRecordingPopover
            recordingId={recording.id}
            recordingTitle={recording.title}
            videoUrl={recording.videoUrl}
            animatedThumbnailUrl={recording.animatedThumbnailUrl}
          >
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
              size="sm"
            >
              <IconShare3 className="h-4 w-4" />
              Share
            </Button>
          </ShareRecordingPopover>
        </header>

        <div
          className={cn(
            "flex-1 flex flex-col overflow-hidden",
            editing && canEdit ? "min-h-0" : "p-4 gap-4",
          )}
        >
          {editing && canEdit ? (
            <EditorLayout recordingId={recording.id} className="flex-1" />
          ) : (
            <>
              <div className="flex-1 min-h-0">
                <VideoPlayer
                  ref={playerRef}
                  recordingId={recording.id}
                  videoUrl={recording.videoUrl}
                  durationMs={recording.durationMs}
                  editsJson={recording.editsJson}
                  thumbnailUrl={recording.thumbnailUrl}
                  role={role}
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
                  {/* G9 — "From meeting" badge surfaced when this recording is
                      attached to a meeting (server fix 6 attaches `meeting`). */}
                  {playerDataQ.data?.meeting ? (
                    <NavLink
                      to={`/meetings/${playerDataQ.data.meeting.id}`}
                      className="inline-flex items-center gap-1.5 mb-1 rounded-full border border-border bg-accent/40 px-2 py-0.5 text-[11px] text-foreground hover:bg-accent/70 cursor-pointer"
                    >
                      <IconCalendar className="h-3 w-3" />
                      <span className="text-muted-foreground">
                        From meeting:
                      </span>
                      <span className="font-medium truncate max-w-[240px]">
                        {playerDataQ.data.meeting.title || "Untitled"}
                      </span>
                    </NavLink>
                  ) : null}
                  {isDefaultTitle(recording.title) ? (
                    <Skeleton
                      aria-label="Generating title"
                      className="h-5 w-72 max-w-full"
                    />
                  ) : (
                    <h2 className="text-base font-semibold truncate">
                      {recording.title}
                    </h2>
                  )}
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
                        .then(() => playerDataQ.refetch())
                        .catch(() => {});
                    }}
                  />
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Side panel */}
      {!editing ? (
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
                    canEdit ? "grid-cols-4" : "grid-cols-2",
                  )}
                >
                  <TabsTrigger value="transcript" className="text-xs">
                    Transcript
                  </TabsTrigger>
                  <TabsTrigger value="comments" className="text-xs gap-1">
                    Comments
                    {comments.length > 0 ? (
                      <span className="ml-0.5 text-[10px] rounded-full bg-accent px-1.5 tabular-nums">
                        {comments.length}
                      </span>
                    ) : null}
                  </TabsTrigger>
                  {canEdit ? (
                    <TabsTrigger value="insights" className="text-xs">
                      Insights
                    </TabsTrigger>
                  ) : null}
                  {canEdit ? (
                    <TabsTrigger value="agent" className="text-xs">
                      Agent
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
                    failureReason={transcriptFailureReason}
                    recordingTitle={recording.title}
                    onRetry={() => {
                      // Re-run the Whisper transcription now that the user may
                      // have set their OPENAI_API_KEY (or after a one-off
                      // network error). The action flips the row to 'pending'
                      // first, so the UI will swap back to "Transcribing…".
                      fetch(
                        agentNativePath(
                          "/_agent-native/actions/request-transcript",
                        ),
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ recordingId: recording.id }),
                        },
                      )
                        .then((res) => {
                          if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        })
                        .catch((err) =>
                          toast.error(
                            `Retry failed: ${err?.message ?? "network error"}`,
                          ),
                        )
                        .finally(() => playerDataQ.refetch());
                    }}
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
                {canEdit ? (
                  <TabsContent
                    value="agent"
                    className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden flex flex-col"
                  >
                    <AgentPanel
                      emptyStateText="Ask about this clip…"
                      suggestions={[
                        "Summarize this clip",
                        "Suggest a better title",
                        "Generate chapters from the transcript",
                      ]}
                      showHeader={false}
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
      ) : null}
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
