import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useParams } from "react-router";
import {
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconEdit,
  IconLoader2,
  IconNotes,
  IconPlayerPlay,
  IconUsers,
  IconWand,
} from "@tabler/icons-react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: "Meeting · Clips" }];
}

interface TranscriptSegment {
  startMs: number;
  endMs?: number;
  text: string;
  speaker?: string | null;
}

interface ActionItem {
  id?: string;
  text: string;
  assigneeEmail?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
}

interface Participant {
  id?: string;
  email: string;
  name?: string | null;
  isOrganizer?: boolean;
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
  transcriptStatus?: "pending" | "ready" | "failed" | "in_progress" | string;
  summaryMd?: string | null;
  bulletsJson?: string[] | null;
  actionItemsJson?: ActionItem[] | null;
  segmentsJson?: TranscriptSegment[] | null;
  participants?: Participant[];
}

function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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

function initialsFor(p: Participant | string): string {
  const src =
    typeof p === "string" ? p : p.name?.trim() || p.email?.trim() || "?";
  const parts = src
    .replace(/@.*$/, "")
    .split(/\s+|[._-]/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[1]![0] ?? "")).toUpperCase();
}

function TitleEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
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

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex items-center gap-2 text-left cursor-pointer"
      >
        <h1 className="text-2xl font-semibold tracking-tight">
          {value || "Untitled meeting"}
        </h1>
        <IconEdit className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
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
      className="text-2xl font-semibold tracking-tight bg-transparent outline-none border-b border-primary/40 focus:border-primary w-full"
    />
  );
}

function TranscriptPane({
  meeting,
  isLive,
  onSeek,
}: {
  meeting: Meeting;
  isLive: boolean;
  onSeek: (ms: number) => void;
}) {
  const segments = meeting.segmentsJson ?? [];
  const liveEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive) liveEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [isLive, segments.length]);

  if (segments.length === 0) {
    if (isLive) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          Listening…
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground gap-2 px-6">
        <IconNotes className="h-6 w-6 text-muted-foreground/50" />
        <span>No transcript yet.</span>
        <span className="text-xs">
          Recording will appear here once the meeting starts.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {segments.map((seg, i) => (
        <div key={i} className="group flex gap-3 text-sm leading-relaxed">
          <button
            type="button"
            onClick={() => onSeek(seg.startMs)}
            disabled={!meeting.recordingId}
            className={cn(
              "shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums w-12 text-right pt-0.5",
              meeting.recordingId
                ? "hover:text-primary cursor-pointer"
                : "cursor-default",
            )}
          >
            {formatTimestamp(seg.startMs)}
          </button>
          <div className="flex-1 min-w-0">
            {seg.speaker && (
              <div className="text-[11px] font-medium text-foreground/70 mb-0.5">
                {seg.speaker}
              </div>
            )}
            <p className="text-foreground/90">{seg.text}</p>
          </div>
        </div>
      ))}
      <div ref={liveEndRef} />
    </div>
  );
}

function ActionItemsByPerson({ items }: { items: ActionItem[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const it of items) {
      const key = it.assigneeEmail || "Unassigned";
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return Array.from(map.entries());
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
                {initialsFor(who)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium">{who}</span>
          </div>
          <ul className="space-y-1 pl-7">
            {list.map((it, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs leading-relaxed"
              >
                <span
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0 rounded border border-border",
                    it.completedAt && "bg-primary border-primary",
                  )}
                >
                  {it.completedAt && (
                    <IconCheck className="h-3 w-3 text-primary-foreground" />
                  )}
                </span>
                <span
                  className={cn(
                    "flex-1",
                    it.completedAt && "line-through text-muted-foreground",
                  )}
                >
                  {it.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function MeetingDetailRoute() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useActionQuery<Meeting | undefined>(
    "get-meeting",
    { id: meetingId },
    {
      retry: false,
      enabled: !!meetingId,
      // Poll while live so transcript streams in.
      refetchInterval: (query) => {
        const m = query.state.data as Meeting | undefined;
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

  const meeting = data;
  const isLive = !!(
    meeting &&
    ((meeting.actualStart && !meeting.actualEnd) ||
      meeting.transcriptStatus === "in_progress")
  );

  const handleTitleChange = (next: string) => {
    if (!meeting) return;
    // Optimistic update.
    qc.setQueryData<Meeting | undefined>(
      ["action", "get-meeting", { id: meetingId }],
      (prev) => (prev ? { ...prev, title: next } : prev),
    );
    updateMeeting.mutate({ id: meeting.id, title: next });
  };

  const handleSeek = (ms: number) => {
    if (!meeting?.recordingId) return;
    if (typeof window !== "undefined") {
      window.location.assign(`/r/${meeting.recordingId}?t=${ms}`);
    }
  };

  const handleFinalize = () => {
    if (!meeting) return;
    finalize.mutate({ id: meeting.id });
  };

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
  const hasNotes =
    !!meeting.summaryMd || bullets.length > 0 || actionItems.length > 0;

  return (
    <div className="p-6 max-w-6xl mx-auto w-full">
      <NavLink
        to="/meetings"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <IconArrowLeft className="h-3.5 w-3.5" />
        All meetings
      </NavLink>

      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="flex-1 min-w-0">
          <TitleEditor
            value={meeting.title || ""}
            onChange={handleTitleChange}
          />
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <Badge
              variant="secondary"
              className="bg-red-500/10 text-red-500 border-red-500/20 gap-1"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              Live
            </Badge>
          )}
          <Button
            size="sm"
            variant="default"
            onClick={handleFinalize}
            disabled={finalize.isPending}
            className="gap-1.5 cursor-pointer"
          >
            {finalize.isPending ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : (
              <IconWand className="h-4 w-4" />
            )}
            Generate notes
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-6">
        <span className="inline-flex items-center gap-1">
          <IconClock className="h-3.5 w-3.5" />
          {formatDateTime(meeting.scheduledStart)}
        </span>
        {(meeting.participants?.length ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <IconUsers className="h-3.5 w-3.5" />
            <span className="flex -space-x-1.5">
              {meeting.participants!.slice(0, 5).map((p, i) => (
                <Avatar
                  key={`${p.email}-${i}`}
                  className="h-5 w-5 ring-2 ring-background"
                  title={p.name || p.email}
                >
                  <AvatarImage alt={p.name || p.email} />
                  <AvatarFallback className="text-[9px]">
                    {initialsFor(p)}
                  </AvatarFallback>
                </Avatar>
              ))}
            </span>
            <span>{meeting.participants!.length} attendees</span>
          </span>
        )}
        {meeting.recordingId && (
          <NavLink
            to={`/r/${meeting.recordingId}`}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <IconPlayerPlay className="h-3.5 w-3.5" />
            View recording
          </NavLink>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transcript pane */}
        <div className="rounded-lg border border-border bg-background min-h-[480px] flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <IconNotes className="h-3.5 w-3.5" />
              Transcript
            </div>
            {meeting.transcriptStatus === "ready" && (
              <span className="text-[10px] text-muted-foreground">
                {meeting.segmentsJson?.length ?? 0} segments
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <TranscriptPane
              meeting={meeting}
              isLive={isLive}
              onSeek={handleSeek}
            />
          </div>
        </div>

        {/* Notes pane */}
        <div className="rounded-lg border border-border bg-background min-h-[480px] flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <IconWand className="h-3.5 w-3.5" />
              AI notes
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {!hasNotes ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground gap-2 px-6 py-12">
                <IconWand className="h-6 w-6 text-muted-foreground/50" />
                <span>No notes yet.</span>
                <span className="text-xs">
                  Click{" "}
                  <span className="font-medium text-foreground">
                    Generate notes
                  </span>{" "}
                  to summarize the transcript.
                </span>
              </div>
            ) : (
              <>
                {meeting.summaryMd && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Summary
                    </h3>
                    <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                      {meeting.summaryMd}
                    </p>
                  </div>
                )}
                {bullets.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Key points
                    </h3>
                    <ul className="space-y-1.5">
                      {bullets.map((b, i) => (
                        <li
                          key={i}
                          className="flex gap-2 text-sm leading-relaxed"
                        >
                          <span className="text-muted-foreground">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {actionItems.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Action items
                    </h3>
                    <ActionItemsByPerson items={actionItems} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
