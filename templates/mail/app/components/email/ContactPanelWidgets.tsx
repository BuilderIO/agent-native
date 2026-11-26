import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import type { ContactAttachment } from "@shared/types";
import {
  IconArrowUpRight,
  IconFile,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconPhoto,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useAddContactNote,
  useContactAttachments,
  useContactNote,
} from "@/hooks/use-contact-panel";
import { mailThreadHref, mailViewHasThreadLinks } from "@/lib/mail-routes";
import { cn } from "@/lib/utils";

const ATTACHMENTS_SHOWN = 4;

function WidgetSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="h-px bg-border/30 mx-4" />
      <section className="px-4 py-3">
        <div className="mb-2 flex h-4 items-center justify-between gap-2">
          <h4 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
            {title}
          </h4>
          {action}
        </div>
        {children}
      </section>
    </>
  );
}

function WidgetError({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-2" role="alert">
      <p className="text-[11px] text-muted-foreground/70">{message}</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto shrink-0 px-2 py-1 text-[11px]"
        onClick={onRetry}
        disabled={retrying}
      >
        {t(retrying ? "mail.error.retrying" : "mail.error.tryAgain")}
      </Button>
    </div>
  );
}

function WidgetSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true" className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3", index % 2 === 0 ? "w-full" : "w-2/3")}
        />
      ))}
    </div>
  );
}

function useOpenThread() {
  const navigate = useNavigate();
  const { view = "inbox" } = useParams<{ view?: string }>();
  const listView = mailViewHasThreadLinks(view) ? view : "all";
  return (threadId: string, accountEmail?: string) =>
    void navigate(
      mailThreadHref(listView, threadId, new URLSearchParams(), accountEmail),
    );
}

type NoteLine = {
  key: string;
  date?: string;
  text: string;
  heading: boolean;
  link?: { label: string; url: string };
  pending?: boolean;
};

const LINK_AT_END = /\s*\[([^\]]+)\]\(([^)\s]+)\)\s*$/;

export function noteLines(markdown: string): NoteLine[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let rest = line;
      const heading = /^#{1,6}\s+/.test(rest);
      rest = rest.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "");
      const date = /^\*\*([^*]+)\*\*\s+/.exec(rest);
      if (date) rest = rest.slice(date[0].length);
      const link = LINK_AT_END.exec(rest);
      if (link) rest = rest.slice(0, link.index);
      const dateText = date?.[1];
      const label = link?.[1];
      const url = link?.[2];
      return {
        key: `${index}:${line}`,
        heading,
        text: rest.replace(/\*\*([^*]+)\*\*/g, "$1"),
        ...(dateText ? { date: dateText } : {}),
        ...(label && url ? { link: { label, url } } : {}),
      };
    });
}

function NoteLink({ label, url }: { label: string; url: string }) {
  if (!URL.canParse(url, window.location.origin)) return null;
  const target = new URL(url, window.location.origin);
  const className =
    "ms-1 text-[11px] text-primary/80 hover:text-primary hover:underline";
  if (target.origin === window.location.origin) {
    return (
      <Link to={`${target.pathname}${target.search}`} className={className}>
        {label}
      </Link>
    );
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return null;
  return (
    <a
      href={target.toString()}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {label}
    </a>
  );
}

function errorCodeOf(error: unknown) {
  return error instanceof Error && "errorCode" in error
    ? error.errorCode
    : undefined;
}

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function NotesWidget({
  email,
  name,
  threadId,
  subject,
}: {
  email: string;
  name: string;
  threadId?: string | undefined;
  subject?: string | undefined;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const note = useContactNote(email, true);
  const addNote = useAddContactNote(email);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const url = note.data?.note?.url;

  const save = () => {
    const text = draft.trim();
    if (!text || pending !== null) return;
    setPending(text);
    setDraft("");
    addNote.mutate(
      {
        text,
        name,
        ...(threadId ? { threadId } : {}),
        ...(subject ? { subject } : {}),
      },
      {
        onSuccess: (result) => {
          const savedUrl = result.note.url;
          if (result.created && savedUrl) {
            toast(t("mail.contactPanel.savedToMailNotes"), {
              action: {
                label: t("mail.contactPanel.open"),
                onClick: () => openExternal(savedUrl),
              },
            });
          }
        },
        onError: (error) => {
          setDraft((current) => current || text);
          reportWriteFailure(error, {
            label: t("mail.contactPanel.noteSaveError"),
          });
        },
        onSettled: () => setPending(null),
      },
    );
  };

  const lines = note.data?.note ? noteLines(note.data.note.markdown) : [];
  if (pending !== null) {
    lines.push({
      key: "pending",
      heading: false,
      date: formatDate(new Date(), { month: "short", day: "numeric" }),
      text: pending,
      pending: true,
    });
  }

  return (
    <WidgetSection
      title={t("mail.contactPanel.notes")}
      action={
        url ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => openExternal(url)}
                aria-label={t("mail.contactPanel.openInContent")}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground"
              >
                <IconArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {t("mail.contactPanel.openInContent")}
            </TooltipContent>
          </Tooltip>
        ) : null
      }
    >
      {note.isPending ? (
        <WidgetSkeleton rows={2} />
      ) : note.isError ? (
        <WidgetError
          message={
            errorCodeOf(note.error) === "content_unavailable"
              ? t("mail.contactPanel.notesContentUnreachable")
              : t("mail.contactPanel.notesLoadError")
          }
          retrying={note.isFetching}
          onRetry={() => void note.refetch()}
        />
      ) : (
        <>
          {note.data.note?.truncated && (
            <p className="mb-1 text-[11px] text-muted-foreground/60">
              {t("mail.contactPanel.olderNotesInContent")}
            </p>
          )}
          {lines.length > 0 && (
            <ul className="mb-2 max-h-60 space-y-1 overflow-y-auto">
              {lines.map((line) => (
                <li
                  key={line.key}
                  className={cn(
                    "text-[12px] leading-snug text-foreground/75 break-words",
                    line.heading && "font-medium text-foreground/90",
                    line.pending && "opacity-60",
                  )}
                >
                  {line.date && (
                    <span className="me-1.5 text-[11px] text-muted-foreground/60 tabular-nums">
                      {line.date}
                    </span>
                  )}
                  {line.text}
                  {line.link && (
                    <NoteLink label={line.link.label} url={line.link.url} />
                  )}
                </li>
              ))}
            </ul>
          )}
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                save();
              }
            }}
            placeholder={t("mail.contactPanel.addNote")}
            aria-label={t("mail.contactPanel.addNote")}
            maxLength={2000}
            className="w-full rounded-md border border-transparent bg-transparent px-0 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-border focus:bg-background focus:px-2"
          />
        </>
      )}
    </WidgetSection>
  );
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted-foreground/60";
  if (mimeType === "application/pdf")
    return <IconFileTypePdf className={className} />;
  if (mimeType.startsWith("image/")) return <IconPhoto className={className} />;
  if (/spreadsheet|excel|csv/.test(mimeType))
    return <IconFileSpreadsheet className={className} />;
  if (/word|document|text\//.test(mimeType))
    return <IconFileText className={className} />;
  return <IconFile className={className} />;
}

export function AttachmentsWidget({ email }: { email: string }) {
  const t = useT();
  const { formatDate } = useFormatters();
  const openThread = useOpenThread();
  const query = useContactAttachments(email, true);
  const [expanded, setExpanded] = useState(false);
  const files = query.data?.attachments ?? [];
  const shown = expanded ? files : files.slice(0, ATTACHMENTS_SHOWN);
  const hidden = files.length - shown.length;

  return (
    <WidgetSection title={t("mail.contactPanel.attachments")}>
      {query.isPending ? (
        <WidgetSkeleton rows={2} />
      ) : query.isError ? (
        <WidgetError
          message={t("mail.contactPanel.attachmentsLoadError")}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : files.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/60">
          {t("mail.contactPanel.noAttachments")}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((file: ContactAttachment) => (
            <li key={`${file.emailId}:${file.id}`}>
              <button
                type="button"
                onClick={() => openThread(file.threadId, file.accountEmail)}
                title={file.subject}
                className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded px-1.5 py-1 text-start hover:bg-accent/60"
              >
                <AttachmentIcon mimeType={file.mimeType} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/75">
                  {file.filename}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground/50 tabular-nums">
                  {formatDate(file.date, { month: "short", day: "numeric" })}
                </span>
              </button>
            </li>
          ))}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="py-1 text-[11px] text-muted-foreground/70 hover:text-foreground"
              >
                {t("mail.contactPanel.moreAttachments", { count: hidden })}
              </button>
            </li>
          )}
        </ul>
      )}
    </WidgetSection>
  );
}

export type RecentContactEmail = {
  id: string;
  threadId: string;
  subject: string;
  date: string;
  accountEmail?: string;
};

export function RecentWidget({
  emails,
  error,
}: {
  emails: RecentContactEmail[];
  error?: boolean | undefined;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const openThread = useOpenThread();

  if (error) {
    return (
      <WidgetSection title={t("mail.contactPanel.recent")}>
        <p className="text-[11px] text-muted-foreground/70" aria-live="polite">
          {t("mail.error.loadTitle")}
        </p>
      </WidgetSection>
    );
  }
  if (emails.length === 0) return null;

  return (
    <WidgetSection title={t("mail.contactPanel.recent")}>
      <ul className="space-y-0.5">
        {emails.map((email) => (
          <li key={email.id}>
            <button
              type="button"
              onClick={() => openThread(email.threadId, email.accountEmail)}
              className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded px-1.5 py-1 text-start hover:bg-accent/60"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground/80">
                {email.subject}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground/50 tabular-nums">
                {formatDate(email.date, { month: "short", day: "numeric" })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </WidgetSection>
  );
}
