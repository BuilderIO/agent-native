/**
 * <MeetingCard /> — Granola-style meeting tile.
 *
 * Renders title, time, attendee stack, status pills (Live / Transcript ready
 * / Notes ready), and a 1-2 line summary preview. Hover lifts the card.
 */
import { NavLink } from "react-router";
import {
  IconCheck,
  IconClock,
  IconNotes,
  IconVideo,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AttendeeStack, type AttendeeStackParticipant } from "./attendee-stack";

export interface MeetingCardData {
  id: string;
  title: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  recordingId?: string | null;
  transcriptStatus?:
    | "pending"
    | "ready"
    | "failed"
    | "in_progress"
    | string
    | null;
  summaryPreview?: string | null;
  summaryMd?: string | null;
  participants?: AttendeeStackParticipant[];
}

function formatTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function buildPreview(m: MeetingCardData): string | null {
  if (m.summaryPreview && m.summaryPreview.trim()) return m.summaryPreview;
  if (m.summaryMd && m.summaryMd.trim()) {
    // Strip simple markdown markers and collapse whitespace for the preview.
    const plain = m.summaryMd
      .replace(/[#*`>_~-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return plain.slice(0, 220);
  }
  return null;
}

export function MeetingCard({ meeting }: { meeting: MeetingCardData }) {
  const isLive = !!(
    (meeting.actualStart && !meeting.actualEnd) ||
    meeting.transcriptStatus === "in_progress"
  );
  const transcriptReady = meeting.transcriptStatus === "ready";
  const hasNotes = !!meeting.summaryMd;
  const preview = buildPreview(meeting);

  return (
    <NavLink
      to={`/meetings/${meeting.id}`}
      className="group block focus:outline-none"
    >
      <Card
        className={cn(
          "cursor-pointer transition-all duration-150",
          "hover:border-foreground/20 hover:shadow-sm hover:-translate-y-px",
          "bg-background",
        )}
      >
        <CardContent className="p-4 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium leading-snug line-clamp-2 flex-1 text-foreground">
              {meeting.title || "Untitled meeting"}
            </h3>
            <div className="flex items-center gap-1 shrink-0">
              {isLive ? (
                <Badge
                  variant="secondary"
                  className="bg-red-500/10 text-red-600 border-red-500/20 text-[10px] gap-1 font-medium px-1.5"
                >
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                  </span>
                  Live
                </Badge>
              ) : transcriptReady ? (
                <Badge
                  variant="secondary"
                  className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] gap-1 px-1.5"
                >
                  <IconCheck className="h-3 w-3" />
                  Transcript
                </Badge>
              ) : null}
              {hasNotes && !isLive && (
                <Badge
                  variant="secondary"
                  className="bg-amber-500/10 text-amber-700 border-amber-500/20 text-[10px] gap-1 px-1.5"
                  title="AI notes ready"
                >
                  <IconNotes className="h-3 w-3" />
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <IconClock className="h-3.5 w-3.5" />
            <span>{formatTime(meeting.scheduledStart)}</span>
            {meeting.scheduledEnd && (
              <span>– {formatTime(meeting.scheduledEnd)}</span>
            )}
          </div>

          {preview ? (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
              {preview}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/60 italic leading-relaxed">
              No summary yet
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <AttendeeStack
              participants={meeting.participants ?? []}
              size="xs"
            />
            {meeting.recordingId && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <IconVideo className="h-3 w-3" />
                Recording
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </NavLink>
  );
}

export function MeetingCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-2.5">
      <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
      <div className="h-3 w-24 rounded bg-muted animate-pulse" />
      <div className="h-3 w-full rounded bg-muted/70 animate-pulse" />
      <div className="h-3 w-5/6 rounded bg-muted/70 animate-pulse" />
      <div className="flex justify-between pt-1">
        <div className="h-5 w-20 rounded-full bg-muted animate-pulse" />
        <div className="h-3 w-16 rounded bg-muted animate-pulse" />
      </div>
    </div>
  );
}
