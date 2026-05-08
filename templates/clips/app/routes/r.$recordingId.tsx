import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, NavLink, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  IconShare3,
  IconSettings,
  IconArrowLeft,
  IconChevronDown,
  IconCalendar,
  IconScissors,
  IconAlertTriangle,
} from "@tabler/icons-react";
import {
  useActionMutation,
  useActionQuery,
  useSession,
  AgentPanel,
  agentNativePath,
} from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { isDefaultTitle, useAutoTitleBridge } from "@/hooks/use-auto-title";
import { EditableRecordingTitle } from "@/components/editable-recording-title";
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
import { parsePlaybackSpeed } from "@/lib/playback-speed";

export function meta({ params }: { params: { recordingId?: string } }) {
  return [{ title: "Clip recording · Clips" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen w-full bg-background">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

type SidePanel = "transcript" | "comments" | "insights" | "agent" | "settings";

function isStorageSetupFailureReason(
  reason: string | null | undefined,
): boolean {
  return /video storage is not connected|file upload provider|storage provider|connect builder|s3-compatible/i.test(
    reason ?? "",
  );
}

function isNativeSaveFailureReason(reason: string | null | undefined): boolean {
  return /native recording upload|native fullscreen|screencapture|avconvert/i.test(
    reason ?? "",
  );
}

function failureDetail(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}...` : trimmed;
}

function parseTimeParam(raw: string | null): number {
  if (!raw) return 0;
  const value = raw.trim();
  if (!value) return 0;

  if (/^\d+(\.\d+)?$/.test(value)) {
    return Math.floor(parseFloat(value) * 1000);
  }

  if (/^\d+:\d+(:\d+)?$/.test(value)) {
    const parts = value.split(":").map((part) => parseInt(part, 10));
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
    if (parts.length === 3) {
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
  }

  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

export default function RecordingPage() {
  useAutoTitleBridge();

  const { recordingId } = useParams<{ recordingId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const search = searchParams.toString();
  const startMs = parseTimeParam(searchParams.get("t"));
  const panelParam = searchParams.get("panel");
  const { session } = useSession();
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  const [panel, setPanel] = useState<SidePanel>("transcript");
  const [theaterMode, setTheaterMode] = useState(false);
  const [editing, setEditing] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const transcriptKickedRef = useRef<string | null>(null);
  // When the recording lands in the processing state but never flips to
  // 'ready', stop spinning forever and surface an error banner so the user
  // can retry or report the issue instead of staring at a spinner.
  const [processingTimeout, setProcessingTimeout] = useState(false);
  const [retryingFinalize, setRetryingFinalize] = useState(false);

  useEffect(() => {
    if (panelParam === "comments" || panelParam === "transcript") {
      setPanel(panelParam);
    }
  }, [panelParam]);

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
        if (data?.transcript?.cleanup?.status === "running") return 2000;
        // And keep polling while the title is still the server-seeded
        // default — the agent will land a generated title via
        // `update-recording` and we want the skeleton to swap in promptly.
        if (shouldShowGeneratedTitleSkeleton(rec, data?.transcript?.status))
          return 3000;
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
  const transcriptFullText = playerDataQ.data?.transcript?.fullText ?? null;
  const transcriptStatus = playerDataQ.data?.transcript?.status;
  const transcriptFailureReason = playerDataQ.data?.transcript?.failureReason;
  const transcriptCleanup = playerDataQ.data?.transcript?.cleanup ?? null;
  const ctas = playerDataQ.data?.ctas ?? [];
  const showTitleSkeleton = recording
    ? shouldShowGeneratedTitleSkeleton(recording, transcriptStatus)
    : false;
  const visibleTitle = recording
    ? displayRecordingTitle(recording.title)
    : "Untitled Clip";

  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const retryFinalizeAfterStorage = useCallback(async () => {
    if (!recordingId) return;
    setRetryingFinalize(true);
    setProcessingTimeout(false);
    try {
      const res = await fetch(
        agentNativePath("/_agent-native/actions/finalize-recording"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: recordingId }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        result?: { status?: string; storageSetupRequired?: boolean };
        status?: string;
        storageSetupRequired?: boolean;
      } | null;
      if (!res.ok) {
        throw new Error(body?.error ?? `Finalize failed (${res.status})`);
      }
      const result = body?.result ?? body;
      if (
        result?.storageSetupRequired ||
        result?.status === "waiting_storage"
      ) {
        toast.message("Storage still isn't connected", {
          description:
            "Finish the Builder.io popup or configure S3 storage, then try again.",
        });
        return;
      }
      toast.success("Clip upload resumed");
      await playerDataQ.refetch();
    } catch (err) {
      toast.error("Couldn't resume upload", {
        description:
          err instanceof Error ? err.message : "Try again in a moment.",
        duration: 12_000,
      });
    } finally {
      setRetryingFinalize(false);
      void playerDataQ.refetch();
    }
  }, [playerDataQ, recordingId]);
  const firstCta = ctas[0] ?? null;
  const handleAiError = (err: Error) =>
    toast.error(err?.message ?? "AI request failed");
  const regenerateTitle = useActionMutation("regenerate-title" as any, {
    onSuccess: (result: any) =>
      toast.success(
        result?.updated ? "Title updated" : "Title generation queued",
      ),
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
    document.title = isDefaultTitle(recording.title)
      ? "Clip recording · Clips"
      : `${recording.title.trim()} · Clips`;
  }, [recording?.title]);

  // Self-heal stuck transcripts. Older recordings (before finalize-recording
  // learned to auto-trigger transcription) can sit in `pending` forever with no
  // worker to pick them up. When the owner opens one, kick off a transcript
  // once per page mount; request-transcript skips fresh pending rows so this
  // does not duplicate the finalize-recording background worker during HMR.
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
        path: `/r/${recordingId}${search ? `?${search}` : ""}`,
        panel,
        ...(startMs > 0 ? { searchHitMs: startMs } : {}),
      }),
    }).catch(() => {});
  }, [panel, recordingId, search, startMs]);

  usePlayerShortcuts({ playerRef, chapters });

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
    const rawFailureReason =
      ((recording as any).failureReason as string | null | undefined) ?? null;
    const waitingForStorage = isStorageSetupFailureReason(rawFailureReason);
    const nativeSaveFailed =
      searchParams.get("saveFailed") === "1" ||
      isNativeSaveFailureReason(rawFailureReason);
    // Treat "stuck on processing/uploading past the 30s mark" as a failure
    // too — otherwise the user stares at a spinner forever when finalize
    // silently dies (e.g. chunk route 401s, storage provider throws).
    const stuckFailure = !explicitFailure && processingTimeout;
    const isFailure =
      explicitFailure || stuckFailure || waitingForStorage || nativeSaveFailed;
    const displayReason = explicitFailure
      ? (rawFailureReason ?? "You can retry from the library.")
      : nativeSaveFailed
        ? "The desktop recorder finished, but Clips could not upload and save the video."
        : stuckFailure
          ? `Processing hasn't completed after 30 seconds (status=${recording.status}). The clip may not have finished uploading — check the server logs for [chunk]/[finalize] messages.`
          : "Uploading and assembling your video — this usually takes just a few seconds.";
    const storageSetupFailure = waitingForStorage;
    const label = storageSetupFailure
      ? "Connect storage to finish saving this clip."
      : nativeSaveFailed
        ? "Oops, that clip did not save."
        : isFailure
          ? "Something went wrong while saving this clip."
          : "Finishing up your clip…";
    const failureReason = storageSetupFailure
      ? "Your clip data is still preserved. Connect Builder.io or S3 storage and Clips will upload it automatically."
      : displayReason;
    const detail = failureDetail(rawFailureReason);
    return (
      <div className="flex flex-col items-center justify-center h-screen w-full bg-background px-6">
        {!isFailure ? (
          <Spinner className="h-8 w-8 mb-4" />
        ) : !storageSetupFailure ? (
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
            <IconAlertTriangle className="h-5 w-5" />
          </div>
        ) : null}
        <h1 className="text-lg font-semibold mb-1">{label}</h1>
        <p className="text-sm text-muted-foreground mb-4 max-w-md text-center">
          {failureReason}
        </p>
        {isFailure &&
        !storageSetupFailure &&
        detail &&
        role &&
        role !== "viewer" ? (
          <div className="mb-4 w-full max-w-xl rounded-md border border-border bg-card p-4 text-left shadow-sm">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Details
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
              {detail}
            </pre>
          </div>
        ) : null}
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
            {retryingFinalize ? (
              <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 shadow-lg">
                <Spinner className="h-8 w-8 text-muted-foreground" />
                <div className="text-sm font-medium">Uploading saved clip…</div>
                <p className="text-sm text-muted-foreground">
                  Storage is connected. Clips is finishing the upload now.
                </p>
              </div>
            ) : (
              <StorageSetupCard
                title="Connect storage to finish saving"
                description="Choose where Clips should store videos. After it connects, this saved clip will upload automatically."
                connectedDescription="Storage connected. Uploading this clip..."
                onConfigured={retryFinalizeAfterStorage}
              />
            )}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              if (storageSetupFailure) {
                void retryFinalizeAfterStorage();
                return;
              }
              setProcessingTimeout(false);
              playerDataQ.refetch();
            }}
            variant="outline"
            size="sm"
            disabled={retryingFinalize}
          >
            {storageSetupFailure ? "Retry upload" : "Check again"}
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
            <EditableRecordingTitle
              recordingId={recording.id}
              title={recording.title}
              canEdit={canEdit}
              displayTitle={visibleTitle}
              showPendingSkeleton={showTitleSkeleton}
              className="text-sm font-medium"
              inputClassName="h-7 text-sm font-medium"
              skeletonClassName="h-4 w-56 max-w-full"
            />
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
                  defaultSpeed={
                    parsePlaybackSpeed(recording.defaultSpeed) ?? 1.2
                  }
                  startMs={startMs}
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
                  <EditableRecordingTitle
                    recordingId={recording.id}
                    title={recording.title}
                    canEdit={canEdit}
                    displayTitle={visibleTitle}
                    showPendingSkeleton={showTitleSkeleton}
                    className="text-base font-semibold"
                    inputClassName="h-8 text-base font-semibold"
                    skeletonClassName="h-5 w-72 max-w-full"
                  />
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
                    fullText={transcriptFullText}
                    durationMs={recording.durationMs}
                    currentMs={currentMs}
                    onSeek={(ms) => playerRef.current?.seek(ms)}
                    status={transcriptStatus}
                    failureReason={transcriptFailureReason}
                    cleanup={transcriptCleanup}
                    recordingTitle={recording.title}
                    onRetry={() => {
                      // Re-run transcription now that the user may have
                      // connected Builder/Gemini or after a one-off network
                      // error. The action flips the row to 'pending' first,
                      // so the UI swaps back to "Transcribing…".
                      fetch(
                        agentNativePath(
                          "/_agent-native/actions/request-transcript",
                        ),
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            recordingId: recording.id,
                            force: true,
                          }),
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
                    queryKey={[
                      "action",
                      "get-recording-player-data",
                      { recordingId: recordingId ?? "" },
                    ]}
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

function displayRecordingTitle(title: string | null | undefined): string {
  return isDefaultTitle(title) ? "Untitled Clip" : (title ?? "").trim();
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
