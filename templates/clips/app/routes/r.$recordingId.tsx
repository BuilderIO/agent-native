import {
  useActionMutation,
  useActionQuery,
  useSession,
  AgentPanel,
  agentNativePath,
  getBrowserTabId,
  readClientAppState,
  writeClientAppState,
  useChangeVersions,
  useT,
} from "@agent-native/core/client";
import {
  BUILDER_CREDITS_UPGRADE_URL,
  type BuilderCreditsStatus,
} from "@shared/builder-credits";
import {
  isLoomEmbedBackedRecording,
  isLoomRecordingSource,
} from "@shared/loom";
import {
  IconShare3,
  IconArrowLeft,
  IconChevronDown,
  IconCalendar,
  IconScissors,
  IconAlertTriangle,
  IconHelpCircle,
  IconClipboardCopy,
  IconFileText,
  IconSparkles,
  IconExternalLink,
  IconMessageDots,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, NavLink, useSearchParams } from "react-router";
import { toast } from "sonner";

import { EditableRecordingTitle } from "@/components/editable-recording-title";
import { EditorLayout } from "@/components/editor/editor-layout";
import { CommentsPanel } from "@/components/player/comments-panel";
import { RecordingOptionsMenu } from "@/components/player/delete-recording-menu";
import { InsightsPanel } from "@/components/player/insights-panel";
import { ReactionsTray } from "@/components/player/reactions-tray";
import { SettingsPanel } from "@/components/player/settings-panel";
import { ShareRecordingPopover } from "@/components/player/share-dialog";
import {
  TimestampedCommentButton,
  TimestampedCommentBar,
} from "@/components/player/timestamped-comment-button";
import { TranscriptPanel } from "@/components/player/transcript-panel";
import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/player/video-player";
import { StorageSetupCard } from "@/components/recorder/storage-setup-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isDefaultTitle, useAutoTitleBridge } from "@/hooks/use-auto-title";
import { usePlayerShortcuts } from "@/hooks/use-player-shortcuts";
import { useViewTracking } from "@/hooks/use-view-tracking";
import enMessages from "@/i18n/en-US";
import { parsePlaybackSpeed } from "@/lib/playback-speed";
import { isStorageSetupFailureReason } from "@/lib/storage-failures";
import { cn } from "@/lib/utils";

const UPLOAD_STUCK_TIMEOUT_MS = 5 * 60 * 1000;
const PROCESSING_STUCK_TIMEOUT_MS = 2 * 60 * 1000;

export function meta() {
  return [{ title: enMessages.recordingRoute.pageTitle }];
}

type SidePanel = "transcript" | "comments" | "insights" | "agent" | "settings";
type WorkflowKind = "pr" | "sop" | "ticket" | "email";

const WORKFLOW_MENU_ITEMS: Array<{
  kind: WorkflowKind;
  labelKey: string;
  tooltipKey?: string;
}> = [
  { kind: "pr", labelKey: "recordingPage.generatePrSummary" },
  {
    kind: "sop",
    labelKey: "recordingPage.generateSop",
    tooltipKey: "recordingPage.generateSopTooltip",
  },
  { kind: "ticket", labelKey: "recordingPage.generateTicket" },
  { kind: "email", labelKey: "recordingPage.generateEmail" },
];

interface GeneratedWorkflowState {
  kind?: WorkflowKind;
  status?: "generating" | "ready" | "failed" | string;
  content?: string;
  recordingId?: string;
  requestedAt?: string;
  error?: string;
}

function useIsCompactRecordingLayout() {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1279px)");
    const update = () => setIsCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isCompact;
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

function nativeSaveFailureMessage(reason: string | null | undefined): string {
  const text = reason ?? "";
  if (
    /finalization callback failed|missing required metadata|missing playback metadata|corrupted or incomplete|missing moov/i.test(
      text,
    )
  ) {
    return "macOS could not finish writing this desktop recording. The local file is incomplete, so discard it from the Clips menu and record again.";
  }
  if (/too large|compression/i.test(text)) {
    return "Clips tried to compress this desktop recording, but it is still too large to upload. The original is saved locally and can be retried from the Clips menu.";
  }
  return "The desktop recorder finished and saved a local copy, but Clips could not upload it. You can retry from the Clips menu without recording again.";
}

function InsightsUnavailableState() {
  const t = useT();

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <p className="text-sm font-medium text-foreground">
        {t("sharePage.ownerInsights")}
      </p>
      <p className="mt-2 max-w-[240px] text-sm leading-5 text-muted-foreground">
        {t("sharePage.ownerInsightsDescription")}
      </p>
    </div>
  );
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
  const t = useT();
  useAutoTitleBridge();

  const { recordingId } = useParams<{ recordingId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const startMs = parseTimeParam(searchParams.get("t"));
  const panelParam = searchParams.get("panel");
  const { session } = useSession();
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  const [panel, setPanel] = useState<SidePanel>("agent");
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [editing, setEditing] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentAtMs, setCommentAtMs] = useState(0);
  const isCompactLayout = useIsCompactRecordingLayout();
  // Resolve the playback position for reactions/comments. Native <video> exposes
  // a live `currentTime`; Loom embeds render in a cross-origin iframe with no
  // live time bridge, so we fall back to the last position the player reported
  // via onTimeUpdate (seek/initial start).
  const resolvePlaybackMs = useCallback(() => {
    const liveCt = playerRef.current?.video?.currentTime;
    if (
      typeof liveCt === "number" &&
      Number.isFinite(liveCt) &&
      liveCt >= 0 &&
      liveCt < 1e7
    ) {
      return Math.floor(liveCt * 1000);
    }
    return currentMs;
  }, [currentMs]);
  const transcriptKickedRef = useRef<string | null>(null);
  // When the recording lands in the processing state but never flips to
  // 'ready', stop spinning forever and surface an error banner so the user
  // can retry or report the issue instead of staring at a spinner.
  const [processingTimeout, setProcessingTimeout] = useState(false);
  const [retryingFinalize, setRetryingFinalize] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const browserTabId = useMemo(() => getBrowserTabId(), []);
  const recordingScope = useMemo(
    () =>
      recordingId ? { type: "recording" as const, id: recordingId } : null,
    [recordingId],
  );
  const lastPlayerStateWriteRef = useRef(0);

  useEffect(() => {
    if (
      panelParam === "agent" ||
      panelParam === "comments" ||
      panelParam === "transcript" ||
      panelParam === "insights" ||
      panelParam === "settings"
    ) {
      setPanel(panelParam);
      if (isCompactLayout) setSidePanelOpen(true);
    }
  }, [isCompactLayout, panelParam]);

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
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const builderCredits =
    (playerDataQ.data?.builderCredits as BuilderCreditsStatus | null) ?? null;
  const titleGenerationPaused = Boolean(
    canEdit &&
    builderCredits?.exhausted === true &&
    recording &&
    isDefaultTitle(recording.title),
  );
  const showTitleSkeleton = recording
    ? shouldShowGeneratedTitleSkeleton(recording, transcriptStatus, {
        titleGenerationPaused,
      })
    : false;
  const visibleTitle = recording
    ? displayRecordingTitle(recording.title)
    : "Untitled Clip";
  useEffect(() => {
    if (!recording?.id) return;
    const now = Date.now();
    if (now - lastPlayerStateWriteRef.current < 1000) return;
    lastPlayerStateWriteRef.current = now;
    void writeClientAppState(
      `player-state:${browserTabId}`,
      {
        view: "recording",
        recordingId: recording.id,
        currentMs: Math.max(0, Math.round(currentMs)),
        durationMs: recording.durationMs,
        panel,
        updatedAt: new Date(now).toISOString(),
      },
      { requestSource: browserTabId },
    ).catch(() => {});
  }, [browserTabId, currentMs, panel, recording?.durationMs, recording?.id]);
  const appStateVersion = useChangeVersions(["app-state", "action"]);
  const generatedWorkflowQ = useQuery<GeneratedWorkflowState | null>({
    queryKey: [
      "app-state",
      "clips-workflow",
      recording?.id ?? "",
      appStateVersion,
    ],
    enabled: Boolean(recording?.id),
    placeholderData: (previous) => previous,
    refetchInterval: (query) =>
      query.state.data?.status === "generating" ? 2000 : false,
    queryFn: async ({ signal }) => {
      if (!recording?.id) return null;
      return readClientAppState<GeneratedWorkflowState>(
        `clips-workflow-${recording.id}`,
        { signal },
      );
    },
  });
  const generatedWorkflow =
    generatedWorkflowQ.data?.recordingId === recording?.id
      ? generatedWorkflowQ.data
      : null;

  const isLoomEmbedBacked = isLoomEmbedBackedRecording(recording);
  const isLoomRecording = isLoomRecordingSource(recording);
  const canUseNativeEditor = canEdit && !isLoomEmbedBacked;
  const canDelete = role === "owner";
  const canDownloadRecording = Boolean(
    recording?.enableDownloads && recording.videoUrl && !isLoomEmbedBacked,
  );
  const downloadRecording = useCallback(async () => {
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
  }, [recording?.title, recording?.videoUrl]);
  const retryFinalizeAfterStorage = useCallback(async () => {
    if (!recordingId) return;
    setRetryingFinalize(true);
    setProcessingTimeout(false);
    try {
      const retryingLoomImport = isLoomRecording;
      const actionPath = retryingLoomImport
        ? "/_agent-native/actions/import-loom-recording"
        : "/_agent-native/actions/finalize-recording";
      if (retryingLoomImport && !recording?.sourceWindowTitle) {
        throw new Error(t("recordingPage.loomMissingUrl"));
      }
      const res = await fetch(agentNativePath(actionPath), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          retryingLoomImport
            ? {
                recordingId,
                url: recording?.sourceWindowTitle,
              }
            : { id: recordingId },
        ),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        result?: { status?: string; storageSetupRequired?: boolean };
        status?: string;
        storageSetupRequired?: boolean;
      } | null;
      if (!res.ok) {
        throw new Error(
          body?.error ??
            t("recordingPage.finalizeFailed", { status: res.status }),
        );
      }
      const result = body?.result ?? body;
      if (
        result?.storageSetupRequired ||
        result?.status === "waiting_storage"
      ) {
        toast.message(t("recordingPage.storageStillDisconnected"), {
          description: t("recordingPage.finishBuilderOrS3"),
        });
        return;
      }
      toast.success(
        retryingLoomImport
          ? t("recordingPage.loomImportResumed")
          : t("recordingPage.clipUploadResumed"),
      );
      await playerDataQ.refetch();
    } catch (err) {
      toast.error(
        isLoomRecording
          ? t("recordingPage.couldNotRetryLoom")
          : t("recordingPage.couldNotResumeUpload"),
        {
          description:
            err instanceof Error
              ? err.message
              : t("recordingPage.tryAgainMoment"),
          duration: 12_000,
        },
      );
    } finally {
      setRetryingFinalize(false);
      void playerDataQ.refetch();
    }
  }, [isLoomRecording, playerDataQ, recording?.sourceWindowTitle, recordingId]);
  const firstCta = ctas[0] ?? null;
  const handleAiError = (err: Error) =>
    toast.error(err?.message ?? t("recordingPage.aiRequestFailed"));
  const regenerateTitle = useActionMutation("regenerate-title" as any, {
    onSuccess: (result: any) => {
      if (result?.updated) {
        toast.success(t("recordingPage.titleUpdated"));
      } else if (result?.reason === "builder_credits_paused") {
        toast.message(t("builderCredits.pausedTitle"), {
          description: t("builderCredits.titleDescription"),
        });
      } else if (result?.skipped) {
        toast.message(t("recordingPage.transcriptNotReady"), {
          description: t("recordingPage.tryAfterTranscription"),
        });
      } else {
        toast.success(t("recordingPage.titleGenerationQueued"));
      }
    },
    onError: handleAiError,
  });
  const regenerateSummary = useActionMutation("regenerate-summary" as any, {
    onSuccess: () => toast.success(t("recordingPage.descriptionQueued")),
    onError: handleAiError,
  });
  const regenerateChapters = useActionMutation("regenerate-chapters" as any, {
    onSuccess: () => toast.success(t("recordingPage.chapterQueued")),
    onError: handleAiError,
  });
  const removeFillerWords = useActionMutation("remove-filler-words" as any, {
    onSuccess: () => toast.success(t("recordingPage.fillerQueued")),
    onError: handleAiError,
  });
  const removeSilences = useActionMutation("remove-silences" as any, {
    onSuccess: () => toast.success(t("recordingPage.silenceQueued")),
    onError: handleAiError,
  });
  const generateWorkflow = useActionMutation("generate-workflow" as any, {
    onSuccess: () => {
      toast.success(t("recordingPage.workflowQueued"));
      void generatedWorkflowQ.refetch();
    },
    onError: handleAiError,
  });
  function handleGenerateWorkflow(kind: WorkflowKind) {
    if (!recording) return;
    setEditing(false);
    setPanel("agent");
    window.dispatchEvent(
      new CustomEvent("agent-panel:set-mode", { detail: { mode: "chat" } }),
    );
    generateWorkflow.mutate({
      recordingId: recording.id,
      kind,
    } as any);
  }

  useEffect(() => {
    if (recording && panel === "settings" && !canEdit) setPanel("agent");
  }, [canEdit, panel, recording]);

  useEffect(() => {
    if (!canUseNativeEditor && editing) setEditing(false);
  }, [canUseNativeEditor, editing]);

  useEffect(() => {
    if (editing || !isCompactLayout) setSidePanelOpen(false);
  }, [editing, isCompactLayout]);

  useEffect(() => {
    if (!recording) return;
    document.title = isDefaultTitle(recording.title)
      ? t("recordingPage.pageTitle")
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

  // Long browser-extension clips can still be uploading chunks or assembling
  // for more than 30s. Keep polling before surfacing a stuck-state fallback.
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
    const timeoutMs =
      recording.status === "processing"
        ? PROCESSING_STUCK_TIMEOUT_MS
        : UPLOAD_STUCK_TIMEOUT_MS;
    const handle = setTimeout(() => setProcessingTimeout(true), timeoutMs);
    return () => clearTimeout(handle);
  }, [recording?.status, recording?.videoUrl, recordingId]);

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
        <h1 className="text-xl font-semibold mb-2">
          {t("recordingPage.recordingNotFound")}
        </h1>
        <p className="text-sm text-muted-foreground mb-4">
          {(playerDataQ.error as Error | undefined)?.message ??
            t("recordingPage.noAccess")}
        </p>
        <Button onClick={() => navigate("/")} variant="outline">
          {t("recordingPage.backToLibrary")}
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
    const loomStorageSetupFailure = waitingForStorage && isLoomRecording;
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
      ? (rawFailureReason ?? t("recordingPage.retryLibrary"))
      : nativeSaveFailed
        ? nativeSaveFailureMessage(rawFailureReason)
        : stuckFailure
          ? t("recordingPage.processingStuck", { status: recording.status })
          : t("recordingPage.uploadingAssembling");
    const storageSetupFailure = waitingForStorage;
    const label = storageSetupFailure
      ? loomStorageSetupFailure
        ? t("recordingPage.connectStorageImportLoom")
        : t("recordingPage.connectStorageFinishClip")
      : nativeSaveFailed
        ? t("recordingPage.uploadPausedSaved")
        : isFailure
          ? t("recordingPage.savingWentWrong")
          : t("recordingPage.finishingClip");
    const failureReason = storageSetupFailure
      ? loomStorageSetupFailure
        ? t("recordingPage.loomSourcePreserved")
        : t("recordingPage.clipDataPreserved")
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
          <div className="mb-4 w-full max-w-xl rounded-md border border-border bg-card p-4 text-start shadow-sm">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("recordingPage.details")}
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
                <div className="text-sm font-medium">
                  {loomStorageSetupFailure
                    ? t("recordingPage.importingLoom")
                    : t("recordingPage.uploadingSavedClip")}
                </div>
                <p className="text-sm text-muted-foreground">
                  {loomStorageSetupFailure
                    ? t("recordingPage.storageConnectedSavingLoom")
                    : t("recordingPage.storageConnectedFinishing")}
                </p>
              </div>
            ) : (
              <StorageSetupCard
                title={
                  loomStorageSetupFailure
                    ? t("recordingPage.connectStorageImportLoomTitle")
                    : t("recordingPage.connectStorageFinishSaving")
                }
                description={
                  loomStorageSetupFailure
                    ? t("recordingPage.chooseStorageRetryLoom")
                    : t("recordingPage.chooseStorageUpload")
                }
                connectedDescription={
                  loomStorageSetupFailure
                    ? t("recordingPage.storageConnectedImporting")
                    : t("recordingPage.storageConnectedUploading")
                }
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
            {storageSetupFailure
              ? loomStorageSetupFailure
                ? t("recordingPage.retryImport")
                : t("recordingPage.retryUpload")
              : t("recordingPage.checkAgain")}
          </Button>
          <Button onClick={() => navigate("/")} variant="ghost" size="sm">
            {t("recordingPage.backToLibrary")}
          </Button>
        </div>
      </div>
    );
  }

  const renderSidePanel = (compact = false) => (
    <Tabs
      value={panel}
      onValueChange={(v) => setPanel(v as SidePanel)}
      className={cn("flex h-full flex-col", compact && "pt-8")}
    >
      <TabsList
        className={cn(
          "mx-3 mt-3 grid w-auto",
          canEdit ? "grid-cols-5" : "grid-cols-4",
        )}
      >
        <TabsTrigger value="agent" className="min-w-0 px-2 text-xs">
          {t("recordingPage.agent")}
        </TabsTrigger>
        <TabsTrigger value="comments" className="min-w-0 px-2 text-xs">
          {t("recordingPage.activity")}
        </TabsTrigger>
        <TabsTrigger value="transcript" className="min-w-0 px-2 text-xs">
          {t("recordingPage.transcript")}
        </TabsTrigger>
        <TabsTrigger value="insights" className="min-w-0 px-2 text-xs">
          {t("recordingPage.insights")}
        </TabsTrigger>
        {canEdit ? (
          <TabsTrigger value="settings" className="min-w-0 px-2 text-xs">
            {t("recordingPage.settings")}
          </TabsTrigger>
        ) : null}
      </TabsList>

      <TabsContent
        value="agent"
        className="mt-0 flex flex-1 min-h-0 flex-col data-[state=inactive]:hidden"
      >
        <AgentPanel
          browserTabId={browserTabId}
          scope={recordingScope}
          emptyStateText={t("recordingPage.askAboutClip")}
          dynamicSuggestions={false}
          chatNotice={
            generatedWorkflow ? (
              <GeneratedWorkflowNotice workflow={generatedWorkflow} />
            ) : null
          }
          suggestions={
            canEdit
              ? [
                  t("recordingPage.summarizeClip"),
                  t("recordingPage.generateChapters"),
                  t("recordingPage.findActionItems"),
                  t("recordingPage.draftRecap"),
                ]
              : [
                  t("recordingPage.summarizeClip"),
                  t("recordingPage.findKeyMoments"),
                  t("recordingPage.listFollowUpActions"),
                  t("recordingPage.draftQuestions"),
                ]
          }
        />
      </TabsContent>
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
            // Force a fresh transcript job, then let polling swap the panel
            // back to the pending state while it runs.
            fetch(
              agentNativePath("/_agent-native/actions/request-transcript"),
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
                  t("recordingPage.retryFailed", {
                    message: err?.message ?? t("recordingPage.networkError"),
                  }),
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
      <TabsContent
        value="insights"
        className="flex-1 min-h-0 mt-3 overflow-y-auto data-[state=inactive]:hidden"
      >
        {canEdit ? (
          <InsightsPanel
            recordingId={recording.id}
            durationMs={recording.durationMs}
          />
        ) : (
          <InsightsUnavailableState />
        )}
      </TabsContent>
      {canEdit ? (
        <TabsContent
          value="settings"
          className="mt-3 flex flex-1 min-h-0 flex-col data-[state=inactive]:hidden"
        >
          <SettingsPanel
            recording={recording}
            visibility={recording.visibility}
            ctas={ctas}
            onClose={() => setPanel("agent")}
            onRefetch={() => playerDataQ.refetch()}
            showHeader={false}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  );

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Main video column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            aria-label={t("recordingPage.back")}
          >
            <IconArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
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
            {titleGenerationPaused ? (
              <BuilderCreditsTitleNotice className="mt-2" />
            ) : null}
          </div>

          {canUseNativeEditor ? (
            <Button
              variant={editing ? "secondary" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setEditing((v) => !v)}
            >
              <IconScissors className="h-4 w-4" />
              {editing ? t("recordingPage.done") : t("recordingPage.edit")}
            </Button>
          ) : null}

          {canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  {t("recordingPage.aiTools")}
                  <IconChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>
                  {t("recordingPage.enhanceRecording")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={regenerateTitle.isPending}
                  onSelect={() =>
                    regenerateTitle.mutate({
                      recordingId: recording.id,
                    } as any)
                  }
                >
                  {t("recordingPage.regenerateTitle")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={regenerateSummary.isPending}
                  onSelect={() =>
                    regenerateSummary.mutate({
                      recordingId: recording.id,
                    } as any)
                  }
                >
                  {t("recordingPage.regenerateDescription")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={regenerateChapters.isPending}
                  onSelect={() =>
                    regenerateChapters.mutate({
                      recordingId: recording.id,
                    } as any)
                  }
                >
                  {t("recordingPage.autoChapters")}
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
                  {t("recordingPage.removeFillerWords")}
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
                  {t("recordingPage.removeSilences")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {WORKFLOW_MENU_ITEMS.map((item) => {
                  const menuItem = (
                    <DropdownMenuItem
                      key={item.kind}
                      disabled={generateWorkflow.isPending}
                      onSelect={() => handleGenerateWorkflow(item.kind)}
                      className={
                        item.tooltipKey ? "justify-between gap-3" : undefined
                      }
                    >
                      <span>{t(item.labelKey)}</span>
                      {item.tooltipKey ? (
                        <IconHelpCircle
                          aria-hidden="true"
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                        />
                      ) : null}
                    </DropdownMenuItem>
                  );

                  if (!item.tooltipKey) {
                    return menuItem;
                  }

                  return (
                    <Tooltip key={item.kind}>
                      <TooltipTrigger asChild>{menuItem}</TooltipTrigger>
                      <TooltipContent
                        side="left"
                        className="max-w-64 text-xs leading-5"
                      >
                        {t(item.tooltipKey)}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {!editing ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 xl:hidden"
              onClick={() => {
                setPanel("agent");
                setSidePanelOpen(true);
              }}
              aria-label={t("recordingPage.askAboutClip")}
            >
              <IconMessageDots className="h-4 w-4" />
              <span>{t("recordingPage.agent")}</span>
            </Button>
          ) : null}

          <ShareRecordingPopover
            recordingId={recording.id}
            recordingTitle={recording.title}
            videoUrl={recording.videoUrl}
            animatedThumbnailUrl={recording.animatedThumbnailUrl}
            isLoomRecording={isLoomEmbedBacked}
            hasPassword={Boolean(recording.hasPassword)}
          >
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5"
              size="sm"
            >
              <IconShare3 className="h-4 w-4" />
              {t("recordingPage.share")}
            </Button>
          </ShareRecordingPopover>

          {canDelete || canDownloadRecording ? (
            <RecordingOptionsMenu
              recordingId={recording.id}
              canDelete={canDelete}
              canDownload={canDownloadRecording}
              downloadPending={downloading}
              onDownload={() => {
                void downloadRecording();
              }}
              onDeleted={() => navigate("/library", { replace: true })}
            />
          ) : null}
        </header>

        <div
          className={cn(
            "flex-1 flex flex-col overflow-hidden",
            editing && canUseNativeEditor ? "min-h-0" : "p-4 gap-4",
          )}
        >
          {editing && canUseNativeEditor ? (
            <EditorLayout recordingId={recording.id} className="flex-1" />
          ) : (
            <>
              <div className="flex-1 min-h-0 relative">
                <VideoPlayer
                  ref={playerRef}
                  recordingId={recording.id}
                  videoUrl={recording.videoUrl}
                  embedProvider={isLoomEmbedBacked ? "loom" : null}
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
                {commentOpen ? (
                  <TimestampedCommentBar
                    recordingId={recording.id}
                    atMs={commentAtMs}
                    onClose={() => setCommentOpen(false)}
                    onAdded={() => {
                      setPanel("comments");
                      if (isCompactLayout) setSidePanelOpen(true);
                      void playerDataQ.refetch();
                    }}
                  />
                ) : null}
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
                        {t("recordingPage.fromMeeting")}
                      </span>
                      <span className="font-medium truncate max-w-[240px]">
                        {playerDataQ.data.meeting.title ||
                          t("recordingPage.untitled")}
                      </span>
                    </NavLink>
                  ) : null}
                  <TimestampedCommentButton
                    enableComments={recording.enableComments}
                    onOpen={() => {
                      setCommentAtMs(resolvePlaybackMs());
                      setCommentOpen(true);
                    }}
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
                      const liveMs = resolvePlaybackMs();
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
        <>
          {isCompactLayout ? (
            <Sheet open={sidePanelOpen} onOpenChange={setSidePanelOpen}>
              <SheetContent
                side="right"
                className="flex h-full w-[calc(100vw-24px)] max-w-[420px] flex-col gap-0 p-0 sm:max-w-[420px]"
              >
                <SheetTitle className="sr-only">
                  {t("recordingPage.details")}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  {t("recordingPage.askAboutClip")}
                </SheetDescription>
                {renderSidePanel(true)}
              </SheetContent>
            </Sheet>
          ) : null}
          {!isCompactLayout ? (
            <aside className="hidden w-[380px] shrink-0 flex-col border-s border-border bg-background xl:flex">
              {renderSidePanel()}
            </aside>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function GeneratedWorkflowNotice({
  workflow,
}: {
  workflow: GeneratedWorkflowState;
}) {
  const [copied, setCopied] = useState(false);
  const status = workflow.status ?? (workflow.content ? "ready" : "generating");
  const content =
    typeof workflow.content === "string" ? workflow.content.trim() : "";
  const isReady = status === "ready" && content.length > 0;
  const isFailed = status === "failed";
  const title = workflowTitle(workflow.kind);

  async function handleCopy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success(`${title} copied`);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy generated output");
    }
  }

  return (
    <div className="bg-background px-3 py-2.5">
      <div className="overflow-hidden rounded-md border border-border bg-muted/20">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
              {isReady ? (
                <IconFileText className="h-3.5 w-3.5" />
              ) : (
                <IconSparkles className="h-3.5 w-3.5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">
                {title}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {isReady
                  ? "Generated from this clip"
                  : isFailed
                    ? workflow.error ||
                      "The agent could not finish this output."
                    : "The agent is writing this output now."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge
              variant={
                isFailed ? "destructive" : isReady ? "secondary" : "outline"
              }
              className="px-1.5 py-0 text-[10px] font-medium"
            >
              {workflowStatusLabel(status, isReady)}
            </Badge>
            {content ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={handleCopy}
              >
                <IconClipboardCopy className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy"}
              </Button>
            ) : null}
          </div>
        </div>
        {content ? (
          <div className="max-h-48 overflow-auto px-3 py-2">
            <div className="whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
              {content}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            {isFailed ? null : <Spinner className="h-3.5 w-3.5" />}
            <span>
              {isFailed
                ? workflow.error || "No generated output was saved."
                : "Generated output will appear here when it is ready."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function workflowTitle(kind: GeneratedWorkflowState["kind"]) {
  switch (kind) {
    case "pr":
      return "Generated PR Summary";
    case "sop":
      return "Generated SOP";
    case "ticket":
      return "Generated Ticket";
    case "email":
      return "Generated Email";
    default:
      return "Generated Output";
  }
}

function workflowStatusLabel(status: string, isReady: boolean) {
  if (isReady) return "Ready";
  if (status === "failed") return "Failed";
  return "Generating";
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function displayRecordingTitle(title: string | null | undefined): string {
  return isDefaultTitle(title) ? "Untitled Clip" : (title ?? "").trim();
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

function shouldShowGeneratedTitleSkeleton(
  recording: { title: string | null | undefined; createdAt?: string | null },
  transcriptStatus?: string,
  options: { titleGenerationPaused?: boolean } = {},
): boolean {
  if (options.titleGenerationPaused) return false;
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

function BuilderCreditsTitleNotice({ className }: { className?: string }) {
  const t = useT();
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-md border border-amber-300/70 bg-amber-50/80 px-2 py-1 text-[11px] leading-4 text-amber-950 shadow-sm dark:border-amber-400/30 dark:bg-amber-950/25 dark:text-amber-100",
        className,
      )}
    >
      <IconSparkles className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-200" />
      <span className="min-w-0 truncate">
        {t("builderCredits.titleDescription")}
      </span>
      <a
        href={BUILDER_CREDITS_UPGRADE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-2 hover:underline"
      >
        {t("builderCredits.upgrade")}
        <IconExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
