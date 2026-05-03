import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useParams } from "react-router";
import {
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconEdit,
  IconLoader2,
  IconNotes,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AttendeeStack,
  attendeeInitials,
  type AttendeeStackParticipant,
} from "@/components/meetings/attendee-stack";
import { PageHeader } from "@/components/library/page-header";
import {
  TranscriptBubbles,
  type TranscriptSegment,
} from "@/components/meetings/transcript-bubbles";
import { BulletLink } from "@/components/meetings/bullet-link";
import { CanvasEditor } from "@/components/meetings/canvas-editor";

export function meta() {
  return [{ title: "Meeting · Clips" }];
}

interface ActionItem {
  id?: string;
  text: string;
  assigneeEmail?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
}

type Participant = AttendeeStackParticipant;

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
  bulletsJson?: string[] | null;
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
}: {
  value: string;
  onChange: (next: string) => void;
  compact?: boolean;
}) {
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

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex min-w-0 items-center gap-2 text-left cursor-pointer"
      >
        <h1 className={textCls}>{value || "Untitled meeting"}</h1>
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
}: {
  items: ActionItem[];
  onToggle: (index: number, completed: boolean) => void;
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
                  key={index}
                  className="flex items-start gap-2 text-xs leading-relaxed"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    onClick={() => onToggle(index, !done)}
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center cursor-pointer transition-colors",
                      done
                        ? "bg-foreground border-foreground"
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
  const { meetingId } = useParams<{ meetingId: string }>();
  const qc = useQueryClient();

  type GetMeetingResp = {
    meeting?: Omit<Meeting, "participants" | "segmentsJson"> | null;
    participants?: Participant[];
    actionItems?: ActionItem[];
    transcript?: { segmentsJson?: TranscriptSegment[] | null } | null;
    recording?: { id: string; durationMs?: number | null } | null;
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
  const finalize = useActionMutation<any, any>("finalize-meeting");
  const [notesJustArrived, setNotesJustArrived] = useState(false);
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
      bulletsJson: safeArray<string>(data.meeting.bulletsJson),
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

  const hasNotes =
    !!meeting?.summaryMd ||
    !!meeting?.userNotesMd ||
    (meeting?.bulletsJson?.length ?? 0) > 0 ||
    (meeting?.actionItemsJson?.length ?? 0) > 0;

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

  /**
   * Granola-signature behavior: when the user edits an AI block, "promote"
   * its content into userNotesMd so it survives re-generation. The AI block
   * is cleared on the server in the same mutation.
   */
  const handleTransferAiToUser = (transferred: string) => {
    if (!meeting) return;
    const merged =
      [meeting.userNotesMd, transferred].filter(Boolean).join("\n\n") || "";
    patchCachedMeeting({ userNotesMd: merged, summaryMd: "" });
    updateMeeting.mutate({
      id: meeting.id,
      userNotesMd: merged,
      summaryMd: "",
    });
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
    autoFinalizedRef.current = true;
    finalize.mutate({ meetingId: meeting.id });
  };

  // Auto-generate notes once the transcript is ready and no notes yet.
  useEffect(() => {
    if (!meeting) return;
    if (autoFinalizedRef.current) return;
    if (hasNotes) return;
    if (finalize.isPending) return;
    if (meeting.transcriptStatus !== "ready") return;
    autoFinalizedRef.current = true;
    finalize.mutate({ meetingId: meeting.id });
  }, [meeting, hasNotes, finalize]);

  if (isLoading || !meeting) {
    return (
      <div className="p-6 max-w-6xl mx-auto w-full">
        <Skeleton className="h-6 w-32 mb-4" />
        <Skeleton className="h-9 w-96 mb-2" />
        <Skeleton className="h-4 w-64 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
          Couldn't load this meeting.
        </div>
      </div>
    );
  }

  const bullets = meeting.bulletsJson ?? [];
  const actionItems = meeting.actionItemsJson ?? [];
  const segments = meeting.segmentsJson ?? [];
  const recordingDuration = formatDurationMs(meeting.recordingDurationMs);

  return (
    <div className="p-6 max-w-6xl mx-auto w-full">
      <PageHeader>
        <NavLink
          to="/meetings"
          aria-label="All meetings"
          title="All meetings"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
        >
          <IconArrowLeft className="h-4 w-4" />
        </NavLink>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TitleEditor
            value={meeting.title || ""}
            onChange={handleTitleChange}
            compact
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
          {finalize.isPending ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              Generating notes…
            </span>
          ) : hasNotes ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleFinalize}
              className="cursor-pointer h-8"
            >
              Regenerate notes
            </Button>
          ) : null}
        </div>
      </PageHeader>

      {finalize.isError && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {(finalize.error as Error)?.message ||
            "Couldn't generate notes. Try again."}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-6">
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
        {meeting.recordingId && (
          <NavLink
            to={`/r/${meeting.recordingId}`}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 hover:text-foreground hover:bg-accent/40 cursor-pointer"
          >
            <IconVideo className="h-3.5 w-3.5" />
            Open recording
            {recordingDuration && (
              <span className="tabular-nums text-muted-foreground/80">
                · {recordingDuration}
              </span>
            )}
          </NavLink>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Two-tone canvas: user notes (black) + AI summary/bullets (gray) */}
        <div
          className={cn(
            "rounded-lg border border-border bg-background min-h-[480px] flex flex-col",
            notesJustArrived && "animate-in fade-in duration-500",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <IconNotes className="h-3.5 w-3.5" />
              Notes
            </div>
            {finalize.isPending && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <IconLoader2 className="h-3 w-3 animate-spin" />
                Working…
              </span>
            )}
          </div>
          <CanvasEditor
            summaryMd={meeting.summaryMd ?? ""}
            bullets={bullets}
            actionItems={actionItems}
            userNotesMd={meeting.userNotesMd ?? ""}
            onUserNotesChange={handleUserNotesChange}
            onSummaryChange={handleSummaryChange}
            onTransferAiToUser={handleTransferAiToUser}
            renderBullet={(b, i) => (
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
          {actionItems.length > 0 && (
            <div className="border-t border-border px-6 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Action items
              </h3>
              <ActionItemsByPerson
                items={actionItems}
                onToggle={handleToggleActionItem}
              />
            </div>
          )}
        </div>

        {/* Transcript pane — chat-bubble layout */}
        <div className="rounded-lg border border-border bg-background min-h-[480px] flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 sticky top-0 bg-background z-10">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <IconNotes className="h-3.5 w-3.5" />
              Transcript
            </div>
            {meeting.transcriptStatus === "ready" && (
              <span className="text-[10px] text-muted-foreground">
                {segments.length} segments
              </span>
            )}
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
    </div>
  );
}
