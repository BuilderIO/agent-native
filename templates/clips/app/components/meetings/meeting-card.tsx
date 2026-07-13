import { useT } from "@agent-native/core/client";
import {
  IconCheck,
  IconClock,
  IconExternalLink,
  IconNotes,
  IconVideo,
} from "@tabler/icons-react";
/**
 * <MeetingCard /> — Granola-style meeting tile.
 *
 * Renders title, time, attendee stack, status pills (Live / Transcript ready
 * / Notes ready), and a 1-2 line summary preview. Hover lifts the card.
 */
import { NavLink } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type Translate = (key: string, params?: Record<string, unknown>) => string;

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
  const t = useT();
  const isLive = !!(
    (meeting.actualStart && !meeting.actualEnd) ||
    meeting.transcriptStatus === "in_progress"
  );
  const transcriptReady = meeting.transcriptStatus === "ready";
  const hasNotes = !!meeting.summaryMd;
  const preview = buildPreview(meeting);
  const now = Date.now();
  const scheduledEndMs = Date.parse(
    meeting.scheduledEnd ?? meeting.scheduledStart,
  );
  const meetingHasEnded =
    !!meeting.actualEnd ||
    (!Number.isNaN(scheduledEndMs) && scheduledEndMs < now);
  const shouldShowMissingSummary =
    !preview &&
    (meetingHasEnded || !!meeting.recordingId || transcriptReady || isLive);

  return (
    <NavLink
      to={`/meetings/${meeting.id}`}
      className="group block focus:outline-none"
    >
      <Card
        className={cn(
          "cursor-pointer transition-[transform,box-shadow,border-color] duration-150",
          "hover:border-foreground/20 hover:shadow-sm hover:-translate-y-px",
          "bg-background",
        )}
      >
        <CardContent className="p-4 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium leading-snug line-clamp-2 flex-1 text-foreground">
              {meeting.title || t("meetingDetail.untitledMeeting")}
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
                  {t("meetingCard.live")}
                </Badge>
              ) : transcriptReady ? (
                <Badge
                  variant="secondary"
                  className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] gap-1 px-1.5"
                >
                  <IconCheck className="h-3 w-3" />
                  {t("meetingCard.transcript")}
                </Badge>
              ) : null}
              {hasNotes && !isLive && (
                <Badge
                  variant="secondary"
                  className="bg-amber-500/10 text-amber-700 border-amber-500/20 text-[10px] gap-1 px-1.5"
                  title={t("meetingCard.aiNotesReady")}
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
          ) : shouldShowMissingSummary ? (
            <p className="text-xs text-muted-foreground/60 italic leading-relaxed">
              {t("meetingCard.noSummary")}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <AttendeeStack
              participants={meeting.participants ?? []}
              size="xs"
            />
            {meeting.recordingId && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <IconVideo className="h-3 w-3" />
                {t("meetingCard.transcriptSource")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </NavLink>
  );
}

export interface UpcomingMeetingCardData {
  id: string;
  title: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  joinUrl?: string | null;
  platform?: string | null;
  participants?: AttendeeStackParticipant[];
}

/** Human "starts in 5 min" / "now" / "in 2 hrs" label for an upcoming card. */
function relativeStartLabel(
  iso: string,
  t: Translate,
): { text: string; soon: boolean } {
  const start = Date.parse(iso);
  if (Number.isNaN(start)) return { text: "", soon: false };
  const diffMin = Math.round((start - Date.now()) / 60000);
  if (diffMin <= 0 && diffMin > -120)
    return { text: t("meetingCard.now"), soon: true };
  if (diffMin <= 0) return { text: t("meetingCard.started"), soon: false };
  if (diffMin < 60)
    return {
      text: t("meetingCard.inMinutes", { count: diffMin }),
      soon: diffMin <= 5,
    };
  const hrs = Math.round(diffMin / 60);
  return { text: t("meetingCard.inHours", { count: hrs }), soon: false };
}

/**
 * <UpcomingMeetingCard /> — a not-yet-recorded calendar event (Granola-style).
 * Recording is a native Clips desktop-app gesture, so the card just opens the
 * meeting's notes ("Open notes") and links out to the call ("Join"). Buttons are
 * NavLink/<a> siblings (never nested anchors) so the markup stays valid.
 */
export function UpcomingMeetingCard({
  meeting,
}: {
  meeting: UpcomingMeetingCardData;
}) {
  const t = useT();
  const isLive = !!(meeting.actualStart && !meeting.actualEnd);
  const { text: whenText, soon } = relativeStartLabel(
    meeting.scheduledStart,
    t,
  );
  const joinable = soon || isLive;

  return (
    <Card
      className={cn(
        "transition-[transform,box-shadow,border-color] duration-150 hover:border-foreground/20 hover:shadow-sm",
        joinable && "border-foreground/25",
      )}
    >
      <CardContent className="p-4 space-y-2.5">
        <NavLink
          to={`/meetings/${meeting.id}`}
          className="block group focus:outline-none"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium leading-snug line-clamp-2 flex-1 text-foreground group-hover:text-foreground">
              {meeting.title || t("meetingDetail.untitledMeeting")}
            </h3>
            {isLive ? (
              <Badge
                variant="secondary"
                className="bg-red-500/10 text-red-600 border-red-500/20 text-[10px] gap-1 font-medium px-1.5 shrink-0"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                </span>
                {t("meetingCard.live")}
              </Badge>
            ) : (
              <span
                className={cn(
                  "shrink-0 text-[11px] tabular-nums",
                  soon
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                {whenText}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <IconClock className="h-3.5 w-3.5" />
            <span>{formatTime(meeting.scheduledStart)}</span>
            {meeting.scheduledEnd && (
              <span>– {formatTime(meeting.scheduledEnd)}</span>
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {soon || isLive
              ? t("meetingCard.startFromDesktopNow")
              : t("meetingCard.startFromDesktopLater")}
          </p>
        </NavLink>

        <div className="flex items-center justify-between gap-2 pt-1">
          <AttendeeStack participants={meeting.participants ?? []} size="xs" />
          <div className="flex items-center gap-1.5">
            {meeting.joinUrl && (
              <a
                href={meeting.joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-xs cursor-pointer"
                  tabIndex={-1}
                >
                  <IconExternalLink className="h-3.5 w-3.5" />
                  {t("meetingCard.join")}
                </Button>
              </a>
            )}
            <Button
              asChild
              size="sm"
              variant={isLive ? "default" : "secondary"}
              className="h-7 gap-1 px-2.5 text-xs cursor-pointer"
            >
              <NavLink to={`/meetings/${meeting.id}`}>
                {t("meetingCard.openNotes")}
              </NavLink>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
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
