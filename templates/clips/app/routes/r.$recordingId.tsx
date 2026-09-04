import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  useActionMutation,
  useActionQuery,
  useSession,
  getBrowserTabId,
  readClientAppState,
  writeClientAppState,
  useChangeVersions,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  buildSignInReturnHref,
  DefaultSpinner,
} from "@agent-native/core/client/ui";
import {
  isHumanReadableDocumentTitle,
  normalizeDocumentTitle,
} from "@agent-native/core/shared";
import { ShareCopyRow } from "@agent-native/toolkit/sharing";
import {
  BUILDER_CREDITS_UPGRADE_URL,
  type BuilderCreditsStatus,
} from "@shared/builder-credits";
import { isStoredButUnservableFinalizeError } from "@shared/finalize-recovery";
import {
  isLoomEmbedBackedRecording,
  isLoomRecordingSource,
} from "@shared/loom";
import {
  CLIP_SHARE_REF,
  DASHBOARD_REDIRECT_PARAM,
  DASHBOARD_REDIRECT_VALUE,
  REF_PARAM,
} from "@shared/share-attribution";
import type { WorkflowKind } from "@shared/workflow";
import {
  IconArrowLeft,
  IconCalendar,
  IconAlertTriangle,
  IconCheck,
  IconEdit,
  IconHelpCircle,
  IconBolt,
  IconMessage,
  IconExternalLink,
  IconFolder,
  IconMoodSmile,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Link,
  useParams,
  useNavigate,
  NavLink,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";

import { ClipsAvatar } from "@/components/clips-avatar";
import { EditableRecordingTitle } from "@/components/editable-recording-title";
import { EditorLayout } from "@/components/editor/editor-layout";
import { LibraryLayout } from "@/components/library/library-layout";
import { PageHeader } from "@/components/library/page-header";
import { useClipAgentWebMcp } from "@/components/player/clip-agent-webmcp";
import { ClipsShareTrigger } from "@/components/player/clips-share-trigger";
import {
  CommentsPanel,
  type Comment as PlayerComment,
} from "@/components/player/comments-panel";
import { RecordingOptionsMenu } from "@/components/player/delete-recording-menu";
import {
  REACTION_EMOJIS,
  REACTION_NAMES,
} from "@/components/player/reaction-emojis";
import { RecordingSidePanel } from "@/components/player/recording-side-panel";
import { RecordingViewsBadge } from "@/components/player/recording-views-badge";
import { SettingsPanel } from "@/components/player/settings-panel";
import { ShareRecordingPopover } from "@/components/player/share-dialog";
import { TimestampedCommentBar } from "@/components/player/timestamped-comment-button";
import { TranscriptPanel } from "@/components/player/transcript-panel";
import {
  VideoPlayer,
  type VideoPlayerHandle,
} from "@/components/player/video-player";
import {
  ViewerIconButton,
  ViewerSwitch,
  ViewerTabsList,
  ViewerTabsTrigger,
} from "@/components/player/viewer-controls";
import { StorageSetupCard } from "@/components/recorder/storage-setup-card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  isDefaultTitle,
  notifyAiRequestQueued,
  useAutoTitleBridge,
} from "@/hooks/use-auto-title";
import { useFolders, useSpaces } from "@/hooks/use-library";
import { usePlayerShortcuts } from "@/hooks/use-player-shortcuts";
import { useSonnerLifecycleToast } from "@/hooks/use-sonner-lifecycle-toast";
import { useViewTracking } from "@/hooks/use-view-tracking";
import enMessages from "@/i18n/en-US";
import { parsePlaybackSpeed } from "@/lib/playback-speed";
import { recordingShareUrl } from "@/lib/recording-link";
import { isStorageSetupFailureReason } from "@/lib/storage-failures";
import { parseTimeParam, resolveStartMs } from "@/lib/time-param";
import { cn } from "@/lib/utils";

import { buildAgentApiUrls } from "../../shared/agent-context";
import { STALE_PENDING_TRANSCRIPT_REASON } from "../../shared/transcript-status";

const UPLOAD_STUCK_TIMEOUT_MS = 5 * 60 * 1000;
const PROCESSING_STUCK_TIMEOUT_MS = 12 * 60 * 1000;
const READY_MEDIA_SETTLE_POLL_MS = 20 * 1000;
const READY_MEDIA_SETTLE_POLL_INTERVAL_MS = 1000;
const VIEWER_REDESIGN_PREVIEW_ID = "viewer-redesign-preview";

const VIEWER_PREVIEW_COMMENTS: PlayerComment[] = [
  {
    id: "preview-comment-1",
    threadId: "preview-thread-1",
    parentId: null,
    authorEmail: "maya@example.test",
    authorName: "Maya Chen",
    content: "The opening frame makes the product story immediately clear.",
    videoTimestampMs: 0,
    emojiReactionsJson:
      '{"👍":["alex@example.test"],"💡":["maya@example.test"]}',
    resolved: false,
    createdAt: "2026-09-01T15:20:00.000Z",
    updatedAt: "2026-09-01T15:20:00.000Z",
  },
  {
    id: "preview-comment-2",
    threadId: "preview-thread-2",
    parentId: null,
    authorEmail: "alex@example.test",
    authorName: "Alex Rivera",
    content:
      "Could we hold this dashboard view for another beat before moving to the next section?",
    videoTimestampMs: 420,
    emojiReactionsJson: '{"👍":["maya@example.test","jordan@example.test"]}',
    resolved: false,
    createdAt: "2026-09-01T15:08:00.000Z",
    updatedAt: "2026-09-01T15:08:00.000Z",
  },
  {
    id: "preview-comment-2-reply-1",
    threadId: "preview-thread-2",
    parentId: "preview-comment-2",
    authorEmail: "jordan@example.test",
    authorName: "Jordan Lee",
    content: "Agreed — the extra beat gives the labels time to land.",
    videoTimestampMs: 420,
    emojiReactionsJson: "{}",
    resolved: false,
    createdAt: "2026-09-01T15:11:00.000Z",
    updatedAt: "2026-09-01T15:11:00.000Z",
  },
  {
    id: "preview-comment-2-reply-2",
    threadId: "preview-thread-2",
    parentId: "preview-comment-2",
    authorEmail: "maya@example.test",
    authorName: "Maya Chen",
    content: "I’ll add that to the next cut.",
    videoTimestampMs: 420,
    emojiReactionsJson: "{}",
    resolved: true,
    createdAt: "2026-09-01T15:15:00.000Z",
    updatedAt: "2026-09-01T15:15:00.000Z",
  },
  {
    id: "preview-comment-3",
    threadId: "preview-thread-3",
    parentId: null,
    authorEmail: "sam@example.test",
    authorName: "Sam McClelland",
    content:
      "The contrast on the secondary labels is a little soft in the recording.",
    videoTimestampMs: 860,
    emojiReactionsJson: '{"👀":["alex@example.test"]}',
    resolved: false,
    createdAt: "2026-09-01T14:58:00.000Z",
    updatedAt: "2026-09-01T14:58:00.000Z",
  },
  {
    id: "preview-comment-4",
    threadId: "preview-thread-4",
    parentId: null,
    authorEmail: "jordan@example.test",
    authorName: "Jordan Lee",
    content:
      "This is the moment I would share with the team — it explains the why without extra setup.",
    videoTimestampMs: 1300,
    emojiReactionsJson: '{"❤️":["maya@example.test"]}',
    resolved: false,
    createdAt: "2026-09-01T14:42:00.000Z",
    updatedAt: "2026-09-01T14:42:00.000Z",
  },
  {
    id: "preview-comment-5",
    threadId: "preview-thread-5",
    parentId: null,
    authorEmail: "alex@example.test",
    authorName: "Alex Rivera",
    content:
      "Would a short chapter marker here make this easier to scan later?",
    videoTimestampMs: 1750,
    emojiReactionsJson: "{}",
    resolved: false,
    createdAt: "2026-09-01T14:36:00.000Z",
    updatedAt: "2026-09-01T14:36:00.000Z",
  },
  {
    id: "preview-comment-6",
    threadId: "preview-thread-6",
    parentId: null,
    authorEmail: "maya@example.test",
    authorName: "Maya Chen",
    content:
      "The relationship between the summary and transcript feels especially useful for agents.",
    videoTimestampMs: 2180,
    emojiReactionsJson: '{"🔥":["sam@example.test","jordan@example.test"]}',
    resolved: false,
    createdAt: "2026-09-01T14:24:00.000Z",
    updatedAt: "2026-09-01T14:24:00.000Z",
  },
  {
    id: "preview-comment-6-reply-1",
    threadId: "preview-thread-6",
    parentId: "preview-comment-6",
    authorEmail: "sam@example.test",
    authorName: "Sam McClelland",
    content: "Yes — that should be a first-class context affordance.",
    videoTimestampMs: 2180,
    emojiReactionsJson: "{}",
    resolved: false,
    createdAt: "2026-09-01T14:29:00.000Z",
    updatedAt: "2026-09-01T14:29:00.000Z",
  },
  {
    id: "preview-comment-7",
    threadId: "preview-thread-7",
    parentId: null,
    authorEmail: "jordan@example.test",
    authorName: "Jordan Lee",
    content:
      "I’d keep this control close to the timeline so it remains tied to the moment.",
    videoTimestampMs: 2620,
    emojiReactionsJson: "{}",
    resolved: true,
    createdAt: "2026-09-01T14:10:00.000Z",
    updatedAt: "2026-09-01T14:10:00.000Z",
  },
  {
    id: "preview-comment-8",
    threadId: "preview-thread-8",
    parentId: null,
    authorEmail: "sam@example.test",
    authorName: "Sam McClelland",
    content:
      "The final handoff should make the next action obvious: reply, share, or open the agent context.",
    videoTimestampMs: 3100,
    emojiReactionsJson: '{"👏":["alex@example.test"]}',
    resolved: false,
    createdAt: "2026-09-01T13:56:00.000Z",
    updatedAt: "2026-09-01T13:56:00.000Z",
  },
  {
    id: "preview-comment-9",
    threadId: "preview-thread-9",
    parentId: null,
    authorEmail: "alex@example.test",
    authorName: "Alex Rivera",
    content:
      "This would be a good place for a short response thread in a real review.",
    videoTimestampMs: 3620,
    emojiReactionsJson: "{}",
    resolved: false,
    createdAt: "2026-09-01T13:44:00.000Z",
    updatedAt: "2026-09-01T13:44:00.000Z",
  },
  {
    id: "preview-comment-10",
    threadId: "preview-thread-10",
    parentId: null,
    authorEmail: "maya@example.test",
    authorName: "Maya Chen",
    content:
      "The density feels right here: enough context to collaborate without turning the viewer into a dashboard.",
    videoTimestampMs: 4090,
    emojiReactionsJson: '{"👍":["jordan@example.test"]}',
    resolved: false,
    createdAt: "2026-09-01T13:31:00.000Z",
    updatedAt: "2026-09-01T13:31:00.000Z",
  },
  {
    id: "preview-comment-10-reply-1",
    threadId: "preview-thread-10",
    parentId: "preview-comment-10",
    authorEmail: "alex@example.test",
    authorName: "Alex Rivera",
    content: "Exactly. Progressive disclosure should do the rest.",
    videoTimestampMs: 4090,
    emojiReactionsJson: "{}",
    resolved: false,
    createdAt: "2026-09-01T13:35:00.000Z",
    updatedAt: "2026-09-01T13:35:00.000Z",
  },
  {
    id: "preview-comment-11",
    threadId: "preview-thread-11",
    parentId: null,
    authorEmail: "jordan@example.test",
    authorName: "Jordan Lee",
    content:
      "I’m adding one last note so we can validate the bottom-of-page scroll behavior.",
    videoTimestampMs: 4580,
    emojiReactionsJson: "{}",
    resolved: false,
    createdAt: "2026-09-01T13:18:00.000Z",
    updatedAt: "2026-09-01T13:18:00.000Z",
  },
];

type RecordingReaction = {
  id: string;
  emoji: string;
  videoTimestampMs: number;
};

type PendingRecordingReaction = RecordingReaction & {
  recordingId: string;
};

export function mergeRecordingReactions(
  serverReactions: RecordingReaction[] | undefined,
  pendingReactions: PendingRecordingReaction[],
  recordingId: string | undefined,
) {
  const seen = new Set<string>();
  const merged: RecordingReaction[] = [];
  const visiblePendingReactions = recordingId
    ? pendingReactions.filter(
        (reaction) => reaction.recordingId === recordingId,
      )
    : [];

  for (const reaction of [
    ...(serverReactions ?? []),
    ...visiblePendingReactions,
  ]) {
    const key = `${reaction.id}:${reaction.emoji}:${reaction.videoTimestampMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(reaction);
  }

  return merged;
}

export function removePendingReaction(
  pendingReactions: PendingRecordingReaction[],
  pendingId: string,
) {
  return pendingReactions.filter((reaction) => reaction.id !== pendingId);
}

export function handleReactionWrite(
  response: { ok: boolean; status: number },
  refresh: () => Promise<unknown>,
) {
  if (!response.ok) throw new Error(`react failed: ${response.status}`);
  // The write is authoritative. A transient read failure must not tell the
  // player that the reaction failed.
  void Promise.resolve()
    .then(refresh)
    .catch((refreshError) => {
      console.warn("[clips] reaction refresh failed", refreshError);
    });
  return true;
}

export function meta() {
  return [{ title: enMessages.recordingRoute.pageTitle }];
}

type SidePanel = "transcript" | "comments" | "settings";
type ToolbarPanel = Exclude<SidePanel, "comments">;

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
  status?: "generating" | "ready" | "failed" | (string & {});
  content?: string;
  recordingId?: string;
  requestedAt?: string;
  error?: string;
}

interface SilenceRemovalStatus {
  kind?: "remove-silences";
  status?: "queued" | "working" | "completed" | "failed";
  message?: string | null;
  updatedAt?: string;
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

export function BackButton({ onBack }: { onBack: () => void }) {
  const t = useT();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ViewerIconButton
          variant="ghost"
          className="shrink-0"
          onClick={onBack}
          aria-label={t("recordingPage.backToLibrary")}
        >
          <IconArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
        </ViewerIconButton>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        {t("recordingPage.backToLibrary")}
      </TooltipContent>
    </Tooltip>
  );
}

export default function RecordingPage() {
  const t = useT();
  useAutoTitleBridge();

  const { recordingId } = useParams<{ recordingId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const startMs = parseTimeParam(
    searchParams.get("at") ?? searchParams.get("t"),
  );
  const panelParam = searchParams.get("panel");
  const { session, isLoading: sessionLoading } = useSession();
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const commentsSectionRef = useRef<HTMLElement | null>(null);

  const [panel, setPanel] = useState<SidePanel | null>("transcript");
  const [theaterMode, setTheaterMode] = useState(false);
  const [editing, setEditing] = useState(false);
  const [currentMs, setCurrentMs] = useState(startMs);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentAtMs, setCommentAtMs] = useState(0);
  const [commentDraft, setCommentDraft] = useState("");
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const isCompactLayout = useIsCompactRecordingLayout();
  // The compact layout stacks the panel below the video, so switching tabs
  // alone leaves the user looking at the player. Desktop opens the rail beside
  // the player, so nothing needs to scroll there.
  const openSidePanel = useCallback(
    (next: ToolbarPanel) => {
      setPanel(next);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("panel", next);
      setSearchParams(nextParams, { replace: true });
      if (!isCompactLayout) return;
      requestAnimationFrame(() => {
        document
          .getElementById("clip-activity-panel")
          ?.scrollIntoView({ block: "start" });
      });
    },
    [isCompactLayout, searchParams, setSearchParams],
  );
  const openCommentsPanel = useCallback(() => {
    setPanel("comments");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("panel", "comments");
    setSearchParams(nextParams, { replace: true });
    requestAnimationFrame(() => {
      commentsSectionRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }, [searchParams, setSearchParams]);
  const openGlobalAgentPanel = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("agent-panel:set-mode", { detail: { mode: "chat" } }),
    );
    window.dispatchEvent(new Event("agent-panel:open"));
  }, []);
  const transcriptKickedRef = useRef<string | null>(null);
  // When the recording lands in the processing state but never flips to
  // 'ready', stop spinning forever and surface an error banner so the user
  // can retry or report the issue instead of staring at a spinner.
  const [processingTimeout, setProcessingTimeout] = useState(false);
  const [retryingFinalize, setRetryingFinalize] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const browserTabId = useMemo(() => getBrowserTabId(), []);
  const queryClient = useQueryClient();
  const lastPlayerStateWriteRef = useRef(0);
  const readyMediaPollRef = useRef<{ key: string; until: number } | null>(null);
  const [metadataRefreshUntil, setMetadataRefreshUntil] = useState(0);
  const [pendingReactions, setPendingReactions] = useState<
    PendingRecordingReaction[]
  >([]);

  const playerDataQ = useActionQuery<any>(
    "get-recording-player-data",
    {
      recordingId: recordingId ?? "",
    },
    {
      // `/r/*` is intentionally reachable before auth so signed-out visitors
      // can see the sign-in state. Do not send the protected action until the
      // browser has finished resolving the session, or an authenticated viewer
      // can be rendered as signed out from the initial 403.
      enabled: !!recordingId && !sessionLoading,
      refetchInterval: (q) => {
        const data = q.state.data as any;
        const rec = data?.recording;
        if (!rec) return false;
        // Poll while the recording is still being assembled / transcoded so
        // the page auto-upgrades from "Processing" to the real player the
        // moment the server flips status to 'ready' and writes videoUrl.
        if (rec.status !== "ready" || !rec.videoUrl) {
          readyMediaPollRef.current = null;
          return 1000;
        }
        if (rec.seekableRepairPending === true) {
          readyMediaPollRef.current = null;
          return READY_MEDIA_SETTLE_POLL_INTERVAL_MS;
        }
        // Fresh streaming uploads can become `ready` before the background
        // seekable/faststart repair swaps in the final player URL. Keep polling
        // briefly so the first post-recording page catches that URL update
        // without requiring a manual refresh.
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
        if (now < readyMediaPollRef.current.until) {
          return READY_MEDIA_SETTLE_POLL_INTERVAL_MS;
        }
        // Also keep polling while a transcript is pending so "Transcribing…"
        // auto-flips to the ready transcript (or to the failure card).
        if (data?.transcript?.status === "pending") return 3000;
        // And keep polling while the title is still the server-seeded
        // default — the agent will land a generated title via
        // `update-recording` and we want the skeleton to swap in promptly.
        if (shouldShowGeneratedTitleSkeleton(rec, data?.transcript?.status))
          return 3000;
        if (Date.now() < metadataRefreshUntil) return 2000;
        return false;
      },
    },
  );

  const playerDataAccessStatus = playerDataQ.isError
    ? (playerDataQ.error as { status?: number } | undefined)?.status
    : undefined;
  // Signed-out requests never even reach `resolveAccess` — the action route's
  // default auth gate rejects them with 401 first. Authenticated viewers with
  // no share grant (or a deleted/mismatched id) get 403 from `resolveAccess`
  // inside `get-recording-player-data`. Both mean "can't open the direct
  // owner/editor route here".
  const playerDataForbidden =
    playerDataAccessStatus === 401 || playerDataAccessStatus === 403;

  // A direct `/r/:id` visit without edit/view access (signed out, no share
  // grant, wrong org) can't do anything useful here — send the visitor to the
  // public share flow instead, which knows how to prompt for sign-in or a
  // password.
  useEffect(() => {
    if (!recordingId || !playerDataForbidden) return;
    const shareParams = new URLSearchParams();
    shareParams.set(REF_PARAM, CLIP_SHARE_REF);
    shareParams.set(DASHBOARD_REDIRECT_PARAM, DASHBOARD_REDIRECT_VALUE);
    void navigate(
      `/share/${encodeURIComponent(recordingId)}?${shareParams.toString()}`,
      {
        replace: true,
      },
    );
  }, [recordingId, playerDataForbidden, navigate]);

  const recording = playerDataQ.data?.recording;
  const {
    error: failProcessingToast,
    start: startProcessingToast,
    success: completeProcessingToast,
  } = useSonnerLifecycleToast();
  const lifecyclePhaseRef = useRef<
    "failed" | "processing" | "ready" | "uploading" | null
  >(null);

  useEffect(() => {
    if (!recording) return;
    const phase =
      recording.status === "ready"
        ? recording.videoUrl
          ? "ready"
          : "processing"
        : recording.status;
    const previousPhase = lifecyclePhaseRef.current;
    if (phase === "uploading") {
      startProcessingToast(t("recordingPage.uploadingAssembling"));
    } else if (phase === "processing") {
      startProcessingToast(t("recordingPage.finishingClip"));
    } else if (
      phase === "ready" &&
      previousPhase &&
      previousPhase !== "ready"
    ) {
      completeProcessingToast(t("recordRoute.recordingSaved"));
    } else if (
      phase === "failed" &&
      previousPhase &&
      previousPhase !== "failed"
    ) {
      failProcessingToast(t("recordingPage.savingWentWrong"));
    }
    lifecyclePhaseRef.current = phase;
  }, [
    completeProcessingToast,
    failProcessingToast,
    recording?.id,
    recording?.status,
    recording?.videoUrl,
    startProcessingToast,
    t,
  ]);
  const hierarchyEnabled = Boolean(session && recording?.organizationId);
  const { data: hierarchyFolders } = useFolders(
    { organizationId: recording?.organizationId },
    { enabled: hierarchyEnabled },
  );
  const { data: hierarchySpaces } = useSpaces(recording?.organizationId, {
    enabled: hierarchyEnabled,
  });
  const recordingFolder = useMemo(
    () =>
      (hierarchyFolders?.folders ?? []).find(
        (folder: any) => folder.id === recording?.folderId,
      ),
    [hierarchyFolders?.folders, recording?.folderId],
  );
  const recordingSpace = useMemo(() => {
    const spaceId = recordingFolder?.spaceId ?? recording?.spaceIds?.[0];
    return (hierarchySpaces?.spaces ?? []).find(
      (space: any) => space.id === spaceId,
    );
  }, [hierarchySpaces?.spaces, recording?.spaceIds, recordingFolder?.spaceId]);
  const playbackMs = resolveStartMs(currentMs, recording?.durationMs);
  // Resolve the playback position for reactions/comments. Native <video> exposes
  // a live `currentTime`; Loom embeds render in a cross-origin iframe with no
  // live time bridge, so we fall back to the last position the player reported
  // via onTimeUpdate (seek/initial start).
  const resolvePlaybackMs = useCallback(() => {
    return playerRef.current?.getCurrentOriginalMs() ?? playbackMs;
  }, [playbackMs]);
  const verificationPending = recording?.verificationPending === true;
  const role = playerDataQ.data?.role as
    | "owner"
    | "admin"
    | "editor"
    | "commenter"
    | "viewer"
    | undefined;
  const directAgentContextUrl = useMemo(() => {
    if (
      typeof window === "undefined" ||
      !recording?.id ||
      (recording.visibility !== "public" && role !== "owner")
    ) {
      return null;
    }
    return buildAgentApiUrls(recording.id, {
      origin: window.location.origin,
      basePath: appBasePath(),
    }).contextUrl;
  }, [recording?.id, recording?.visibility, role]);
  useClipAgentWebMcp({
    recordingId: recording?.id ?? "",
    agentContextUrl: directAgentContextUrl,
    recordingStatus: recording?.status,
    frameAvailable: !isLoomEmbedBackedRecording(recording),
  });
  const comments =
    recordingId === VIEWER_REDESIGN_PREVIEW_ID
      ? VIEWER_PREVIEW_COMMENTS
      : (playerDataQ.data?.comments ?? []);
  const reactions = useMemo(
    () =>
      mergeRecordingReactions(
        playerDataQ.data?.reactions,
        pendingReactions,
        recordingId,
      ),
    [pendingReactions, playerDataQ.data?.reactions, recordingId],
  );
  const chapters = playerDataQ.data?.chapters ?? [];
  const transcriptSegments = playerDataQ.data?.transcript?.segments ?? [];
  const transcriptFullText = playerDataQ.data?.transcript?.fullText ?? null;
  const transcriptStatus = playerDataQ.data?.transcript?.status;
  const transcriptFailureReason = playerDataQ.data?.transcript?.failureReason;
  const ctas = playerDataQ.data?.ctas ?? [];
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  // Reaching this page already requires a signed-in session with at least
  // viewer access to the recording, so any resolved role qualifies to
  // comment/react — no separate "commenter" tier.
  const canComment = role != null;
  useEffect(() => {
    if (!canEdit && panel === "settings") {
      setPanel("transcript");
    }
  }, [canEdit, panel]);

  useEffect(() => {
    if (panelParam === "comments") {
      setPanel("comments");
      requestAnimationFrame(() => {
        commentsSectionRef.current?.scrollIntoView({ block: "start" });
      });
      return;
    }
    if (
      (panelParam === "transcript" ||
        panelParam === "insights" ||
        panelParam === "settings") &&
      (panelParam !== "settings" || canEdit)
    ) {
      setPanel(panelParam === "insights" ? "transcript" : panelParam);
    }
  }, [canEdit, panelParam]);

  useEffect(() => {
    if (panelParam !== "agent" || !session || !recording?.id) return;
    setPanel("transcript");
    const timeout = window.setTimeout(openGlobalAgentPanel, 0);
    return () => window.clearTimeout(timeout);
  }, [openGlobalAgentPanel, panelParam, recording?.id, session]);

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
  const recordingBreadcrumb = (
    <Breadcrumb aria-label={t("navigation.library")} className="min-w-0">
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        <BreadcrumbItem className="shrink-0">
          <BreadcrumbLink asChild>
            <NavLink to="/library">{t("navigation.library")}</NavLink>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {recordingSpace ? (
          <>
            <BreadcrumbSeparator className="shrink-0" />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbLink asChild>
                <NavLink
                  to={`/spaces/${recordingSpace.id}`}
                  className="truncate"
                >
                  {recordingSpace.name}
                </NavLink>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </>
        ) : null}
        {recordingFolder ? (
          <>
            <BreadcrumbSeparator className="shrink-0" />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbLink asChild>
                <NavLink
                  to={
                    recordingFolder.spaceId
                      ? `/spaces/${recordingFolder.spaceId}/folder/${recordingFolder.id}`
                      : `/library/folder/${recordingFolder.id}`
                  }
                  className="flex min-w-0 items-center gap-1.5"
                >
                  <IconFolder className="size-4 shrink-0" />
                  <span className="truncate">{recordingFolder.name}</span>
                </NavLink>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </>
        ) : null}
        <BreadcrumbSeparator className="shrink-0" />
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="truncate">{visibleTitle}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
  // Attribution `via` must never point at someone who isn't the owner, so it
  // is only tagged when the viewer is the owner (same rule as the share dialog).
  const shareViaId =
    role === "owner" ? (session?.userId ?? undefined) : undefined;
  const pendingShareUrl = useMemo(() => {
    if (!recordingId || typeof window === "undefined") return "";
    return recordingShareUrl(recordingId, shareViaId);
  }, [recordingId, shareViaId]);
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
        currentMs: Math.round(playbackMs),
        durationMs: recording.durationMs,
        panel,
        updatedAt: new Date(now).toISOString(),
      },
      { requestSource: browserTabId },
    ).catch(() => {});
  }, [browserTabId, panel, playbackMs, recording?.durationMs, recording?.id]);
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
  const silenceRemovalStatusQ = useQuery<SilenceRemovalStatus | null>({
    queryKey: [
      "app-state",
      "clips-ai-request-status",
      recording?.id ?? "",
      appStateVersion,
    ],
    enabled: Boolean(recording?.id),
    placeholderData: (previous) => previous,
    refetchInterval: (query) =>
      query.state.data?.status === "queued" ||
      query.state.data?.status === "working"
        ? 2000
        : false,
    queryFn: async ({ signal }) => {
      if (!recording?.id) return null;
      return readClientAppState<SilenceRemovalStatus>(
        `clips-ai-request-status-${recording.id}`,
        { signal },
      );
    },
  });
  const generatedWorkflow =
    generatedWorkflowQ.data?.recordingId === recording?.id
      ? generatedWorkflowQ.data
      : null;
  const silenceRemovalStatus =
    silenceRemovalStatusQ.data?.kind === "remove-silences"
      ? silenceRemovalStatusQ.data
      : null;

  const isLoomEmbedBacked = isLoomEmbedBackedRecording(recording);
  const isLoomRecording = isLoomRecordingSource(recording);
  const canUseNativeEditor = canEdit && !isLoomEmbedBacked;
  const canDelete = role === "owner";
  const canDownloadRecording = Boolean(
    recording?.enableDownloads && recording.videoUrl && !isLoomEmbedBacked,
  );
  // Mirrors the /share/:shareId reshare restriction (same public/org scope):
  // a plain viewer of a public or org clip must not trigger
  // `list-resource-shares` (any read access is enough to call it, and its
  // response includes every individually-shared principal's email) or see a
  // raw video download/open action independent of `enableDownloads`.
  const viewerReshareOnly =
    (role === "viewer" || role === "commenter") &&
    (recording?.visibility === "public" || recording?.visibility === "org");
  const isPrivateRecipient =
    (role === "viewer" || role === "commenter") &&
    recording?.visibility === "private";
  const shareVideoUrl =
    canDownloadRecording || isLoomEmbedBacked
      ? (recording?.videoUrl ?? null)
      : null;
  const renderShareControl = () => (
    <ShareRecordingPopover
      recordingId={recording.id}
      recordingTitle={recording.title}
      initialVisibility={recording.visibility}
      initialRole={role}
      videoUrl={shareVideoUrl}
      thumbnailUrl={recording.thumbnailUrl}
      animatedThumbnailUrl={recording.animatedThumbnailUrl}
      isLoomRecording={isLoomEmbedBacked}
      hasPassword={Boolean(recording.hasPassword)}
      expiresAt={recording.expiresAt}
      viewerReshareOnly={viewerReshareOnly}
    >
      <ClipsShareTrigger label={t("recordingPage.share")} />
    </ShareRecordingPopover>
  );
  const downloadRecording = useCallback(async () => {
    if (!recording?.videoUrl) return;
    setDownloading(true);
    const downloadToastId = toast.loading(t("sharePage.downloading"));
    try {
      const res = await fetch(recording.videoUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const extension =
        blob.type.includes("webm") || recording.videoFormat === "webm"
          ? "webm"
          : "mp4";
      a.download = `${sanitizeFilename(recording.title || "clip")}.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(recording.videoUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
      toast.dismiss(downloadToastId);
    }
  }, [recording?.title, recording?.videoFormat, recording?.videoUrl, t]);
  const retryFinalizeAfterStorage = useCallback(async () => {
    if (!recordingId) return;
    setRetryingFinalize(true);
    setProcessingTimeout(false);
    try {
      const isUrlImportRetry =
        isLoomRecording ||
        recording?.sourceAppName?.trim().toLowerCase() === "video link";
      const actionPath = isUrlImportRetry
        ? "/_agent-native/actions/import-loom-recording"
        : "/_agent-native/actions/finalize-recording";
      if (isUrlImportRetry && !recording?.sourceWindowTitle) {
        throw new Error(t("recordingPage.loomMissingUrl"));
      }
      const res = await fetch(agentNativePath(actionPath), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isUrlImportRetry
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
      if (isUrlImportRetry && result?.status === "processing") {
        // Download + reupload now run as a background job; this request only
        // confirms the retry was accepted, not that the clip is ready yet.
        toast.info(t("recordingPage.importingLoom"));
        return;
      }
      toast.success(
        isUrlImportRetry
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
  const requestTranscript = useActionMutation("request-transcript" as any, {
    onSuccess: (result: any) => {
      void playerDataQ.refetch();
      if (result?.queued) toast.success(t("transcriptPanel.transcribing"));
    },
    onError: (err: Error) =>
      toast.error(
        t("recordingPage.retryFailed", {
          message: err?.message ?? t("recordingPage.networkError"),
        }),
      ),
  });
  const regenerateTitle = useActionMutation("regenerate-title" as any, {
    onSuccess: (result: any) => {
      if (result?.queued === true && recording?.id) {
        notifyAiRequestQueued(recording.id);
      }
      setMetadataRefreshUntil(Date.now() + 60_000);
      void playerDataQ.refetch();
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
    onSuccess: (result: any) => {
      if (result?.queued === true && recording?.id) {
        notifyAiRequestQueued(recording.id);
      }
      setMetadataRefreshUntil(Date.now() + 60_000);
      void playerDataQ.refetch();
      toast.success(t("recordingPage.descriptionQueued"));
    },
    onError: handleAiError,
  });
  const regenerateChapters = useActionMutation("regenerate-chapters" as any, {
    onSuccess: (result: any) => {
      if (result?.queued === true && recording?.id) {
        notifyAiRequestQueued(recording.id);
      }
      toast.success(t("recordingPage.chapterQueued"));
    },
    onError: handleAiError,
  });
  const removeFillerWords = useActionMutation("remove-filler-words" as any, {
    onSuccess: (result: any) => {
      if (result?.queued === true && recording?.id) {
        notifyAiRequestQueued(recording.id);
      }
      toast.success(t("recordingPage.fillerQueued"));
    },
    onError: handleAiError,
  });
  const removeSilences = useActionMutation("remove-silences" as any, {
    onSuccess: (result: any) => {
      if (result?.queued === true && recording?.id) {
        notifyAiRequestQueued(recording.id);
      }
      toast.success(t("recordingPage.silenceQueued"));
      void silenceRemovalStatusQ.refetch();
    },
    onError: handleAiError,
  });
  const silenceRemovalBusy =
    removeSilences.isPending ||
    silenceRemovalStatus?.status === "queued" ||
    silenceRemovalStatus?.status === "working";
  const generateWorkflow = useActionMutation("generate-workflow" as any, {
    onSuccess: (result: any) => {
      if (result?.queued === true && recording?.id) {
        notifyAiRequestQueued(recording.id);
      }
      toast.success(t("recordingPage.workflowQueued"));
      void generatedWorkflowQ.refetch();
    },
    onError: handleAiError,
  });
  const aiPrefsQ = useActionQuery<{ includeFullVideoInAi?: boolean }>(
    "get-clips-ai-prefs" as any,
    undefined,
    { retry: false },
  );
  const updateAiPrefs = useActionMutation("update-clips-ai-prefs" as any, {
    onError: handleAiError,
  });
  const [includeFullVideoOverride, setIncludeFullVideoOverride] = useState<
    boolean | null
  >(null);
  const includeFullVideoInAi =
    includeFullVideoOverride ?? aiPrefsQ.data?.includeFullVideoInAi === true;
  function handleIncludeFullVideoChange(checked: boolean) {
    setIncludeFullVideoOverride(checked);
    updateAiPrefs.mutate({ includeFullVideoInAi: checked } as any, {
      onSuccess: () => {
        void aiPrefsQ.refetch().finally(() => {
          setIncludeFullVideoOverride(null);
        });
        toast.success(
          checked
            ? t("recordingPage.includeFullVideoOn")
            : t("recordingPage.includeFullVideoOff"),
        );
      },
      onError: () => {
        setIncludeFullVideoOverride(null);
      },
    });
  }
  function handleGenerateWorkflow(kind: WorkflowKind) {
    if (!recording) return;
    if (generatedWorkflow?.status === "generating") return;
    setEditing(false);
    openGlobalAgentPanel();
    generateWorkflow.mutate({
      recordingId: recording.id,
      kind,
      openInChat: true,
    } as any);
  }

  const workflowBusy =
    generateWorkflow.isPending || generatedWorkflow?.status === "generating";

  useEffect(() => {
    if (recording && panel === "settings" && !canEdit) setPanel("transcript");
  }, [canEdit, panel, recording]);

  useEffect(() => {
    if (!canUseNativeEditor && editing) setEditing(false);
  }, [canUseNativeEditor, editing]);

  useEffect(() => {
    if (!recording) return;
    if (
      isDefaultTitle(recording.title) ||
      !isHumanReadableDocumentTitle(recording.title)
    ) {
      document.title = t("recordingPage.pageTitle");
      return;
    }
    document.title = `${normalizeDocumentTitle(
      recording.title,
      t("recordingPage.pageTitle"),
    )} · Clips`;
  }, [recording?.title, t]);

  // Self-heal stuck transcripts. Older recordings (before finalize-recording
  // learned to auto-trigger transcription) can sit in `pending` forever with no
  // worker to pick them up. A stale pending presentation gets a forced retry so
  // a transient worker/provider failure does not require a manual click.
  useEffect(() => {
    if (!recording) return;
    if (role !== "owner" && role !== "admin" && role !== "editor") return;
    if (recording.status !== "ready") return;
    const stalePending =
      transcriptStatus === "failed" &&
      transcriptFailureReason === STALE_PENDING_TRANSCRIPT_REASON;
    if (transcriptStatus !== "pending" && !stalePending) return;
    const recoveryKey = `${recording.id}:${stalePending ? "stale" : "pending"}`;
    if (transcriptKickedRef.current === recoveryKey) return;
    transcriptKickedRef.current = recoveryKey;
    fetch(agentNativePath("/_agent-native/actions/request-transcript"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recordingId: recording.id,
        ...(stalePending ? { force: true } : {}),
      }),
    })
      .catch(() => {})
      .finally(() => playerDataQ.refetch());
  }, [
    recording?.id,
    recording?.status,
    transcriptStatus,
    transcriptFailureReason,
    role,
    playerDataQ,
  ]);

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
    if (verificationPending) {
      setProcessingTimeout(false);
      return;
    }
    const timeoutMs =
      recording.status === "processing"
        ? PROCESSING_STUCK_TIMEOUT_MS
        : UPLOAD_STUCK_TIMEOUT_MS;
    const handle = setTimeout(() => setProcessingTimeout(true), timeoutMs);
    return () => clearTimeout(handle);
  }, [
    recording?.status,
    recording?.videoUrl,
    recordingId,
    verificationPending,
  ]);

  usePlayerShortcuts({ playerRef, chapters });

  const [trackedVideoEl, setTrackedVideoEl] = useState<HTMLVideoElement | null>(
    null,
  );

  const tracking = useViewTracking({
    recordingId: recordingId ?? "",
    videoEl: trackedVideoEl,
    durationMs: recording?.durationMs ?? 0,
    disabled: role === "owner", // Skip tracking for the owner: they shouldn't inflate their own views.
  });

  if (!recordingId) return null;

  if (playerDataQ.isLoading || playerDataForbidden) {
    return <DefaultSpinner />;
  }

  if (playerDataQ.isError || !recording) {
    const needsSignIn = !session;
    const returnTo =
      typeof window === "undefined"
        ? `/r/${recordingId}`
        : window.location.pathname + window.location.search;
    if (sessionLoading) {
      return <DefaultSpinner />;
    }
    return (
      <div className="flex flex-col items-center justify-center h-screen w-full bg-background px-6">
        <h1 className="text-xl font-semibold mb-2">
          {needsSignIn
            ? t("sharePage.clipUnavailable")
            : t("recordingPage.recordingNotFound")}
        </h1>
        <p className="text-sm text-muted-foreground mb-4">
          {needsSignIn
            ? t("sharePage.clipUnavailableMessage")
            : ((playerDataQ.error as Error | undefined)?.message ??
              t("recordingPage.noAccess"))}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {needsSignIn ? (
            <Button asChild>
              <a href={buildSignInReturnHref({ returnTo })}>
                {t("sharePage.signIn")}
              </a>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link to="/library" replace>
              {t("recordingPage.backToLibrary")}
            </Link>
          </Button>
        </div>
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
    const storedButUnservableFailure =
      isStoredButUnservableFinalizeError(rawFailureReason);
    const loomStorageSetupFailure = waitingForStorage && isLoomRecording;
    const nativeSaveFailed =
      searchParams.get("saveFailed") === "1" ||
      isNativeSaveFailureReason(rawFailureReason);
    // Give a long-running desktop save an actionable recovery state without
    // claiming the upload failed while its bounded final request is still live.
    const stuckFailure =
      !explicitFailure && !verificationPending && processingTimeout;
    const isFailure = explicitFailure || waitingForStorage || nativeSaveFailed;
    const showRecoveryState = isFailure || stuckFailure;
    const displayReason = explicitFailure
      ? storedButUnservableFailure
        ? t("recordingPage.clipDataPreserved")
        : (rawFailureReason ?? t("recordingPage.retryLibrary"))
      : nativeSaveFailed
        ? nativeSaveFailureMessage(rawFailureReason)
        : stuckFailure
          ? t("recordingPage.processingStuck", { status: recording.status })
          : t("recordingPage.uploadingAssembling");
    const storageSetupFailure = waitingForStorage;
    const canRetryFinalize = storageSetupFailure || storedButUnservableFailure;
    const label = storageSetupFailure
      ? loomStorageSetupFailure
        ? t("recordingPage.connectStorageImportLoom")
        : t("recordingPage.connectStorageFinishClip")
      : nativeSaveFailed
        ? t("recordingPage.uploadPausedSaved")
        : stuckFailure
          ? t("recordingPage.finishingClip")
          : isFailure
            ? t("recordingPage.savingWentWrong")
            : t("recordingPage.finishingClip");
    const failureReason = storageSetupFailure
      ? loomStorageSetupFailure
        ? t("recordingPage.loomSourcePreserved")
        : t("recordingPage.clipDataPreserved")
      : displayReason;
    const detail = failureDetail(rawFailureReason);
    if (!showRecoveryState) {
      const processingView = (
        <div
          className={cn(
            "flex w-full flex-col bg-background",
            session ? "h-full min-h-0" : "min-h-screen",
          )}
        >
          {session ? (
            <PageHeader>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="min-w-0 flex-1">{recordingBreadcrumb}</div>
                {isPrivateRecipient ? (
                  <span className="shrink-0 whitespace-nowrap text-sm font-medium text-muted-foreground">
                    {t("recordingPage.sharedWithYou")}
                  </span>
                ) : (
                  renderShareControl()
                )}
              </div>
            </PageHeader>
          ) : (
            <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-2 sm:px-4 sm:py-3">
              <BackButton
                onBack={() => navigate("/library", { replace: true })}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{visibleTitle}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {recording.ownerEmail}
                  {recording.visibility !== "private" ? (
                    <> · {capitalize(recording.visibility)}</>
                  ) : null}
                </p>
              </div>
              {isPrivateRecipient ? (
                <span className="shrink-0 whitespace-nowrap text-sm font-medium text-muted-foreground">
                  {t("recordingPage.sharedWithYou")}
                </span>
              ) : (
                renderShareControl()
              )}
            </header>
          )}

          <main
            className={cn(
              "mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 p-4 sm:p-6",
              session && "min-h-0 overflow-y-auto",
            )}
          >
            <div className="relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-xl bg-foreground">
              <div className="flex flex-col items-center gap-3 text-center text-background">
                <Spinner className="size-8" />
                <p className="text-sm font-medium">
                  {t("recordingPage.finishingClip")}
                </p>
              </div>
            </div>

            <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
              <p className="text-center text-sm text-muted-foreground">
                {t("recordingPage.uploadingAssembling")}
              </p>
              {progress > 0 ? (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-foreground transition-[width]"
                    style={{
                      width: `${Math.min(100, Math.max(0, progress))}%`,
                    }}
                  />
                </div>
              ) : null}
              <ShareCopyRow
                value={pendingShareUrl}
                label={t("shareDialog.shareLink")}
                copyLabel={t("shareUi.copy")}
                copiedLabel={t("bugReportRoute.copied")}
                onCopy={writeClipboardText}
                className="rounded-lg border border-border bg-muted/30 p-2 ps-3"
              />
            </div>
          </main>
        </div>
      );

      return session ? (
        <LibraryLayout>{processingView}</LibraryLayout>
      ) : (
        processingView
      );
    }
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
        {isFailure && !storageSetupFailure && detail && role && canEdit ? (
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
              if (canRetryFinalize) {
                void retryFinalizeAfterStorage();
                return;
              }
              setProcessingTimeout(false);
              void playerDataQ.refetch();
            }}
            variant="outline"
            size="sm"
            disabled={retryingFinalize}
          >
            {canRetryFinalize
              ? loomStorageSetupFailure
                ? t("recordingPage.retryImport")
                : t("recordingPage.retryUpload")
              : t("recordingPage.checkAgain")}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/library" replace>
              {t("recordingPage.backToLibrary")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const renderPanelTabs = () => (
    <ViewerTabsList className="min-w-0 shrink-0 bg-sidebar">
      {isCompactLayout ? (
        <ViewerTabsTrigger value="comments">
          {t("playerSettings.comments")}
        </ViewerTabsTrigger>
      ) : null}
      <ViewerTabsTrigger value="transcript">
        {t("recordingPage.transcript")}
      </ViewerTabsTrigger>
      {canEdit ? (
        <ViewerTabsTrigger value="settings">
          {t("recordingPage.settings")}
        </ViewerTabsTrigger>
      ) : null}
    </ViewerTabsList>
  );

  const renderCommentsSection = (compact = false) => (
    <section
      ref={commentsSectionRef}
      className={cn(
        "scroll-mt-14",
        compact
          ? "flex min-h-0 flex-1 flex-col px-4 pb-5 pt-4"
          : "flex min-h-0 flex-1 flex-col px-1 pb-5 pt-4",
      )}
    >
      {!compact ? (
        <h2 className="mb-3 shrink-0 text-sm font-semibold">
          {t("playerSettings.comments")}
        </h2>
      ) : null}
      <CommentsPanel
        recordingId={recording.id}
        comments={comments}
        currentMs={playbackMs}
        getCurrentMs={resolvePlaybackMs}
        currentUserEmail={session?.email}
        currentUserName={session?.name}
        enableComments={recording.enableComments}
        canComment={canComment}
        onSeek={(ms) => playerRef.current?.seek(ms)}
        queryKey={[
          "action",
          "get-recording-player-data",
          { recordingId: recordingId ?? "" },
        ]}
        presentation="inline"
      />
    </section>
  );

  const renderSidePanel = () => {
    return (
      <>
        <TabsContent
          value="transcript"
          className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden"
        >
          <TranscriptPanel
            segments={transcriptSegments}
            fullText={transcriptFullText}
            durationMs={recording.durationMs}
            currentMs={playbackMs}
            onSeek={(ms) => playerRef.current?.seek(ms)}
            status={
              requestTranscript.isPending && transcriptStatus === "failed"
                ? "pending"
                : transcriptStatus
            }
            failureReason={transcriptFailureReason}
            recordingTitle={recording.title}
            onRetry={
              canEdit
                ? () =>
                    requestTranscript.mutate({
                      recordingId: recording.id,
                      force: true,
                    } as any)
                : undefined
            }
            onRegenerate={
              canEdit && transcriptStatus === "ready"
                ? () =>
                    requestTranscript.mutate({
                      recordingId: recording.id,
                      force: true,
                      regenerate: true,
                    } as any)
                : undefined
            }
            isRegenerating={requestTranscript.isPending}
          />
        </TabsContent>
        {canEdit ? (
          <TabsContent
            value="settings"
            className="mt-0 flex flex-1 min-h-0 flex-col data-[state=inactive]:hidden"
          >
            <SettingsPanel
              recording={recording}
              ctas={ctas}
              onClose={() => setPanel("transcript")}
              onRefetch={() => playerDataQ.refetch()}
              showHeader={false}
            />
          </TabsContent>
        ) : null}
      </>
    );
  };

  const recordingActions = (
    <div className="flex shrink-0 items-center gap-2">
      {!editing ? (
        <RecordingViewsBadge
          recordingId={recording.id}
          recordingTitle={recording.title}
          viewCount={playerDataQ.data?.viewCount ?? 0}
          reactionCount={reactions.length}
          durationMs={recording.durationMs}
          defaultOpen={canEdit && panelParam === "insights"}
          canViewDetails={canEdit}
          className="shrink-0 border-0 shadow-none"
        />
      ) : null}

      <div className="flex items-center gap-2">
        {canUseNativeEditor && editing ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <ViewerIconButton
                variant="secondary"
                onClick={() => setEditing(false)}
                aria-label={t("recordingPage.done")}
              >
                <IconCheck className="size-4" />
              </ViewerIconButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t("recordingPage.done")}
            </TooltipContent>
          </Tooltip>
        ) : null}

        {!editing && recording.enableReactions ? (
          <Popover
            open={reactionPickerOpen}
            onOpenChange={setReactionPickerOpen}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canComment}
                className="h-8 gap-1.5 px-2 text-xs"
              >
                <IconMoodSmile className="size-4" />
                {t("recordingPage.react")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="center" className="w-auto p-1.5">
              <div className="flex items-center gap-0.5">
                {REACTION_EMOJIS.map((emoji) => (
                  <Button
                    key={emoji}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full text-lg"
                    aria-label={`${t("recordingPage.react")} ${REACTION_NAMES[emoji]}`}
                    onClick={() => {
                      setReactionPickerOpen(false);
                      tracking.reportReaction(emoji);
                      const liveMs = resolvePlaybackMs();
                      const pendingReaction: PendingRecordingReaction = {
                        id: `pending-${Date.now()}-${Math.random()
                          .toString(36)
                          .slice(2)}`,
                        emoji,
                        videoTimestampMs: liveMs,
                        recordingId: recording.id,
                      };
                      setPendingReactions((current) => [
                        ...current,
                        pendingReaction,
                      ]);
                      void fetch(
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
                        .then((res) => {
                          return handleReactionWrite(res, () =>
                            Promise.all([
                              queryClient.invalidateQueries({
                                queryKey: [
                                  "action",
                                  "get-recording-player-data",
                                ],
                              }),
                              playerDataQ.refetch(),
                            ]),
                          );
                        })
                        .catch((err) => {
                          console.warn("[clips] react failed", err);
                        })
                        .finally(() => {
                          setPendingReactions((current) =>
                            removePendingReaction(current, pendingReaction.id),
                          );
                        });
                    }}
                  >
                    {emoji}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}

        {canEdit && !editing ? (
          <RecordingOptionsMenu
            recordingId={recording.id}
            canDelete={canDelete}
            canDownload={canDownloadRecording}
            downloadPending={downloading}
            onDownload={() => void downloadRecording()}
            onDeleted={() => navigate("/library", { replace: true })}
          >
            {canUseNativeEditor ? (
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <IconEdit className="size-4" />
                {t("recordingPage.edit")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={openGlobalAgentPanel}>
              <IconMessage className="h-4 w-4" />
              {t("recordingPage.askAboutClip")}
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
              disabled={silenceRemovalBusy}
              onSelect={() =>
                removeSilences.mutate({
                  recordingId: recording.id,
                  thresholdMs: 1200,
                } as any)
              }
            >
              {t("recordingPage.removeSilences")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={regenerateChapters.isPending}
              onSelect={() =>
                regenerateChapters.mutate({
                  recordingId: recording.id,
                  openInChat: true,
                } as any)
              }
            >
              {t("recordingPage.autoChapters")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={regenerateSummary.isPending}
              onSelect={() =>
                regenerateSummary.mutate({
                  recordingId: recording.id,
                  openInChat: true,
                } as any)
              }
            >
              {t("recordingPage.regenerateDescription")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {t("recordingPage.enhanceRecording")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuItem
                  disabled={requestTranscript.isPending}
                  onSelect={() =>
                    requestTranscript.mutate({
                      recordingId: recording.id,
                      force: true,
                      regenerate: true,
                    } as any)
                  }
                >
                  {requestTranscript.isPending ? (
                    <Spinner className="size-4" />
                  ) : null}
                  {t("transcriptPanel.regenerate")}
                </DropdownMenuItem>
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {t("recordingPage.createFromClip")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {WORKFLOW_MENU_ITEMS.map((item) => {
                  const menuItem = (
                    <DropdownMenuItem
                      key={item.kind}
                      disabled={workflowBusy}
                      onSelect={() => handleGenerateWorkflow(item.kind)}
                      className={
                        item.tooltipKey ? "justify-between gap-3" : undefined
                      }
                    >
                      <span>{t(item.labelKey)}</span>
                      {item.tooltipKey ? (
                        // guard:allow-large-help-icon - menu item tooltip icon
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={aiPrefsQ.isLoading || updateAiPrefs.isPending}
              onSelect={(event) => {
                event.preventDefault();
                handleIncludeFullVideoChange(!includeFullVideoInAi);
              }}
              title={t("recordingPage.includeFullVideoDescription")}
              className="justify-between gap-3"
            >
              <span>{t("recordingPage.includeFullVideo")}</span>
              <ViewerSwitch
                checked={includeFullVideoInAi}
                disabled={aiPrefsQ.isLoading || updateAiPrefs.isPending}
                tabIndex={-1}
                aria-hidden="true"
                className="pointer-events-none"
              />
            </DropdownMenuItem>
          </RecordingOptionsMenu>
        ) : null}

        {!editing && !canEdit && (canDelete || canDownloadRecording) ? (
          <RecordingOptionsMenu
            recordingId={recording.id}
            canDelete={canDelete}
            canDownload={canDownloadRecording}
            downloadPending={downloading}
            onDownload={() => void downloadRecording()}
            onDeleted={() => navigate("/library", { replace: true })}
          />
        ) : null}
      </div>
    </div>
  );

  const ownerInitial = recording.ownerEmail.trim().charAt(0).toUpperCase();
  const recordedOn = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(recording.createdAt));

  const viewer = (
    <>
      {session ? (
        <PageHeader>
          {recordingBreadcrumb}
          {!editing ? (
            isPrivateRecipient ? (
              <span className="ms-auto shrink-0 whitespace-nowrap text-sm font-medium text-muted-foreground">
                {t("recordingPage.sharedWithYou")}
              </span>
            ) : (
              <div className="ms-auto flex shrink-0 items-center">
                {renderShareControl()}
              </div>
            )
          ) : null}
        </PageHeader>
      ) : null}
      <Tabs
        value={panel ?? "comments"}
        onValueChange={(value) => {
          if (value === "comments") {
            openCommentsPanel();
            return;
          }
          openSidePanel(value as ToolbarPanel);
        }}
        className={cn(
          "clips-recording-view grid w-full max-w-full grid-cols-1 overflow-x-hidden bg-background xl:grid-cols-[minmax(0,1fr)_auto] xl:overflow-hidden [&_.agent-composer-root]:!border-0 [&_.agent-composer-root]:!bg-background",
          session
            ? "h-full min-h-0 xl:grid-rows-[minmax(0,1fr)]"
            : "min-h-screen xl:h-screen xl:grid-rows-[2.5rem_minmax(0,1fr)]",
        )}
      >
        {/* Main video column */}
        <div className="contents">
          {!session ? (
            <header className="flex h-10 min-w-0 shrink-0 items-center gap-2 border-b border-border/70 bg-background px-3 sm:px-5 xl:col-span-2 xl:row-start-1">
              <BackButton
                onBack={
                  editing
                    ? () => setEditing(false)
                    : () => navigate("/library", { replace: true })
                }
              />
              <div className="flex-1 min-w-0">
                <EditableRecordingTitle
                  recordingId={recording.id}
                  title={recording.title}
                  canEdit={canEdit}
                  displayTitle={visibleTitle}
                  showPendingSkeleton={showTitleSkeleton}
                  className="text-sm font-semibold tracking-[-0.01em]"
                  inputClassName="h-7 text-sm font-medium"
                  skeletonClassName="h-4 w-56 max-w-full"
                />
                <p className="truncate text-xs text-muted-foreground">
                  {recording.ownerEmail}
                  {recording.visibility !== "private" ? (
                    <> · {capitalize(recording.visibility)}</>
                  ) : null}
                </p>
                {titleGenerationPaused ? (
                  <BuilderCreditsTitleNotice className="mt-2" />
                ) : null}
                {silenceRemovalStatus ? (
                  <div
                    className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    {silenceRemovalStatus.status === "queued" ||
                    silenceRemovalStatus.status === "working" ? (
                      <Spinner className="size-3" />
                    ) : null}
                    <span>
                      {silenceRemovalStatus.status === "queued"
                        ? t("recordingPage.silenceQueued")
                        : silenceRemovalStatus.status === "working"
                          ? t("recordingPage.silenceWorking", {
                              defaultValue: "Removing silences…",
                            })
                          : silenceRemovalStatus.status === "completed"
                            ? t("recordingPage.silenceCompleted", {
                                defaultValue: "Silence removal complete",
                              })
                            : t("recordingPage.silenceFailed", {
                                defaultValue: "Silence removal failed",
                              })}
                    </span>
                    {silenceRemovalStatus.message ? (
                      <span className="truncate">
                        · {silenceRemovalStatus.message}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {recordingActions}
            </header>
          ) : null}

          <div
            className={cn(
              "flex min-w-0 flex-col bg-background xl:col-start-1",
              session ? "xl:row-start-1" : "xl:row-start-2",
              editing && canUseNativeEditor
                ? "min-h-0 flex-1 overflow-hidden"
                : "gap-0 sm:gap-4 sm:px-5 sm:pb-5 sm:pt-4 xl:min-h-0 xl:flex-1 xl:overflow-hidden",
            )}
          >
            {editing && canUseNativeEditor ? (
              <EditorLayout recordingId={recording.id} className="flex-1" />
            ) : (
              <div className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-0 sm:gap-4 xl:max-w-[calc(177.778dvh-35.556rem)]">
                <div className="flex w-full shrink-0 justify-center">
                  {/* A 16:9 width derived from 100dvh - 20rem keeps the
                    recording context and start of the discussion in view on
                    displays that are both very wide and very tall. */}
                  <div className="relative aspect-video w-full overflow-hidden bg-card shadow-sm ring-1 ring-border sm:rounded-2xl">
                    <VideoPlayer
                      ref={playerRef}
                      onVideoElementChange={setTrackedVideoEl}
                      recordingId={recording.id}
                      videoUrl={recording.videoUrl}
                      mediaVersion={
                        recording.mediaUpdatedAt ??
                        recording.videoSizeBytes ??
                        null
                      }
                      videoFormat={recording.videoFormat}
                      embedProvider={isLoomEmbedBacked ? "loom" : null}
                      durationMs={recording.durationMs}
                      editsJson={recording.editsJson}
                      thumbnailUrl={recording.thumbnailUrl}
                      role={role}
                      defaultSpeed={
                        parsePlaybackSpeed(recording.defaultSpeed) ?? 1.2
                      }
                      alwaysShowControls
                      startMs={resolveStartMs(startMs, recording.durationMs)}
                      comments={comments}
                      chapters={chapters}
                      reactions={reactions}
                      transcriptSegments={transcriptSegments}
                      theaterMode={theaterMode}
                      onTheaterToggle={() => setTheaterMode((v) => !v)}
                      cta={firstCta}
                      onCtaClick={() => tracking.reportCtaClick()}
                      onTimeUpdate={(ms) => setCurrentMs(ms)}
                      onCommentClick={openCommentsPanel}
                      onFullscreenChange={setIsPlayerFullscreen}
                      enableComments={recording.enableComments}
                      onAddComment={() => {
                        // The inline conversation is outside the element the
                        // Fullscreen API paints, so keep the portal composer for
                        // fullscreen and move to the thread everywhere else.
                        const liveMs = resolvePlaybackMs();
                        setCurrentMs(liveMs);
                        if (!isPlayerFullscreen) {
                          openCommentsPanel();
                          return;
                        }
                        setCommentAtMs(liveMs);
                        setCommentOpen(true);
                      }}
                      enableReactions={recording.enableReactions}
                      onReact={(emoji) => {
                        tracking.reportReaction(emoji);
                        const liveMs = resolvePlaybackMs();
                        return fetch(
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
                          .then((res) => {
                            return handleReactionWrite(res, () =>
                              playerDataQ.refetch(),
                            );
                          })
                          .catch((err) => {
                            console.warn("[clips] react failed", err);
                            return false;
                          });
                      }}
                      className="h-full w-full rounded-none sm:rounded-2xl"
                    />
                    {commentOpen && canComment
                      ? (() => {
                          const composer = (
                            <TimestampedCommentBar
                              recordingId={recording.id}
                              atMs={commentAtMs}
                              draft={commentDraft}
                              onDraftChange={setCommentDraft}
                              onClose={() => setCommentOpen(false)}
                              onAdded={() => {
                                setPanel("comments");
                                void playerDataQ.refetch();
                              }}
                            />
                          );
                          // The Fullscreen API only paints the player's own
                          // element, so portal the composer there instead of
                          // exiting fullscreen when it's open.
                          const fullscreenContainer =
                            isPlayerFullscreen && playerRef.current?.container;
                          return fullscreenContainer
                            ? createPortal(composer, fullscreenContainer)
                            : composer;
                        })()
                      : null}
                  </div>
                </div>

                {/* Recording identity and engagement live with the recording,
                  rather than competing with workspace navigation. */}
                <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 sm:px-1">
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
                        !session && "sm:hidden",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <EditableRecordingTitle
                          recordingId={recording.id}
                          title={recording.title}
                          canEdit={canEdit}
                          displayTitle={visibleTitle}
                          showPendingSkeleton={showTitleSkeleton}
                          className="text-xl font-semibold leading-tight tracking-[-0.02em] sm:text-2xl"
                          inputClassName="h-9 text-xl font-semibold sm:text-2xl"
                          skeletonClassName="h-7 w-72 max-w-full"
                        />
                        <div className="mt-2 flex min-w-0 items-center gap-2">
                          <ClipsAvatar
                            email={recording.ownerEmail}
                            alt={recording.ownerEmail}
                            fallback={ownerInitial}
                            className="size-7 shrink-0"
                            fallbackClassName="bg-muted text-[10px] font-semibold text-muted-foreground"
                          />
                          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                            <bdi className="min-w-0 max-w-full truncate font-medium text-foreground">
                              {recording.ownerEmail}
                            </bdi>
                            <span aria-hidden="true">·</span>
                            <span>{recordedOn}</span>
                            {recording.visibility !== "private" ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{capitalize(recording.visibility)}</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                        {titleGenerationPaused ? (
                          <BuilderCreditsTitleNotice className="mt-2" />
                        ) : null}
                        {silenceRemovalStatus ? (
                          <div
                            className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
                            role="status"
                            aria-live="polite"
                          >
                            {silenceRemovalStatus.status === "queued" ||
                            silenceRemovalStatus.status === "working" ? (
                              <Spinner className="size-3" />
                            ) : null}
                            <span>
                              {silenceRemovalStatus.status === "queued"
                                ? t("recordingPage.silenceQueued")
                                : silenceRemovalStatus.status === "working"
                                  ? t("recordingPage.silenceWorking", {
                                      defaultValue: "Removing silences…",
                                    })
                                  : silenceRemovalStatus.status === "completed"
                                    ? t("recordingPage.silenceCompleted", {
                                        defaultValue:
                                          "Silence removal complete",
                                      })
                                    : t("recordingPage.silenceFailed", {
                                        defaultValue: "Silence removal failed",
                                      })}
                            </span>
                          </div>
                        ) : null}
                      </div>
                      {session ? recordingActions : null}
                    </div>
                    {/* G9 — "From meeting" badge surfaced when this recording is
                      attached to a meeting (server fix 6 attaches `meeting`). */}
                    {playerDataQ.data?.meeting ? (
                      <NavLink
                        to={`/meetings/${playerDataQ.data.meeting.id}`}
                        className="mb-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-accent/50 px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
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
                    {recording.description ? (
                      <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm leading-5">
                        <p
                          className={cn(
                            "max-w-4xl whitespace-pre-wrap break-words text-foreground/85",
                            !descriptionExpanded && "line-clamp-2",
                          )}
                        >
                          {recording.description}
                        </p>
                        {recording.description.length > 180 ? (
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="mt-1 h-auto p-0 text-xs font-medium text-foreground"
                            onClick={() =>
                              setDescriptionExpanded((expanded) => !expanded)
                            }
                          >
                            {descriptionExpanded
                              ? t("settings.collapse")
                              : t("shareDialog.more")}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                {isCompactLayout ? (
                  <RecordingSidePanel
                    id="clip-activity-panel"
                    className="mt-2 xl:hidden"
                    tabs={renderPanelTabs()}
                  >
                    {panel === "comments"
                      ? renderCommentsSection(true)
                      : renderSidePanel()}
                  </RecordingSidePanel>
                ) : (
                  renderCommentsSection()
                )}
              </div>
            )}
          </div>
        </div>

        {/* Side panel */}
        {!editing && !isCompactLayout && panel && panel !== "comments" ? (
          <RecordingSidePanel
            className={cn(
              "hidden xl:col-start-2 xl:flex xl:w-[420px] 2xl:w-[440px]",
              session ? "xl:row-start-1" : "xl:row-start-2",
            )}
            tabs={renderPanelTabs()}
          >
            {renderSidePanel()}
          </RecordingSidePanel>
        ) : null}
      </Tabs>
    </>
  );

  return session ? <LibraryLayout>{viewer}</LibraryLayout> : viewer;
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
      <IconBolt className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-200" />
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
