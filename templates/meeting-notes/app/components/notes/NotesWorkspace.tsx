import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconBuilding,
  IconCalendarEvent,
  IconCheck,
  IconClock,
  IconFileText,
  IconLoader2,
  IconNotes,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconTemplate,
  IconUsers,
} from "@tabler/icons-react";

type MeetingStatus = "scheduled" | "recording" | "enhancing" | "done";

interface MeetingListItem {
  id: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  status: MeetingStatus;
  attendeeCount: number;
  updatedAt: string;
}

interface MeetingDetail {
  meeting: MeetingListItem & {
    calendarProvider?: string | null;
    ownerEmail?: string;
    visibility?: string;
    createdAt?: string;
  };
  transcript: {
    status: string;
    fullText: string;
    failureReason?: string | null;
  } | null;
  notes: {
    rawContent: unknown;
    enhancedContent: string | null;
    templateId: string | null;
    updatedAt: string;
  } | null;
  attendees: Array<{
    id: string;
    name: string;
    email: string | null;
    role: string;
  }>;
}

interface TemplateItem {
  id: string;
  name: string;
  prompt: string;
  isBuiltIn: boolean;
  createdAt: string;
}

interface PersonItem {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  meetingCount: number;
  lastSeenAt: string | null;
}

interface CompanyItem {
  id: string;
  name: string;
  domain: string | null;
  createdAt: string;
}

function makeId(prefix: string) {
  const raw =
    globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) ??
    Math.random().toString(36).slice(2, 14);
  return `${prefix}_${raw}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "No time set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function rawNotesPreview(raw: unknown) {
  if (!raw || (typeof raw === "object" && Object.keys(raw).length === 0)) {
    return "No raw notes yet.";
  }
  if (typeof raw === "string") return raw;
  return JSON.stringify(raw, null, 2);
}

function statusTone(status: MeetingStatus) {
  switch (status) {
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "recording":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300";
    case "enhancing":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function StatusBadge({ status }: { status: MeetingStatus }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium capitalize ${statusTone(status)}`}
    >
      {status}
    </span>
  );
}

function Shell({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-6">
        <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
              {icon}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-normal text-foreground">
                {title}
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                {subtitle}
              </p>
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
        {icon}
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export function MeetingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const meetingsQuery = useActionQuery<{ meetings: MeetingListItem[] }>(
    "list-meetings",
    { search: search || undefined, sort: "recent", limit: 100 },
  );
  const createMeeting = useActionMutation<
    { id: string },
    { id: string; title: string; startTime: string; attendees: never[] }
  >("create-meeting");

  const meetings = meetingsQuery.data?.meetings ?? [];

  function handleCreate() {
    const id = makeId("mtg");
    const now = new Date().toISOString();
    const optimistic: MeetingListItem = {
      id,
      title: "Untitled meeting",
      startTime: now,
      endTime: null,
      status: "scheduled",
      attendeeCount: 0,
      updatedAt: now,
    };
    qc.setQueryData<{ meetings: MeetingListItem[] }>(
      [
        "action",
        "list-meetings",
        { search: undefined, sort: "recent", limit: 100 },
      ],
      (current) => ({ meetings: [optimistic, ...(current?.meetings ?? [])] }),
    );
    navigate(`/m/${id}`);
    createMeeting.mutate({
      id,
      title: "Untitled meeting",
      startTime: now,
      attendees: [],
    });
  }

  return (
    <Shell
      title="Meetings"
      subtitle="Capture meeting notes, track status, and hand rough notes to the agent for enhancement."
      icon={<IconNotes size={20} />}
      action={
        <button
          type="button"
          onClick={handleCreate}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90"
        >
          <IconPlus size={16} />
          New meeting
        </button>
      }
    >
      <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
        <IconSearch size={16} className="text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search meetings"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {meetingsQuery.isLoading ? (
        <EmptyState
          icon={<IconLoader2 size={18} className="animate-spin" />}
          title="Loading meetings"
          body="Fetching the latest meeting list."
        />
      ) : meetings.length === 0 ? (
        <EmptyState
          icon={<IconCalendarEvent size={18} />}
          title="No meetings yet"
          body="Create a meeting to start a notes workspace for the conversation."
        />
      ) : (
        <div className="grid gap-3">
          {meetings.map((meeting) => (
            <Link
              key={meeting.id}
              to={`/m/${meeting.id}`}
              className="grid gap-3 rounded-md border border-border bg-card p-4 transition-colors hover:border-foreground/30 md:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-foreground">
                    {meeting.title}
                  </h2>
                  <StatusBadge status={meeting.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <IconClock size={14} />
                    {formatDate(meeting.startTime)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <IconUsers size={14} />
                    {meeting.attendeeCount} attendee
                    {meeting.attendeeCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground md:text-right">
                Updated {formatDate(meeting.updatedAt)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}

export function MeetingDetailPage({ meetingId }: { meetingId: string }) {
  const qc = useQueryClient();
  const detailQuery = useActionQuery<MeetingDetail>(
    "get-meeting",
    { meetingId },
    { retry: false },
  );
  const templatesQuery = useActionQuery<{ templates: TemplateItem[] }>(
    "list-templates",
  );
  const updateMeeting = useActionMutation<
    unknown,
    { id: string; title?: string; status?: MeetingStatus }
  >("update-meeting");
  const enhanceNotes = useActionMutation<
    unknown,
    { meetingId: string; templateId?: string }
  >("enhance-notes");

  const meeting = detailQuery.data?.meeting;
  const [titleDraft, setTitleDraft] = useState("");
  const currentTitle = titleDraft || meeting?.title || "Meeting";
  const templates = templatesQuery.data?.templates ?? [];
  const [templateId, setTemplateId] = useState("");

  useMemo(() => {
    if (meeting?.title) setTitleDraft(meeting.title);
  }, [meeting?.title]);

  function patchMeeting(patch: Partial<MeetingListItem>) {
    qc.setQueryData<MeetingDetail>(
      ["action", "get-meeting", { meetingId }],
      (current) =>
        current
          ? {
              ...current,
              meeting: { ...current.meeting, ...patch },
            }
          : current,
    );
  }

  function saveTitle() {
    if (!meeting) return;
    const title = currentTitle.trim() || "Untitled meeting";
    patchMeeting({ title, updatedAt: new Date().toISOString() });
    updateMeeting.mutate({ id: meeting.id, title });
  }

  function setStatus(status: MeetingStatus) {
    if (!meeting) return;
    patchMeeting({ status, updatedAt: new Date().toISOString() });
    updateMeeting.mutate({ id: meeting.id, status });
  }

  function queueEnhancement() {
    patchMeeting({ status: "enhancing", updatedAt: new Date().toISOString() });
    enhanceNotes.mutate({ meetingId, templateId: templateId || undefined });
  }

  if (detailQuery.isLoading) {
    return (
      <Shell
        title="Meeting"
        subtitle="Loading meeting details."
        icon={<IconFileText size={20} />}
      >
        <EmptyState
          icon={<IconLoader2 size={18} className="animate-spin" />}
          title="Loading meeting"
          body="Fetching notes, attendees, and transcript state."
        />
      </Shell>
    );
  }

  if (detailQuery.isError || !meeting) {
    return (
      <Shell
        title="Meeting not found"
        subtitle="The meeting may have been moved, deleted, or not shared with this account."
        icon={<IconFileText size={20} />}
        action={
          <Link
            to="/meetings"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
          >
            <IconArrowLeft size={16} />
            Meetings
          </Link>
        }
      >
        <EmptyState
          icon={<IconFileText size={18} />}
          title="No meeting data"
          body={
            (detailQuery.error as Error)?.message ??
            "Unable to load this meeting."
          }
        />
      </Shell>
    );
  }

  return (
    <Shell
      title={meeting.title}
      subtitle={`${formatDate(meeting.startTime)} · ${meeting.attendeeCount ?? 0} attendee${meeting.attendeeCount === 1 ? "" : "s"}`}
      icon={<IconFileText size={20} />}
      action={
        <Link
          to="/meetings"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
        >
          <IconArrowLeft size={16} />
          Meetings
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-4">
          <div className="rounded-md border border-border bg-card p-4">
            <label className="text-xs font-medium uppercase text-muted-foreground">
              Title
            </label>
            <div className="mt-2 flex gap-2">
              <input
                value={currentTitle}
                onChange={(event) => setTitleDraft(event.target.value)}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={saveTitle}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90"
              >
                <IconCheck size={16} />
                Save
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Notes</h2>
                <StatusBadge status={meeting.status} />
              </div>
              <pre className="min-h-40 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-6 text-muted-foreground">
                {detailQuery.data?.notes?.enhancedContent ||
                  rawNotesPreview(detailQuery.data?.notes?.rawContent)}
              </pre>
            </div>
            <div className="rounded-md border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Transcript</h2>
              <div className="min-h-40 rounded-md bg-muted/40 p-3 text-sm leading-6 text-muted-foreground">
                {detailQuery.data?.transcript?.fullText ||
                  "No transcript has been captured yet."}
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Workflow</h2>
            <div className="grid grid-cols-2 gap-2">
              {(["scheduled", "recording", "done"] as MeetingStatus[]).map(
                (status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatus(status)}
                    className="h-9 rounded-md border border-border px-2 text-sm capitalize hover:bg-accent"
                  >
                    {status}
                  </button>
                ),
              )}
            </div>
            <label className="mt-4 block text-xs font-medium uppercase text-muted-foreground">
              Template
            </label>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">No template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={queueEnhancement}
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90"
            >
              <IconSparkles size={16} />
              Enhance notes
            </button>
          </div>

          <div className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Attendees</h2>
            {detailQuery.data?.attendees.length ? (
              <div className="space-y-2">
                {detailQuery.data.attendees.map((attendee) => (
                  <div
                    key={attendee.id}
                    className="rounded-md border border-border bg-background px-3 py-2"
                  >
                    <div className="truncate text-sm font-medium">
                      {attendee.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {attendee.email || attendee.role}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No attendees are attached to this meeting.
              </p>
            )}
          </div>
        </aside>
      </div>
    </Shell>
  );
}

export function TemplatesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const templatesQuery = useActionQuery<{ templates: TemplateItem[] }>(
    "list-templates",
  );
  const createTemplate = useActionMutation<
    { id: string; name: string },
    { name: string; prompt: string }
  >("create-template", {
    onSuccess: () => {
      setName("");
      setPrompt("");
    },
  });
  const templates = templatesQuery.data?.templates ?? [];

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName || !trimmedPrompt) return;
    const optimistic: TemplateItem = {
      id: makeId("tpl"),
      name: trimmedName,
      prompt: trimmedPrompt,
      isBuiltIn: false,
      createdAt: new Date().toISOString(),
    };
    qc.setQueryData<{ templates: TemplateItem[] }>(
      ["action", "list-templates", undefined],
      (current) => ({ templates: [optimistic, ...(current?.templates ?? [])] }),
    );
    createTemplate.mutate({ name: trimmedName, prompt: trimmedPrompt });
  }

  return (
    <Shell
      title="Templates"
      subtitle="Reusable structures for turning raw meeting notes into clear summaries."
      icon={<IconTemplate size={20} />}
    >
      <form
        onSubmit={handleCreate}
        className="grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-[220px_minmax(0,1fr)_auto]"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Template name"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Prompt instructions"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90"
        >
          <IconPlus size={16} />
          Create
        </button>
      </form>

      {templates.length === 0 ? (
        <EmptyState
          icon={<IconTemplate size={18} />}
          title="No templates yet"
          body="Create a template for recurring formats like standups, 1:1s, and decision logs."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((template) => (
            <article
              key={template.id}
              className="rounded-md border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="truncate text-sm font-semibold">
                  {template.name}
                </h2>
                {template.isBuiltIn ? (
                  <span className="rounded-full border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                    Built in
                  </span>
                ) : null}
              </div>
              <p className="mt-3 line-clamp-4 text-sm leading-6 text-muted-foreground">
                {template.prompt}
              </p>
            </article>
          ))}
        </div>
      )}
    </Shell>
  );
}

export function PeoplePage() {
  const peopleQuery = useActionQuery<{ people: PersonItem[] }>("list-people", {
    sort: "meetings",
    limit: 100,
  });
  const people = peopleQuery.data?.people ?? [];
  return (
    <Shell
      title="People"
      subtitle="Contacts collected from meeting attendees in this organization."
      icon={<IconUsers size={20} />}
    >
      {people.length === 0 ? (
        <EmptyState
          icon={<IconUsers size={18} />}
          title="No people yet"
          body="People appear here as meetings collect attendee details."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {people.map((person) => (
            <article
              key={person.id}
              className="rounded-md border border-border bg-card p-4"
            >
              <h2 className="truncate text-sm font-semibold">{person.name}</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {person.email || person.title || "No contact details"}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                {person.meetingCount} meeting
                {person.meetingCount === 1 ? "" : "s"}
              </p>
            </article>
          ))}
        </div>
      )}
    </Shell>
  );
}

export function CompaniesPage() {
  const companiesQuery = useActionQuery<{ companies: CompanyItem[] }>(
    "list-companies",
  );
  const companies = companiesQuery.data?.companies ?? [];
  return (
    <Shell
      title="Companies"
      subtitle="Organizations inferred from meeting attendee domains."
      icon={<IconBuilding size={20} />}
    >
      {companies.length === 0 ? (
        <EmptyState
          icon={<IconBuilding size={18} />}
          title="No companies yet"
          body="Companies appear here after attendee domains are associated with meetings."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {companies.map((company) => (
            <article
              key={company.id}
              className="rounded-md border border-border bg-card p-4"
            >
              <h2 className="truncate text-sm font-semibold">{company.name}</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {company.domain || "No domain"}
              </p>
            </article>
          ))}
        </div>
      )}
    </Shell>
  );
}

export function SettingsPage() {
  return (
    <Shell
      title="Settings"
      subtitle="Workspace setup and account controls for Notes."
      icon={<IconBuilding size={20} />}
    >
      <div className="rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Organization</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Notes stores meetings, templates, people, and companies in your active
          organization. Use the team controls in the agent-native sidebar for
          deeper member and sharing management.
        </p>
      </div>
    </Shell>
  );
}
