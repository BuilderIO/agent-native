import { PoweredByBadge, appPath, useT } from "@agent-native/core/client";
import { getRequestUserEmail } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { Button } from "@agent-native/toolkit/ui/button";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconCalendar,
  IconExternalLink,
  IconListCheck,
  IconUsers,
  IconWand,
} from "@tabler/icons-react";
import { and, eq, isNull } from "drizzle-orm";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import {
  AttendeeStack,
  type AttendeeStackParticipant,
} from "@/components/meetings/attendee-stack";
import enMessages from "@/i18n/en-US";

import { getDb, schema } from "../../server/db";

interface ActionItem {
  id: string;
  text: string;
  assigneeEmail: string | null;
  completedAt: string | null;
}

interface Participant {
  email: string;
  name: string | null;
  isOrganizer: boolean;
}

interface Bullet {
  text: string;
}

type LoaderData =
  | {
      meeting: {
        id: string;
        title: string;
        scheduledStart: string | null;
        summaryMd: string;
        bullets: Bullet[];
        participants: Participant[];
        actionItems: ActionItem[];
      };
    }
  | { meeting: null };

export async function loader({
  params,
}: LoaderFunctionArgs): Promise<LoaderData> {
  const id = params.meetingId;
  if (!id) return { meeting: null };

  const [row] = await getDb()
    .select({
      id: schema.meetings.id,
      title: schema.meetings.title,
      scheduledStart: schema.meetings.scheduledStart,
      visibility: schema.meetings.visibility,
      summaryMd: schema.meetings.summaryMd,
      bulletsJson: schema.meetings.bulletsJson,
    })
    .from(schema.meetings)
    .where(and(eq(schema.meetings.id, id), isNull(schema.meetings.trashedAt)))
    .limit(1);

  if (!row) return { meeting: null };

  if (row.visibility !== "public") {
    const userEmail = getRequestUserEmail();
    const access = userEmail ? await resolveAccess("meeting", id) : null;
    if (!access) return { meeting: null };
  }

  const [participants, actionItems] = await Promise.all([
    getDb()
      .select({
        email: schema.meetingParticipants.email,
        name: schema.meetingParticipants.name,
        isOrganizer: schema.meetingParticipants.isOrganizer,
      })
      .from(schema.meetingParticipants)
      .where(eq(schema.meetingParticipants.meetingId, id)),
    getDb()
      .select({
        id: schema.meetingActionItems.id,
        text: schema.meetingActionItems.text,
        assigneeEmail: schema.meetingActionItems.assigneeEmail,
        completedAt: schema.meetingActionItems.completedAt,
      })
      .from(schema.meetingActionItems)
      .where(eq(schema.meetingActionItems.meetingId, id)),
  ]);

  let bullets: Bullet[] = [];
  try {
    const parsed = JSON.parse(row.bulletsJson);
    if (Array.isArray(parsed)) bullets = parsed as Bullet[];
  } catch {}

  return {
    meeting: {
      id: row.id,
      title: row.title,
      scheduledStart: row.scheduledStart,
      summaryMd: row.summaryMd,
      bullets,
      participants,
      actionItems,
    },
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const m = loaderData?.meeting;
  const title = m?.title
    ? `${m.title} · Clips`
    : enMessages.shareMeeting.pageTitle;
  const description = m?.title
    ? `AI meeting notes for "${m.title}"`
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
    <div className="flex items-center justify-center h-screen w-full bg-background">
      <Spinner className="h-8 w-8 text-muted-foreground" />
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

export default function ShareMeetingRoute() {
  const t = useT();
  const data = useLoaderData<LoaderData>();

  if (!data.meeting) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-full gap-3 text-center px-4 bg-background">
        <p className="text-sm text-muted-foreground">
          {t("shareMeeting.unavailable")}
        </p>
        <PoweredByBadge />
      </div>
    );
  }

  const { meeting } = data;
  const { bullets } = meeting;
  const hasNotes =
    !!meeting.summaryMd || bullets.length > 0 || meeting.actionItems.length > 0;

  const attendees: AttendeeStackParticipant[] = meeting.participants.map(
    (p) => ({ email: p.email, name: p.name ?? undefined }),
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            {meeting.title || t("meetingDetail.untitledMeeting")}
          </h1>
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <a href={appPath("/")} className="gap-1.5">
              {t("shareMeeting.tryClips")}
              <IconExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-8">
          {meeting.scheduledStart && (
            <span className="inline-flex items-center gap-1">
              <IconCalendar className="h-3.5 w-3.5" />
              {formatDateTime(meeting.scheduledStart)}
            </span>
          )}
          {attendees.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <IconUsers className="h-3.5 w-3.5" />
              <AttendeeStack participants={attendees} max={5} size="xs" />
              <span>
                {t("shareMeeting.attendees", { count: attendees.length })}
              </span>
            </span>
          )}
        </div>

        {!hasNotes ? (
          <p className="text-sm text-muted-foreground italic">
            {t("shareMeeting.noAiNotes")}
          </p>
        ) : (
          <div className="space-y-8">
            {meeting.summaryMd && (
              <section>
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  <IconWand className="h-3.5 w-3.5" />
                  {t("shareMeeting.summary")}
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {meeting.summaryMd}
                </div>
              </section>
            )}

            {bullets.length > 0 && (
              <section>
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  <IconWand className="h-3.5 w-3.5" />
                  {t("shareMeeting.keyPoints")}
                </div>
                <ul className="space-y-2">
                  {bullets.map((b, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-sm leading-relaxed text-muted-foreground"
                    >
                      <span>•</span>
                      <span className="flex-1">{b.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {meeting.actionItems.length > 0 && (
              <section>
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  <IconListCheck className="h-3.5 w-3.5" />
                  {t("shareMeeting.actionItems")}
                </div>
                <ul className="space-y-2">
                  {meeting.actionItems.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed">
                      <span
                        className={
                          item.completedAt
                            ? "line-through text-muted-foreground"
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

        <div className="mt-12">
          <PoweredByBadge />
        </div>
      </div>
    </div>
  );
}
