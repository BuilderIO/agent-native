import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@agent-native/toolkit/ui/avatar";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@agent-native/toolkit/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconCopy,
  IconDeviceDesktop,
  IconDots,
  IconEdit,
  IconExternalLink,
  IconLoader2,
  IconNotes,
  IconShare3,
  IconTrash,
  IconUsers,
  IconWand,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { CaptureInstallButton } from "@/components/capture-install-options";
import { PageHeader } from "@/components/library/page-header";
import {
  AttendeeStack,
  attendeeInitials,
  type AttendeeStackParticipant,
} from "@/components/meetings/attendee-stack";
import { BulletLink } from "@/components/meetings/bullet-link";
import { CanvasEditor } from "@/components/meetings/canvas-editor";
import { QuickAskSidebar } from "@/components/meetings/quick-ask-sidebar";
import { ShareMeetingPopover } from "@/components/meetings/share-meeting-dialog";
import {
  TranscriptBubbles,
  type TranscriptSegment,
} from "@/components/meetings/transcript-bubbles";
import { useDesktopPromo } from "@/hooks/use-desktop-promo";
import enMessages from "@/i18n/en-US";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: enMessages.meetingDetailRoute.pageTitle }];
}

interface ActionItem {
  id?: string;
  text: string;
  assigneeEmail?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
}

type Participant = AttendeeStackParticipant;

interface Bullet {
  text: string;
}

interface Meeting {
  id: string;
  title: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  platform?: string;
  joinUrl?: string | null;
  recordingId?: string | null;
  recordingDurationMs?: number | null;
  transcriptStatus?: "pending" | "ready" | "failed" | "in_progress" | string;
  summaryMd?: string | null;
  userNotesMd?: string | null;
  bulletsJson?: Bullet[] | null;
  actionItemsJson?: ActionItem[] | null;
  segmentsJson?: TranscriptSegment[] | null;
  participants?: Participant[];
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatDurationMs(ms?: number | null): string {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function TitleEditor({
  value,
  onChange,
  compact = false,
  readOnly = false,
}: {
  value: string;
  onChange: (next: string) => void;
  compact?: boolean;
  readOnly?: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const textCls = compact
    ? "text-base font-semibold tracking-tight truncate"
    : "text-2xl font-semibold tracking-tight";
  const editIconCls = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  if (readOnly) {
    return (
      <h1 className={cn(textCls, "min-w-0")}>
        {value || t("meetingDetail.untitledMeeting")}
      </h1>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex min-w-0 items-center gap-2 text-left cursor-pointer"
      >
        <h1 className={textCls}>
          {value || t("meetingDetail.untitledMeeting")}
        </h1>
        <IconEdit
          className={cn(
            editIconCls,
            "shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100",
          )}
        />
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== value) {
      onChange(draft.trim());
    } else {
      setDraft(value);
    }
  };

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={cn(
        textCls,
        "bg-transparent outline-none border-b border-primary/40 focus:border-primary min-w-0 w-full",
      )}
    />
  );
}

function ActionItemsByPerson({
  items,
  onToggle,
  readOnly = false,
}: {
  items: ActionItem[];
  onToggle: (index: number, completed: boolean) => void;
  readOnly?: boolean;
}) {
  // Preserve original index for toggle callback while grouping.
  const grouped = useMemo(() => {
    const map = new Map<string, Array<{ item: ActionItem; index: number }>>();
    items.forEach((it, index) => {
      const key = it.assigneeEmail || "Unassigned";
      const arr = map.get(key) ?? [];
      arr.push({ item: it, index });
      map.set(key, arr);
    });
    const entries = Array.from(map.entries());
    entries.sort(([a], [b]) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    });
    return entries;
  }, [items]);

  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      {grouped.map(([who, list]) => (
        <div key={who} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Avatar className="h-5 w-5">
              <AvatarImage alt={who} />
              <AvatarFallback className="text-[9px]">
                {attendeeInitials(who)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium">{who}</span>
            <span className="text-[10px] text-muted-foreground">
              {list.filter((x) => x.item.completedAt).length}/{list.length}
            </span>
          </div>
          <ul className="space-y-1 pl-7">
            {list.map(({ item: it, index }) => {
              const done = !!it.completedAt;
              return (
                <li
                  key={
                    it.id ?? `${it.assigneeEmail ?? "?"}:${it.text}:${index}`
                  }
                  className="flex items-start gap-2 text-xs leading-relaxed"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    disabled={readOnly}
                    onClick={() => {
                      if (!readOnly) onToggle(index, !done);
                    }}
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center transition-colors",
                      readOnly ? "cursor-default" : "cursor-pointer",
                      done
                        ? "bg-foreground border-foreground"
                        : readOnly
                          ? "border-border"
                          : "border-border hover:border-foreground/60",
                    )}
                  >
                    {done && (
                      <IconCheck className="h-2.5 w-2.5 text-background" />
                    )}
                  </button>
                  <span
                    className={cn(
                      "flex-1",
                      done && "line-through text-muted-foreground",
                    )}
                  >
                    {it.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function MeetingDetailRoute() {
  const t = useT();
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  type GetMeetingResp = {
    meeting?: Omit<Meeting, "participants" | "segmentsJson"> | null;
    participants?: Participant[];
    actionItems?: ActionItem[];
    transcript?: { segmentsJson?: TranscriptSegment[] | null } | null;
    recording?: { id: string; durationMs?: number | null } | null;
    role?: "owner" | "admin" | "editor" | "viewer";
  };

  const { data, isLoading, isError } = useActionQuery<GetMeetingResp>(
    "get-meeting",
    { id: meetingId },
    {
      retry: false,
      enabled: !!meetingId,
      refetchInterval: (query) => {
        const resp = query.state.data as GetMeetingResp | undefined;
        const m = resp?.meeting;
        const isLive =
          m?.actualStart && !m?.actualEnd
            ? true
            : m?.transcriptStatus === "in_progress";
        return isLive ? 2_000 : false;
      },
    },
  );

  const updateMeeting = useActionMutation<any, any>("update-meeting");
  const deleteMeeting = useActionMutation<any, any>("delete-meeting");
  const finalize = useActionMutation<any, any>("finalize-meeting");
  const { isDesktopApp } = useDesktopPromo();
  const [notesJustArrived, setNotesJustArrived] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const previousHasNotesRef = useRef(false);
  const autoFinalizedRef = useRef(false);

  // Imperative scroll-to handle wired by TranscriptBubbles
  const transcriptScrollToRef = useRef<((index: number) => void) | null>(null);

  const meeting: Meeting | undefined = useMemo(() => {
    if (!data?.meeting) return undefined;
    const safeArray = <T,>(v: unknown): T[] => {
      if (Array.isArray(v)) return v as T[];
      if (typeof v === "string") {
        try {
          const parsed = JSON.parse(v);
          return Array.isArray(parsed) ? (parsed as T[]) : [];
        } catch {
          return [];
        }
      }
      return [];
    };
    const segmentsRaw = data.transcript?.segmentsJson;
    return {
      ...data.meeting,
      participants: data.participants ?? [],
      bulletsJson: safeArray<Bullet>(data.meeting.bulletsJson),
      segmentsJson: segmentsRaw
        ? safeArray<TranscriptSegment>(segmentsRaw)
        : null,
      actionItemsJson:
        data.actionItems ?? safeArray<ActionItem>(data.meeting.actionItemsJson),
      recordingDurationMs: data.recording?.durationMs ?? null,
    } as Meeting;
  }, [data]);
  const isLive = !!(
    meeting &&
    ((meeting.actualStart && !meeting.actualEnd) ||
      meeting.transcriptStatus === "in_progress")
  );

  // Viewer-role shares are read-only: gate every edit affordance. Server
  // actions also enforce an `editor` minimum, so this is purely UX.
  const canEdit =
    data?.role === "owner" || data?.role === "admin" || data?.role === "editor";

  const hasNotes =
    !!meeting?.summaryMd ||
    !!meeting?.userNotesMd ||
    (meeting?.bulletsJson?.length ?? 0) > 0 ||
    (meeting?.actionItemsJson?.length ?? 0) > 0;

  // Recording is a native Clips desktop-app gesture (Granola-style), not an
  // in-browser capture. For an un-recorded, not-yet-past meeting we surface a
  // handoff to the desktop app. While the desktop records, this web view polls
  // and shows the live transcript it saves — no browser mic capture here.
  const meetingTimeMs = Date.parse(
    meeting?.scheduledEnd ?? meeting?.scheduledStart ?? "",
  );
  const isLongPast =
    !Number.isNaN(meetingTimeMs) && meetingTimeMs < Date.now() - 60 * 60 * 1000;
  const showDesktopRecordHint =
    !!meeting &&
    !meeting.recordingId &&
    !hasNotes &&
    !isLive &&
    !meeting.actualEnd &&
    !isLongPast;

  useEffect(() => {
    if (hasNotes && !previousHasNotesRef.current) {
      setNotesJustArrived(true);
      const t = setTimeout(() => setNotesJustArrived(false), 700);
      return () => clearTimeout(t);
    }
    previousHasNotesRef.current = hasNotes;
  }, [hasNotes]);

  const patchCachedMeeting = (
    patch: Partial<Meeting> & { actionItemsJson?: ActionItem[] },
  ) => {
    qc.setQueryData<GetMeetingResp | undefined>(
      ["action", "get-meeting", { id: meetingId }],
      (prev) => {
        if (!prev?.meeting) return prev;
        const { actionItemsJson, ...rest } = patch;
        return {
          ...prev,
          meeting: { ...prev.meeting, ...rest },
          actionItems:
            actionItemsJson !== undefined ? actionItemsJson : prev.actionItems,
        };
      },
    );
  };

  const handleTitleChange = (next: string) => {
    if (!meeting) return;
    patchCachedMeeting({ title: next });
    updateMeeting.mutate({ id: meeting.id, title: next });
  };

  const handleSummaryChange = (next: string) => {
    if (!meeting) return;
    patchCachedMeeting({ summaryMd: next });
    updateMeeting.mutate({ id: meeting.id, summaryMd: next });
  };

  const handleUserNotesChange = (next: string) => {
    if (!meeting) return;
    patchCachedMeeting({ userNotesMd: next });
    updateMeeting.mutate({ id: meeting.id, userNotesMd: next });
  };

  const handleToggleActionItem = (index: number, completed: boolean) => {
    if (!meeting) return;
    const items = meeting.actionItemsJson ?? [];
    const next = items.map((it, i) =>
      i === index
        ? { ...it, completedAt: completed ? new Date().toISOString() : null }
        : it,
    );
    patchCachedMeeting({ actionItemsJson: next });
    updateMeeting.mutate({
      id: meeting.id,
      actionItemsJson: JSON.stringify(next),
    });
  };

  const handleSeek = (ms: number) => {
    if (!meeting?.recordingId) return;
    if (typeof window !== "undefined") {
      window.location.assign(`/r/${meeting.recordingId}?t=${ms}`);
    }
  };

  const handleJumpToSegment = (segmentIndex: number) => {
    transcriptScrollToRef.current?.(segmentIndex);
  };

  const handleFinalize = () => {
    if (!meeting) return;
    // "My notes" (userNotesMd) is a separate field and is untouched by
    // regeneration; only the AI summary/bullets are overwritten. Reassure
    // the user their own notes are kept.
    if (hasNotes) {
      toast.info(t("meetingDetail.regeneratingNotes"));
    }
    autoFinalizedRef.current = true;
    finalize.mutate({ meetingId: meeting.id });
  };

  const handleDeleteMeeting = () => {
    if (!meeting) return;
    deleteMeeting.mutate(
      { id: meeting.id },
      {
        onSuccess: () => {
          toast.success(t("meetingDetail.meetingRemoved"));
          qc.invalidateQueries({ queryKey: ["action", "list-meetings"] });
          navigate("/meetings", { replace: true });
        },
        onError: (err: unknown) => {
          toast.error(
            err instanceof Error
              ? err.message
              : t("meetingDetail.couldNotRemoveMeeting"),
          );
        },
      },
    );
  };

  // Auto-generate notes once the transcript is ready and no notes yet.
  // Depend on primitives only — the `meeting` object identity changes on every
  // 2s poll, which would otherwise re-run this effect needlessly.
  const meetingIdForFinalize = meeting?.id;
  const transcriptStatusForFinalize = meeting?.transcriptStatus;
  useEffect(() => {
    if (!canEdit) return; // viewers can't finalize — would 403
    if (!meetingIdForFinalize) return;
    if (autoFinalizedRef.current) return;
    if (hasNotes) return;
    if (finalize.isPending) return;
    if (transcriptStatusForFinalize !== "ready") return;
    autoFinalizedRef.current = true;
    finalize.mutate({ meetingId: meetingIdForFinalize });
  }, [
    canEdit,
    meetingIdForFinalize,
    transcriptStatusForFinalize,
    hasNotes,
    finalize,
  ]);

  if (isLoading || !meeting) {
    return (
      <div className="p-6 max-w-6xl mx-auto w-full">
        <Skeleton className="h-6 w-32 mb-4" />
        <Skeleton className="h-9 w-96 mb-2" />
        <Skeleton className="h-4 w-64 mb-6" />
        <div className="clips-meeting-detail-skeleton-grid grid grid-cols-1 gap-6">
          <Skeleton className="h-[480px] w-full" />
          <Skeleton className="h-[480px] w-full" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 max-w-2xl mx-auto w-full">
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {t("meetingDetail.couldNotLoadMeeting")}
        </div>
      </div>
    );
  }

  const bullets = meeting.bulletsJson ?? [];
  const actionItems = meeting.actionItemsJson ?? [];
  const segments = meeting.segmentsJson ?? [];
  const recordingDuration = formatDurationMs(meeting.recordingDurationMs);

  const handleCopyTranscript = async () => {
    if (!segments.length) return;
    const text = segments
      .map((s) => {
        const label = s.speaker || (s.source === "system" ? "Them" : "Me");
        return `${label}: ${s.text}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setTranscriptCopied(true);
      toast.success(t("meetingDetail.transcriptCopied"));
      setTimeout(() => setTranscriptCopied(false), 1500);
    } catch {
      toast.error(t("meetingDetail.couldNotCopyTranscript"));
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto w-full flex flex-col min-h-0 flex-1">
      <PageHeader>
        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink
              to="/meetings"
              aria-label={t("meetingDetail.allMeetings")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              <IconArrowLeft className="h-4 w-4" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent>{t("meetingDetail.allMeetings")}</TooltipContent>
        </Tooltip>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TitleEditor
            value={meeting.title || ""}
            onChange={handleTitleChange}
            compact
            readOnly={!canEdit}
          />
          {isLive && (
            <Badge
              variant="secondary"
              className="bg-red-500/10 text-red-600 border-red-500/20 gap-1.5 px-2 shrink-0"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
              </span>
              Live
            </Badge>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!canEdit ? null : finalize.isPending ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              {t("meetingDetail.generatingNotesInline")}
            </span>
          ) : hasNotes ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleFinalize}
              className="cursor-pointer h-8"
            >
              {t("meetingDetail.regenerateNotes")}
            </Button>
          ) : null}
          <ShareMeetingPopover
            meetingId={meeting.id}
            meetingTitle={meeting.title}
          >
            <Button size="sm" className="shrink-0 gap-1.5">
              <IconShare3 className="h-4 w-4" />
              {t("meetingDetail.share")}
            </Button>
          </ShareMeetingPopover>
          {canEdit && (
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 cursor-pointer"
                    aria-label={t("meetingDetail.meetingOptions")}
                  >
                    <IconDots className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setDeleteOpen(true);
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <IconTrash className="mr-2 h-4 w-4" />
                    {t("meetingDetail.removeMeeting")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("meetingDetail.removeThisMeeting")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("meetingDetail.removeDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleteMeeting.isPending}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      handleDeleteMeeting();
                    }}
                    disabled={deleteMeeting.isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleteMeeting.isPending
                      ? t("meetingDetail.removing")
                      : t("meetingDetail.remove")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </PageHeader>

      {showDesktopRecordHint && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-accent/20 px-3 py-2.5">
          <IconDeviceDesktop className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm">{t("meetingDetail.desktopHint")}</span>
          {!isDesktopApp && (
            <CaptureInstallButton
              size="sm"
              variant="secondary"
              className="ml-auto h-8 gap-1.5 cursor-pointer"
            >
              <IconExternalLink className="h-3.5 w-3.5" />
              {t("meetingDetail.getDesktopApp")}
            </CaptureInstallButton>
          )}
        </div>
      )}

      {finalize.isError && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {(finalize.error as Error)?.message ||
            t("meetingDetail.generateNotesFailed")}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-6 shrink-0">
        <span className="inline-flex items-center gap-1">
          <IconClock className="h-3.5 w-3.5" />
          {formatDateTime(meeting.scheduledStart)}
        </span>
        {(meeting.participants?.length ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <IconUsers className="h-3.5 w-3.5" />
            <AttendeeStack
              participants={meeting.participants ?? []}
              max={5}
              size="xs"
            />
            <span>
              {meeting.participants!.length} attendee
              {meeting.participants!.length === 1 ? "" : "s"}
            </span>
          </span>
        )}
        {meeting.joinUrl && !meeting.actualEnd && (
          <a
            href={meeting.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 hover:text-foreground hover:bg-accent/40 cursor-pointer"
          >
            <IconExternalLink className="h-3.5 w-3.5" />
            {t("meetingDetail.joinCall")}
          </a>
        )}
      </div>

      <div className="clips-meeting-detail-grid grid grid-cols-1 gap-6 flex-1 min-h-0">
        {/* Two-tone canvas: user notes (black) + AI summary/bullets (gray) */}
        <div
          className={cn(
            "clips-meeting-notes-panel rounded-lg border border-border bg-background min-h-[480px] overflow-hidden flex flex-col",
            notesJustArrived && "animate-in fade-in duration-500",
          )}
        >
          <Tabs
            defaultValue="notes"
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
              <TabsList className="h-8 gap-1 bg-transparent p-0">
                <TabsTrigger
                  value="notes"
                  className="h-7 px-2.5 text-xs data-[state=active]:bg-muted"
                >
                  {t("meetingDetail.myNotes")}
                </TabsTrigger>
                <TabsTrigger
                  value="ai"
                  className="h-7 gap-1 px-2.5 text-xs data-[state=active]:bg-muted"
                >
                  <IconWand className="h-3 w-3" />
                  {t("meetingDetail.aiNotes")}
                </TabsTrigger>
                <TabsTrigger
                  value="actions"
                  className="h-7 px-2.5 text-xs data-[state=active]:bg-muted"
                >
                  {t("meetingDetail.actionItems")}
                  {actionItems.length > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      {actionItems.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
              {finalize.isPending && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <IconLoader2 className="h-3 w-3 animate-spin" />
                  {t("meetingDetail.working")}
                </span>
              )}
            </div>

            <TabsContent
              value="notes"
              className="mt-0 min-h-0 flex-1 overflow-y-auto"
            >
              <CanvasEditor
                view="user"
                userNotesMd={meeting.userNotesMd ?? ""}
                onUserNotesChange={handleUserNotesChange}
                readOnly={!canEdit}
              />
            </TabsContent>

            <TabsContent
              value="ai"
              className="mt-0 min-h-0 flex-1 overflow-y-auto"
            >
              <CanvasEditor
                view="ai"
                summaryMd={meeting.summaryMd ?? ""}
                bullets={bullets.map((b) => b.text)}
                onSummaryChange={handleSummaryChange}
                readOnly={!canEdit}
                renderBullet={(b) => (
                  <BulletLink
                    bullet={b}
                    segments={segments}
                    onJumpTo={handleJumpToSegment}
                  >
                    <div className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                      <span>•</span>
                      <span className="flex-1">{b}</span>
                    </div>
                  </BulletLink>
                )}
              />
            </TabsContent>

            <TabsContent
              value="actions"
              className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 py-4"
            >
              {actionItems.length > 0 ? (
                <ActionItemsByPerson
                  items={actionItems}
                  onToggle={handleToggleActionItem}
                  readOnly={!canEdit}
                />
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground/50 italic">
                  {t("meetingDetail.noActionItems")}
                </p>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Transcript pane — chat-bubble layout */}
        <div className="rounded-lg border border-border bg-background min-h-[480px] lg:min-h-0 overflow-hidden flex flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5 bg-background">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <IconNotes className="h-3.5 w-3.5" />
              {t("meetingDetail.transcript")}
            </div>
            <div className="flex items-center gap-2">
              {meeting.transcriptStatus === "ready" && (
                <span className="text-[10px] text-muted-foreground">
                  {t("meetingDetail.segments", {
                    count: segments.length,
                  })}
                </span>
              )}
              {segments.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 cursor-pointer"
                      aria-label={t("meetingDetail.copyTranscript")}
                      onClick={handleCopyTranscript}
                    >
                      {transcriptCopied ? (
                        <IconCheck className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <IconCopy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("meetingDetail.copyFullTranscript")}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          <TranscriptBubbles
            segments={segments}
            isLive={isLive}
            recordingId={meeting.recordingId}
            onSeek={handleSeek}
            registerScrollTo={(fn) => {
              transcriptScrollToRef.current = fn;
            }}
          />
        </div>
      </div>

      <QuickAskSidebar
        meetingId={meeting.id}
        meetingTitle={meeting.title}
        segments={segments}
      />
    </div>
  );
}
