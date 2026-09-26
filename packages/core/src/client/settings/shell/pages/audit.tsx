import { Skeleton } from "@agent-native/toolkit/design-system";
import { Avatar, AvatarFallback } from "@agent-native/toolkit/ui/avatar";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@agent-native/toolkit/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { IconHistory, IconSettings, IconSparkles } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import type { AuditEvent } from "../../../../audit/types.js";
import { getTemplate } from "../../../../cli/templates-meta.js";
import { useFormatters, useT } from "../../../i18n.js";
import {
  callAction,
  defaultActionQueryRetry,
  defaultActionQueryRetryDelay,
  useActionQuery,
} from "../../../use-action.js";
import { cn } from "../../../utils.js";
import { SettingsGroup } from "../../SettingsRow.js";

export const AUDIT_PAGE_SIZE = 25;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALL_APPS = "all";

const RANGES = [
  { days: 7, labelKey: "agentChat.settings.audit.last7Days" },
  { days: 30, labelKey: "agentChat.settings.audit.last30Days" },
  { days: 90, labelKey: "agentChat.settings.audit.last90Days" },
] as const;
type RangeDays = (typeof RANGES)[number]["days"];

interface AuditEventPage {
  events: AuditEvent[];
  hasMore: boolean;
  nextOffset: number | null;
  apps?: string[];
}

type Translate = ReturnType<typeof useT>;

export function auditAppLabel(app: string): string {
  const template = getTemplate(app);
  if (template?.label) return template.label;
  return app
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function actorLabel(event: AuditEvent, t: Translate): string {
  if (event.actorKind === "agent") return t("agentChat.common.agent");
  if (event.actorKind === "system" || !event.actorEmail) {
    return t("agentChat.settings.audit.system");
  }
  return event.actorEmail;
}

function initials(email: string): string {
  const local = email.split("@", 1)[0] ?? email;
  const letters = local
    .split(/[._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return letters || "?";
}

function ActorMark({ event }: { event: AuditEvent }) {
  if (event.actorKind === "agent" || event.actorKind === "system") {
    const Icon = event.actorKind === "agent" ? IconSparkles : IconSettings;
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    <Avatar className="size-8 shrink-0">
      <AvatarFallback className="border border-border bg-background text-xs font-medium text-muted-foreground">
        {initials(event.actorEmail ?? "")}
      </AvatarFallback>
    </Avatar>
  );
}

function StatusBadge({ event }: { event: AuditEvent }) {
  const t = useT();
  if (event.status === "success") return null;
  return (
    <Badge variant="outline">
      {event.status === "denied"
        ? t("agentChat.settings.audit.refused")
        : t("agentChat.settings.audit.failed")}
    </Badge>
  );
}

function useEventDate() {
  const formatters = useFormatters();
  return (createdAt: number) =>
    formatters.formatDate(createdAt, {
      month: "short",
      day: "numeric",
      ...(new Date(createdAt).getFullYear() !== new Date().getFullYear()
        ? { year: "numeric" }
        : {}),
    });
}

function AuditRow({
  event,
  onOpen,
}: {
  event: AuditEvent;
  onOpen: (event: AuditEvent) => void;
}) {
  const t = useT();
  const eventDate = useEventDate();
  const meta = [
    eventDate(event.createdAt),
    event.app ? auditAppLabel(event.app) : null,
    actorLabel(event, t),
  ].filter(Boolean);
  return (
    <button
      type="button"
      data-audit-event={event.id}
      onClick={() => onOpen(event)}
      className="flex w-full items-center gap-3 px-5 py-4 text-start transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none sm:px-6"
    >
      <ActorMark event={event} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {event.summary || event.action}
          </span>
          <StatusBadge event={event} />
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
          {meta.join(" · ")}
        </span>
      </span>
    </button>
  );
}

function AuditRowsSkeleton({ rows }: { rows: number }) {
  const t = useT();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("agentChat.settings.audit.loading")}
      className="divide-y divide-border/60"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 px-5 py-4 sm:px-6"
          data-audit-skeleton=""
        >
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={cn("h-3.5", index % 2 ? "w-2/5" : "w-3/5")} />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

function AuditEventDialog({
  event,
  open,
  onOpenChange,
}: {
  event: AuditEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const formatters = useFormatters();
  // The list omits each event's input; fetch it only for the open event.
  const detail = useActionQuery<{ event: AuditEvent | null }>(
    "get-audit-event" as never,
    { id: event?.id ?? "" } as never,
    { enabled: open && Boolean(event), staleTime: Infinity },
  );
  const input = detail.data?.event?.input ?? null;
  const prettyInput = input ? prettyJson(input) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        closeLabel={t("agentChat.settings.audit.close")}
      >
        {event ? (
          <>
            <DialogHeader className="pe-8">
              <DialogTitle className="text-base leading-6">
                {event.summary || event.action}
              </DialogTitle>
            </DialogHeader>
            <dl className="divide-y divide-border/60">
              <DetailField label={t("agentChat.settings.audit.when")}>
                {formatters.formatDate(event.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </DetailField>
              <DetailField label={t("agentChat.settings.audit.changedBy")}>
                {actorLabel(event, t)}
              </DetailField>
              {event.actorKind === "agent" && event.actorEmail ? (
                <DetailField label={t("agentChat.settings.audit.onBehalfOf")}>
                  {event.actorEmail}
                </DetailField>
              ) : null}
              {event.app ? (
                <DetailField label={t("agentChat.settings.audit.app")}>
                  {auditAppLabel(event.app)}
                </DetailField>
              ) : null}
              <DetailField label={t("agentChat.settings.audit.result")}>
                {event.status === "success"
                  ? t("agentChat.settings.audit.succeeded")
                  : event.status === "denied"
                    ? t("agentChat.settings.audit.refused")
                    : t("agentChat.settings.audit.failed")}
              </DetailField>
              <DetailField label={t("agentChat.settings.audit.action")}>
                <code className="font-mono text-[13px]">{event.action}</code>
              </DetailField>
              {event.targetType ? (
                <DetailField label={t("agentChat.settings.audit.target")}>
                  <code className="font-mono text-[13px]">
                    {[event.targetType, event.targetId]
                      .filter(Boolean)
                      .join(" · ")}
                  </code>
                </DetailField>
              ) : null}
              {detail.isLoading ? (
                <DetailField label={t("agentChat.settings.audit.input")}>
                  <Skeleton className="h-16 w-full" />
                </DetailField>
              ) : detail.isError ? (
                <DetailField label={t("agentChat.settings.audit.input")}>
                  <span className="text-destructive">
                    {t("agentChat.settings.audit.inputLoadFailed")}
                  </span>
                </DetailField>
              ) : prettyInput ? (
                <DetailField label={t("agentChat.settings.audit.input")}>
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5">
                    {prettyInput}
                  </pre>
                </DetailField>
              ) : null}
            </dl>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // coercion-ok: the stored input is already redacted text; show it as is.
    return raw;
  }
}

export default function AuditLogSettingsPage() {
  const t = useT();
  const [range, setRange] = useState<RangeDays>(30);
  const [sinceMs, setSinceMs] = useState(() => Date.now() - 30 * DAY_MS);
  const [app, setApp] = useState<string>(ALL_APPS);
  const [shownPages, setShownPages] = useState(1);
  // Kept after close so the dialog's content stays put while it animates out.
  const [openEvent, setOpenEvent] = useState<AuditEvent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDetail = (event: AuditEvent) => {
    setOpenEvent(event);
    setDialogOpen(true);
  };

  const appsQuery = useActionQuery<AuditEventPage>(
    "list-audit-events" as never,
    { scope: "organization", limit: 1, includeApps: true } as never,
    { staleTime: 60_000 },
  );
  const apps = appsQuery.data?.apps ?? [];
  const appChoices =
    app !== ALL_APPS && !apps.includes(app) ? [app, ...apps] : apps;

  const filters = {
    scope: "organization" as const,
    sinceMs,
    ...(app !== ALL_APPS ? { app } : {}),
  };
  const events = useInfiniteQuery({
    queryKey: ["action", "list-audit-events", { ...filters, paged: true }],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      callAction<AuditEventPage>(
        "list-audit-events" as never,
        { ...filters, limit: AUDIT_PAGE_SIZE, offset: pageParam } as never,
        { method: "GET", signal },
      ),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    retry: defaultActionQueryRetry,
    retryDelay: defaultActionQueryRetryDelay,
  });

  const pages = events.data?.pages ?? [];
  // One page is always fetched past the shown ones so "Show N more" names the
  // real count instead of guessing a page size.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = events;
  const nextPageFailed = events.isFetchNextPageError;
  useEffect(() => {
    if (
      pages.length <= shownPages &&
      hasNextPage &&
      !isFetchingNextPage &&
      !nextPageFailed
    ) {
      void fetchNextPage();
    }
  }, [
    pages.length,
    shownPages,
    hasNextPage,
    isFetchingNextPage,
    nextPageFailed,
    fetchNextPage,
  ]);

  const shown = pages.slice(0, shownPages).flatMap((page) => page.events);
  const nextCount = pages[shownPages]?.events.length ?? 0;
  const lastShownHasMore = pages[shownPages - 1]?.hasMore ?? false;

  const changeRange = (value: string) => {
    const days = Number(value) as RangeDays;
    setRange(days);
    setSinceMs(Date.now() - days * DAY_MS);
    setShownPages(1);
  };
  const changeApp = (value: string) => {
    setApp(value);
    setShownPages(1);
  };

  let body: ReactNode;
  if (events.isError && !events.data) {
    body = (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
      >
        <p className="text-sm text-destructive">
          {t("agentChat.settings.audit.loadFailed")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={events.isFetching}
          onClick={() => void events.refetch()}
        >
          {t("agentChat.common.retry")}
        </Button>
      </div>
    );
  } else if (!events.data) {
    body = <AuditRowsSkeleton rows={5} />;
  } else if (shown.length === 0) {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconHistory />
          </EmptyMedia>
          <EmptyTitle>{t("agentChat.settings.audit.empty")}</EmptyTitle>
          <EmptyDescription>
            {t("agentChat.settings.audit.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    body = (
      <>
        {shown.map((event) => (
          <AuditRow key={event.id} event={event} onOpen={openDetail} />
        ))}
        {nextCount > 0 ? (
          <div className="flex min-h-12 items-center justify-center px-6 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShownPages((count) => count + 1)}
            >
              {t("agentChat.settings.audit.showMore", { count: nextCount })}
            </Button>
          </div>
        ) : lastShownHasMore && events.isFetchNextPageError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
          >
            <p className="text-sm text-destructive">
              {t("agentChat.settings.audit.loadFailed")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void fetchNextPage()}
            >
              {t("agentChat.common.retry")}
            </Button>
          </div>
        ) : lastShownHasMore ? (
          <AuditRowsSkeleton rows={1} />
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-audit-log="">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(range)} onValueChange={changeRange}>
          <SelectTrigger
            size="sm"
            className="w-auto"
            aria-label={t("agentChat.settings.audit.range")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((option) => (
              <SelectItem key={option.days} value={String(option.days)}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={app} onValueChange={changeApp}>
          <SelectTrigger
            size="sm"
            className="w-auto"
            aria-label={t("agentChat.settings.audit.app")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_APPS}>
              {t("agentChat.settings.audit.allApps")}
            </SelectItem>
            {appChoices.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {auditAppLabel(choice)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <SettingsGroup id="audit-log">{body}</SettingsGroup>
      <AuditEventDialog
        event={openEvent}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
