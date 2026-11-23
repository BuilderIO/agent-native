import { writeClientAppState } from "@agent-native/core/client/application-state";
import {
  actionErrorCode,
  callAction,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { Tooltip } from "@agent-native/toolkit/design-system";
import {
  IconCalendarTime,
  IconChevronRight,
  IconDots,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { toast } from "sonner";
import type { z } from "zod";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TAB_ID } from "@/lib/tab-id";

import type {
  listScheduleRunsOutput,
  listSchedulesOutput,
  PublishedAppScheduleConfig,
  scheduleTickView,
  scheduleView,
  setScheduleInput,
} from "../../../shared/published-app-schedules";
import {
  PublishedAppScheduleForm,
  scheduleErrorKey,
} from "./PublishedAppScheduleForm";

type Schedule = z.infer<typeof scheduleView>;
type ScheduleChange = z.infer<typeof setScheduleInput>["change"];
type Tick = z.infer<typeof scheduleTickView>;
type ScheduleTab = "notifications" | "run-log";

export function PublishedAppSchedulePanel({
  projectId,
  releaseId,
  rail = null,
}: {
  projectId: string;
  releaseId: string;
  rail?: HTMLElement | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const toolbarControl = useRef<HTMLButtonElement>(null);
  const railId = useId();
  const docked = wide && rail !== null;
  const label = t("publishedSchedule.title");
  useEffect(() => {
    const viewport = window.matchMedia("(min-width: 768px)");
    const update = () => setWide(viewport.matches);
    update();
    viewport.addEventListener("change", update);
    return () => viewport.removeEventListener("change", update);
  }, []);
  function close() {
    setOpen(false);
    if (docked) requestAnimationFrame(() => toolbarControl.current?.focus());
  }
  const control = (
    <Button
      ref={toolbarControl}
      variant="ghost"
      size="icon"
      className="size-11 sm:size-8"
      aria-label={label}
      {...(docked && {
        "aria-expanded": open,
        "aria-controls": open ? railId : undefined,
        onClick: () => setOpen((value) => !value),
      })}
    >
      <IconCalendarTime aria-hidden />
    </Button>
  );
  const manager = open ? (
    <ScheduleManager
      projectId={projectId}
      releaseId={releaseId}
      close={close}
    />
  ) : null;

  if (docked) {
    return (
      <>
        <Tooltip content={label} trigger={control} placement="bottom" />
        {open
          ? createPortal(
              <aside
                id={railId}
                aria-label={label}
                className="flex h-full w-75 flex-col border-s bg-background"
                onKeyDown={(event) => {
                  if (
                    event.key === "Escape" &&
                    !event.defaultPrevented &&
                    event.currentTarget.contains(event.target as Node)
                  )
                    close();
                }}
              >
                {manager}
              </aside>,
              rail,
            )
          : null}
      </>
    );
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip
        content={label}
        trigger={<SheetTrigger asChild>{control}</SheetTrigger>}
        placement="bottom"
      />
      <SheetContent
        aria-describedby={undefined}
        showClose={false}
        showOverlay={false}
        className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-full"
      >
        <SheetTitle className="sr-only">{label}</SheetTitle>
        {manager}
      </SheetContent>
    </Sheet>
  );
}

function ScheduleManager({
  projectId,
  releaseId,
  close,
}: {
  projectId: string;
  releaseId: string;
  close: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<ScheduleTab>("notifications");
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [schedulePages, setSchedulePages] = useState<string[]>([]);
  const [logPages, setLogPages] = useState<string[]>([]);
  const [form, setForm] = useState<{ id: string; schedule?: Schedule } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const mutation = useRef<{ intent: string; opId: string } | null>(null);
  const formOpener = useRef<HTMLElement | null>(null);
  const panelStateKey = `published-app-schedule:${TAB_ID}`;
  const scheduleCursor = schedulePages.at(-1);
  const runCursor = logPages.at(-1);
  const schedules = useActionQuery<z.infer<typeof listSchedulesOutput>>(
    "list-published-app-schedules",
    {
      projectId,
      filter,
      ...(scheduleCursor ? { cursor: scheduleCursor } : {}),
    },
    { interactive: true },
  );
  const canManage = schedules.data?.canManage === true;
  const log = useActionQuery<z.infer<typeof listScheduleRunsOutput>>(
    "list-published-app-schedule-runs",
    { projectId, ...(runCursor ? { cursor: runCursor } : {}) },
    {
      enabled: canManage && tab === "run-log",
      interactive: true,
      refetchInterval: (query) =>
        !runCursor &&
        query.state.data?.runs.some(
          (run) =>
            run.status === "queued" ||
            run.status === "running" ||
            run.status === "stopping",
        )
          ? 1_000
          : false,
    },
  );

  useEffect(() => {
    if (tab === "run-log" && schedules.data && !canManage)
      setTab("notifications");
  }, [tab, canManage, schedules.data]);
  const schedulesEmpty = schedules.data?.schedules.length === 0;
  const runsEmpty = log.data?.runs.length === 0;
  useEffect(() => {
    if (schedulesEmpty && schedulePages.length)
      setSchedulePages((pages) => pages.slice(0, -1));
  }, [schedulesEmpty, schedulePages.length]);
  useEffect(() => {
    if (runsEmpty && logPages.length)
      setLogPages((pages) => pages.slice(0, -1));
  }, [runsEmpty, logPages.length]);
  useEffect(() => {
    void writeClientAppState(
      panelStateKey,
      { projectId, releaseId, panel: "schedules", tab },
      { requestSource: TAB_ID },
    ).catch((error) =>
      console.error("Could not report the schedule panel", error),
    );
  }, [panelStateKey, projectId, releaseId, tab]);
  useEffect(
    () => () => {
      void writeClientAppState(panelStateKey, null, {
        requestSource: TAB_ID,
      }).catch((error) =>
        console.error("Could not clear the schedule panel", error),
      );
    },
    [panelStateKey],
  );

  function openForm(opener: HTMLElement | null, schedule?: Schedule) {
    formOpener.current = opener;
    setForm(
      schedule
        ? { id: schedule.scheduleId, schedule }
        : { id: crypto.randomUUID() },
    );
    setRowError(null);
  }

  function closeForm() {
    setForm(null);
    const opener = formOpener.current;
    if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
  }

  async function changeSchedule(change: ScheduleChange) {
    const intent = JSON.stringify(change);
    if (mutation.current?.intent !== intent)
      mutation.current = { intent, opId: crypto.randomUUID() };
    const result = await callAction("set-published-app-schedule", {
      projectId,
      opId: mutation.current.opId,
      change,
    });
    mutation.current = null;
    if (
      result.effect === "created" &&
      (schedulePages.length || filter === "mine")
    ) {
      setSchedulePages([]);
      setFilter("all");
    } else {
      void schedules.refetch();
    }
    return result;
  }

  async function saveForm(config: PublishedAppScheduleConfig) {
    if (!form) return;
    try {
      await changeSchedule(
        form.schedule
          ? {
              kind: "edit",
              scheduleId: form.id,
              expectedRevision: form.schedule.revision,
              config,
            }
          : { kind: "create", scheduleId: form.id, config },
      );
      closeForm();
      toast.success(t("publishedSchedule.saved"));
    } catch (error) {
      if (actionErrorCode(error) === "schedule_revision_conflict")
        void schedules.refetch();
      throw error;
    }
  }

  async function updateSchedule(
    kind: "pause" | "resume" | "delete",
    schedule: Schedule,
  ) {
    setBusy(true);
    setRowError(null);
    try {
      await changeSchedule({
        kind,
        scheduleId: schedule.scheduleId,
        expectedRevision: schedule.revision,
      });
      setConfirm(null);
      toast.success(t("publishedSchedule.saved"));
    } catch (error) {
      setRowError(t(`publishedSchedule.${scheduleErrorKey(error)}`));
      if (actionErrorCode(error) === "schedule_revision_conflict") {
        setConfirm(null);
        void schedules.refetch();
      }
    } finally {
      setBusy(false);
    }
  }

  async function stopRun(tickId: string) {
    setBusy(true);
    setRowError(null);
    try {
      await callAction("stop-published-app-schedule-run", {
        projectId,
        tickId,
        opId: crypto.randomUUID(),
      });
      void log.refetch();
    } catch (error) {
      setRowError(
        t(
          actionErrorCode(error) === "schedule_forbidden"
            ? "publishedSchedule.forbidden"
            : "publishedSchedule.stopFailed",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function chooseFilter(value: "all" | "mine") {
    setFilter(value);
    setSchedulePages([]);
    setRowError(null);
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(value === "run-log" ? "run-log" : "notifications");
        setRowError(null);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center justify-between border-b px-3">
        <TabsList className="h-auto gap-3 rounded-none bg-transparent p-0">
          <TabsTrigger
            value="notifications"
            className="h-11 rounded-none border-b-2 border-transparent px-0 data-[state=active]:border-primary data-[state=active]:shadow-none"
          >
            {t("publishedSchedule.notifications")}
          </TabsTrigger>
          <TabsTrigger
            value="run-log"
            disabled={!canManage}
            className="h-11 rounded-none border-b-2 border-transparent px-0 data-[state=active]:border-primary data-[state=active]:shadow-none"
          >
            {t("publishedSchedule.runLog")}
          </TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 sm:size-8"
          aria-label={t("publishedSchedule.close")}
          onClick={close}
        >
          <IconChevronRight aria-hidden />
        </Button>
      </div>
      <TabsContent
        value="notifications"
        className="m-0 min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {t("publishedSchedule.title")}
          </h2>
          {canManage ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 sm:h-7"
              onClick={(event) => openForm(event.currentTarget)}
            >
              <IconPlus aria-hidden />
              {t("publishedSchedule.add")}
            </Button>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("publishedSchedule.setup")}{" "}
          <a
            className="text-primary hover:underline"
            href="https://www.agent-native.com/docs/"
            target="_blank"
            rel="noreferrer"
          >
            {t("publishedSchedule.learnMore")}
          </a>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          <Button
            variant={
              filter === "all" && (canManage || !schedules.data)
                ? "outline"
                : "ghost"
            }
            aria-pressed={filter === "all" && (canManage || !schedules.data)}
            disabled={schedules.data !== undefined && !canManage}
            className="h-11 min-w-0 px-1 text-xs sm:h-7"
            onClick={() => chooseFilter("all")}
          >
            {t("publishedSchedule.all")}
          </Button>
          <Button
            variant={
              filter === "mine" || (schedules.data && !canManage)
                ? "outline"
                : "ghost"
            }
            aria-pressed={
              filter === "mine" || Boolean(schedules.data && !canManage)
            }
            className="h-11 min-w-0 px-1 text-xs sm:h-7"
            onClick={() => chooseFilter("mine")}
          >
            {t("publishedSchedule.mine")}
          </Button>
        </div>
        {rowError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {rowError}
          </p>
        ) : null}
        {schedules.isPending ? (
          <LoadingRows label={t("publishedSchedule.loading")} />
        ) : schedules.isError ? (
          <LoadError
            error={schedules.error}
            fallback={t("publishedSchedule.loadFailed")}
            retry={() => void schedules.refetch()}
          />
        ) : schedules.data.schedules.length === 0 ? (
          <div className="mx-auto mt-8 grid max-w-56 justify-items-center gap-2 text-center">
            <div className="grid size-12 place-items-center rounded-full border text-muted-foreground">
              <IconCalendarTime aria-hidden className="size-5" />
            </div>
            <p className="mt-1 text-sm font-medium">
              {t("publishedSchedule.emptyTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("publishedSchedule.emptyDescription")}
            </p>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-11 sm:h-8"
                onClick={(event) => openForm(event.currentTarget)}
              >
                {t("publishedSchedule.addSchedule")}
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="mt-3 divide-y">
            {schedules.data.schedules.map((schedule) => (
              <ScheduleRow
                key={schedule.scheduleId}
                schedule={schedule}
                canManage={canManage}
                busy={busy}
                onEdit={(opener) => openForm(opener, schedule)}
                onToggle={() =>
                  void updateSchedule(
                    schedule.enabled ? "pause" : "resume",
                    schedule,
                  )
                }
                onDelete={() => {
                  setRowError(null);
                  setConfirm(schedule);
                }}
              />
            ))}
          </ul>
        )}
        <Pager
          previous={schedulePages.length > 0}
          next={schedules.data?.nextCursor ?? null}
          onPrevious={() => setSchedulePages((pages) => pages.slice(0, -1))}
          onNext={(cursor) => setSchedulePages((pages) => [...pages, cursor])}
        />
      </TabsContent>
      <TabsContent
        value="run-log"
        className="m-0 min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {rowError ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {rowError}
          </p>
        ) : null}
        {log.isPending ? (
          <LoadingRows label={t("publishedSchedule.loadingLog")} />
        ) : log.isError ? (
          <LoadError
            error={log.error}
            fallback={t("publishedSchedule.loadLogFailed")}
            retry={() => void log.refetch()}
          />
        ) : log.data.runs.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            {t("publishedSchedule.emptyLog")}
          </p>
        ) : (
          <ul className="divide-y">
            {log.data.runs.map((run) => (
              <RunRow
                key={run.tickId}
                projectId={projectId}
                run={run}
                busy={busy}
                onStop={() => void stopRun(run.tickId)}
              />
            ))}
          </ul>
        )}
        <Pager
          previous={logPages.length > 0}
          next={log.data?.nextCursor ?? null}
          onPrevious={() => setLogPages((pages) => pages.slice(0, -1))}
          onNext={(cursor) => setLogPages((pages) => [...pages, cursor])}
        />
      </TabsContent>
      {form && canManage ? (
        <PublishedAppScheduleForm
          projectId={projectId}
          schedule={form.schedule}
          notificationsAvailable={
            schedules.data?.notificationsAvailable === true
          }
          onClose={closeForm}
          onSubmit={saveForm}
        />
      ) : null}
      {confirm && canManage ? (
        <AlertDialog
          open
          onOpenChange={(value) => {
            if (!value && !busy) setConfirm(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("publishedSchedule.deleteTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("publishedSchedule.deleteDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {rowError ? (
              <p role="alert" className="text-sm text-destructive">
                {rowError}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>
                {t("publishedSchedule.cancel")}
              </AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void updateSchedule("delete", confirm)}
              >
                {t(
                  busy
                    ? "publishedSchedule.saving"
                    : "publishedSchedule.delete",
                )}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </Tabs>
  );
}

function LoadingRows({ label }: { label: string }) {
  return (
    <div role="status" className="mt-3 space-y-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function LoadError({
  error,
  fallback,
  retry,
}: {
  error: unknown;
  fallback: string;
  retry: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"
    >
      <p>
        {actionErrorCode(error) === "schedule_forbidden"
          ? t("publishedSchedule.forbidden")
          : fallback}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-11 sm:h-8"
        onClick={retry}
      >
        {t("publishedSchedule.retry")}
      </Button>
    </div>
  );
}

function Pager({
  previous,
  next,
  onPrevious,
  onNext,
}: {
  previous: boolean;
  next: string | null;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
}) {
  const t = useT();
  if (!previous && next === null) return null;
  return (
    <div className="sticky bottom-0 flex justify-between gap-2 border-t bg-background py-2">
      <Button
        variant="outline"
        size="sm"
        className="h-11 sm:h-8"
        disabled={!previous}
        onClick={onPrevious}
      >
        {t("publishedSchedule.previousPage")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-11 sm:h-8"
        disabled={next === null}
        onClick={() => {
          if (next) onNext(next);
        }}
      >
        {t("publishedSchedule.nextPage")}
      </Button>
    </div>
  );
}

function ScheduleRow({
  schedule,
  canManage,
  busy,
  onEdit,
  onToggle,
  onDelete,
}: {
  schedule: Schedule;
  canManage: boolean;
  busy: boolean;
  onEdit: (opener: HTMLButtonElement | null) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const menuButton = useRef<HTMLButtonElement>(null);
  const zone = schedule.config.timezone;

  return (
    <li className="flex items-start justify-between gap-2 py-3">
      <div className="grid min-w-0 gap-1 text-sm">
        <p className="font-medium">
          {t(`publishedSchedule.cadence.${schedule.config.cadence.kind}`)}
        </p>
        <div className="flex flex-wrap gap-x-2 text-muted-foreground">
          <span className="break-all">{zone}</span>
          <span>
            {t(
              schedule.enabled
                ? "publishedSchedule.active"
                : "publishedSchedule.paused",
            )}
          </span>
        </div>
        {schedule.nextFireAt ? (
          <time
            dateTime={schedule.nextFireAt}
            className="text-xs text-muted-foreground"
            title={t("publishedSchedule.utc", {
              time: formatDate(schedule.nextFireAt, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
              }),
            })}
          >
            {t("publishedSchedule.next", {
              time: formatDate(schedule.nextFireAt, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: zone,
              }),
              zone,
            })}
          </time>
        ) : null}
      </div>
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={menuButton}
              variant="ghost"
              size="icon"
              className="size-11 sm:size-8"
              disabled={busy}
              aria-label={t("publishedSchedule.options")}
            >
              <IconDots aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(menuButton.current)}>
              {t("publishedSchedule.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggle}>
              {t(
                schedule.enabled
                  ? "publishedSchedule.pause"
                  : "publishedSchedule.resume",
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete}>
              {t("publishedSchedule.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

function RunRow({
  run,
  projectId,
  busy,
  onStop,
}: {
  run: Tick;
  projectId: string;
  busy: boolean;
  onStop: () => void;
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const version = run.releaseId
    ? t("publishedSchedule.version", { version: run.releaseId })
    : null;
  return (
    <li className="grid grid-cols-1 gap-1 py-3 text-sm wrap-anywhere">
      <div className="flex flex-wrap justify-between gap-1">
        <p className="font-medium">{t("publishedSchedule.scheduledRun")}</p>
        <p role="status">{t(`publishedSchedule.runStatus.${run.status}`)}</p>
      </div>
      <time dateTime={run.dueAt} className="text-muted-foreground">
        {t("publishedSchedule.utc", {
          time: formatDate(run.dueAt, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "UTC",
          }),
        })}
      </time>
      {run.releaseId ? (
        <Link
          className="text-primary hover:underline"
          to={`/app/${encodeURIComponent(projectId)}/${encodeURIComponent(run.releaseId)}`}
        >
          {version}
        </Link>
      ) : null}
      {run.diagnostic ? (
        <p className="text-muted-foreground">
          {t("publishedSchedule.reason", { code: run.diagnostic.code })}
        </p>
      ) : null}
      {run.cache === "updated" ? (
        <p>{t("publishedSchedule.publishedUpdated")}</p>
      ) : null}
      {run.cache === "preserved" && run.status === "failed" ? (
        <p>{t("publishedSchedule.publishedPreserved")}</p>
      ) : null}
      {run.cache === "superseded" && version ? (
        <p>{t("publishedSchedule.publishedSuperseded", { version })}</p>
      ) : null}
      {run.deliveries.length ? (
        <ul
          aria-label={t("publishedSchedule.notifications")}
          className="space-y-1 text-xs text-muted-foreground"
        >
          {run.deliveries.map((delivery) => (
            <li key={delivery.memberId} className="flex justify-between gap-2">
              <span className="min-w-0 truncate" title={delivery.memberId}>
                {delivery.memberId}
              </span>
              <span className="shrink-0">
                {t(`publishedSchedule.delivery.${delivery.outcome}`)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {run.status === "queued" || run.status === "running" ? (
        <Button
          variant="outline"
          size="sm"
          className="h-11 w-fit sm:h-8"
          disabled={busy}
          onClick={onStop}
        >
          {t("publishedSchedule.stop")}
        </Button>
      ) : null}
    </li>
  );
}
