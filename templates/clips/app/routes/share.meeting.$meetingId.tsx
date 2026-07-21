import { appPath } from "@agent-native/core/client/api-path";
import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { PoweredByBadge } from "@agent-native/core/client/ui";
import {
  IconCalendar,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconListCheck,
  IconNotes,
  IconUsers,
  IconWand,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { and, eq, isNull } from "drizzle-orm";
import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { toast } from "sonner";

import {
  AttendeeStack,
  type AttendeeStackParticipant,
} from "@/components/meetings/attendee-stack";
import { TranscriptBubbles } from "@/components/meetings/transcript-bubbles";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import enMessages from "@/i18n/en-US";
import {
  fetchPublicMeeting,
  type PublicMeeting,
  type PublicMeetingResult,
  type PublicMeetingTranscript,
} from "@/lib/public-meeting";

import { getDb, schema } from "../../server/db";

type LoaderData = { meeting: PublicMeeting | null };

export async function loader({
  params,
}: LoaderFunctionArgs): Promise<LoaderData> {
  const meetingId = params.meetingId;
  if (!meetingId) return { meeting: null };

  const [meeting] = await getDb()
    .select({
      id: schema.meetings.id,
      title: schema.meetings.title,
      scheduledStart: schema.meetings.scheduledStart,
      summaryMd: schema.meetings.summaryMd,
      bulletsJson: schema.meetings.bulletsJson,
      actualStart: schema.meetings.actualStart,
      actualEnd: schema.meetings.actualEnd,
      transcriptStatus: schema.meetings.transcriptStatus,
      visibility: schema.meetings.visibility,
    })
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.id, meetingId),
        eq(schema.meetings.visibility, "public"),
        isNull(schema.meetings.trashedAt),
      ),
    )
    .limit(1);
  if (!meeting) return { meeting: null };

  const [participants, actionItems] = await Promise.all([
    getDb()
      .select({
        email: schema.meetingParticipants.email,
        name: schema.meetingParticipants.name,
        isOrganizer: schema.meetingParticipants.isOrganizer,
      })
      .from(schema.meetingParticipants)
      .where(eq(schema.meetingParticipants.meetingId, meetingId)),
    getDb()
      .select({
        id: schema.meetingActionItems.id,
        text: schema.meetingActionItems.text,
        assigneeEmail: schema.meetingActionItems.assigneeEmail,
        completedAt: schema.meetingActionItems.completedAt,
      })
      .from(schema.meetingActionItems)
      .where(eq(schema.meetingActionItems.meetingId, meetingId)),
  ]);

  let bullets: PublicMeeting["bullets"] = [];
  try {
    const parsed = JSON.parse(meeting.bulletsJson);
    if (Array.isArray(parsed)) {
      bullets = parsed.filter(
        (bullet): bullet is { text: string } =>
          typeof bullet === "object" &&
          bullet !== null &&
          typeof bullet.text === "string",
      );
    }
  } catch {}

  return {
    meeting: {
      id: meeting.id,
      title: meeting.title,
      scheduledStart: meeting.scheduledStart,
      summaryMd: meeting.summaryMd,
      bullets,
      participants,
      actionItems,
      actualStart: meeting.actualStart,
      actualEnd: meeting.actualEnd,
      transcriptStatus: meeting.transcriptStatus,
    },
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const meeting = loaderData?.meeting;
  const title = meeting?.title
    ? `${meeting.title} · Clips`
    : enMessages.shareMeeting.pageTitle;
  const description = meeting?.title
    ? `AI meeting notes for "${meeting.title}"`
    : enMessages.shareMeeting.description;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
};

export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  );
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

function shouldPollMeeting(meeting: PublicMeeting): boolean {
  const isLive = !!meeting.actualStart && !meeting.actualEnd;
  const transcriptPending =
    meeting.transcriptStatus === "in_progress" ||
    meeting.transcriptStatus === "pending" ||
    meeting.transcript?.status === "pending";
  const notesAbsentWhileReady =
    meeting.transcriptStatus === "ready" &&
    !meeting.summaryMd &&
    meeting.bullets.length === 0 &&
    meeting.actionItems.length === 0;
  return isLive || transcriptPending || notesAbsentWhileReady;
}

function transcriptCopyText(
  transcript: PublicMeetingTranscript,
  meLabel: string,
  themLabel: string,
): string {
  if (transcript.segments.length > 0) {
    return transcript.segments
      .map((segment) => {
        const speaker =
          segment.speaker || (segment.source === "mic" ? meLabel : themLabel);
        return `${speaker}: ${segment.text}`;
      })
      .join("\n");
  }
  return transcript.fullText?.trim() ?? "";
}

const REVALIDATE_INTERVAL_MS = 5_000;
const REVALIDATE_MAX_DURATION_MS = 30 * 60 * 1000;

export default function ShareMeetingRoute() {
  const t = useT();
  const loaderData = useLoaderData<LoaderData>();
  const { meetingId } = useParams<{ meetingId: string }>();
  const { session, isLoading: sessionLoading } = useSession();
  const pollingStartedAtRef = useRef<number | null>(null);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const initialMeetingResult: PublicMeetingResult | undefined =
    loaderData.meeting
      ? {
          ok: true,
          status: 200,
          data: { meeting: loaderData.meeting, viewer: null },
        }
      : undefined;

  const meetingQuery = useQuery({
    queryKey: [
      "public-meeting",
      meetingId,
      session?.email ?? null,
      session?.orgId ?? null,
    ],
    queryFn: ({ signal }) => fetchPublicMeeting(meetingId ?? "", { signal }),
    enabled: !!meetingId && !sessionLoading,
    initialData: initialMeetingResult,
    refetchInterval: (query) => {
      const result = query.state.data;
      const payload = result?.data;
      const meeting =
        result?.ok && payload && "meeting" in payload ? payload.meeting : null;
      if (!meeting || !shouldPollMeeting(meeting)) {
        pollingStartedAtRef.current = null;
        return false;
      }
      if (pollingStartedAtRef.current == null) {
        pollingStartedAtRef.current = Date.now();
      }
      return Date.now() - pollingStartedAtRef.current <
        REVALIDATE_MAX_DURATION_MS
        ? REVALIDATE_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: false,
  });

  const payload = meetingQuery.data?.data;
  const meeting =
    meetingQuery.data?.ok && payload && "meeting" in payload
      ? payload.meeting
      : null;

  useEffect(() => {
    if (meeting?.title) document.title = `${meeting.title} · Clips`;
  }, [meeting?.title]);

  if (!meeting && (sessionLoading || meetingQuery.isLoading)) {
    return <HydrateFallback />;
  }

  if (!meeting) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <p className="text-sm text-muted-foreground">
          {t("shareMeeting.unavailable")}
        </p>
        <PoweredByBadge />
      </div>
    );
  }

  const hasNotes =
    !!meeting.summaryMd ||
    meeting.bullets.length > 0 ||
    meeting.actionItems.length > 0;
  const attendees: AttendeeStackParticipant[] = meeting.participants.map(
    (participant) => ({
      email: participant.email,
      name: participant.name ?? undefined,
    }),
  );
  const transcript = meeting.transcript;
  const copyText = transcript
    ? transcriptCopyText(
        transcript,
        t("transcriptBubbles.me"),
        t("transcriptBubbles.them"),
      )
    : "";

  const handleCopyTranscript = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setTranscriptCopied(true);
      toast.success(t("shareMeeting.transcriptCopied"));
      window.setTimeout(() => setTranscriptCopied(false), 1_500);
    } catch {
      toast.error(t("shareMeeting.copyTranscriptFailed"));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            {meeting.title || t("meetingDetail.untitledMeeting")}
          </h1>
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <a href={appPath("/")} className="gap-1.5">
              {t("shareMeeting.tryClips")}
              <IconExternalLink className="size-3.5" />
            </a>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {meeting.scheduledStart && (
            <span className="inline-flex items-center gap-1">
              <IconCalendar className="size-3.5" />
              {formatDateTime(meeting.scheduledStart)}
            </span>
          )}
          {attendees.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <IconUsers className="size-3.5" />
              <AttendeeStack participants={attendees} max={5} size="xs" />
              <span>
                {t("shareMeeting.attendees", { count: attendees.length })}
              </span>
            </span>
          )}
        </div>

        {!hasNotes ? (
          <p className="text-sm italic text-muted-foreground">
            {t("shareMeeting.noAiNotes")}
          </p>
        ) : (
          <div className="space-y-8">
            {meeting.summaryMd && (
              <section>
                <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <IconWand className="size-3.5" />
                  {t("shareMeeting.summary")}
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {meeting.summaryMd}
                </div>
              </section>
            )}

            {meeting.bullets.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <IconWand className="size-3.5" />
                  {t("shareMeeting.keyPoints")}
                </div>
                <ul className="space-y-2">
                  {meeting.bullets.map((bullet, index) => (
                    <li
                      key={index}
                      className="flex gap-2 text-sm leading-relaxed text-muted-foreground"
                    >
                      <span>•</span>
                      <span className="flex-1">{bullet.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {meeting.actionItems.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <IconListCheck className="size-3.5" />
                  {t("shareMeeting.actionItems")}
                </div>
                <ul className="space-y-2">
                  {meeting.actionItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex gap-2 text-sm leading-relaxed"
                    >
                      <span
                        className={
                          item.completedAt
                            ? "text-muted-foreground line-through"
                            : ""
                        }
                      >
                        {item.assigneeEmail ? (
                          <span className="font-medium">
                            {item.assigneeEmail.split("@")[0]}:{" "}
                          </span>
                        ) : null}
                        {item.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {transcript && (
          <section className="mt-10">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <IconNotes className="size-3.5" />
                {t("shareMeeting.transcript")}
              </div>
              {copyText && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5"
                  onClick={handleCopyTranscript}
                >
                  {transcriptCopied ? (
                    <IconCheck className="size-3.5" />
                  ) : (
                    <IconCopy className="size-3.5" />
                  )}
                  {t("shareMeeting.copyTranscript")}
                </Button>
              )}
            </div>
            {transcript.segments.length > 0 ? (
              <div className="flex h-[36rem] flex-col overflow-hidden rounded-lg border border-border">
                <TranscriptBubbles
                  segments={transcript.segments}
                  isLive={false}
                  recordingId={null}
                  onSeek={() => {}}
                />
              </div>
            ) : transcript.fullText ? (
              <div className="whitespace-pre-wrap rounded-lg border border-border p-4 text-sm leading-relaxed">
                {transcript.fullText}
              </div>
            ) : (
              <div className="flex min-h-40 flex-col overflow-hidden rounded-lg border border-border">
                <TranscriptBubbles
                  segments={[]}
                  isLive={false}
                  recordingId={null}
                  onSeek={() => {}}
                />
              </div>
            )}
          </section>
        )}

        <div className="mt-12">
          <PoweredByBadge />
        </div>
      </main>
    </div>
  );
}
