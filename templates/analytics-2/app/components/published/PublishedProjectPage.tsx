import { appPath } from "@agent-native/core/client/api-path";
import {
  actionErrorCode,
  actionErrorMessage,
  callAction,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useOrg } from "@agent-native/core/client/org";
import { ReviewThreadPanel } from "@agent-native/toolkit/app/review";
import { useDocumentTitle } from "@agent-native/toolkit/app/shared";
import { Tooltip } from "@agent-native/toolkit/design-system";
import {
  IconChevronRight,
  IconClock,
  IconDots,
  IconLayoutSidebarRight,
  IconLock,
  IconMessage,
  IconPlayerPlay,
  IconPresentation,
  IconRefresh,
  IconRestore,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { WorkspaceAgent } from "@/components/agent";
import { CellOutputView } from "@/components/notebook/CellOutputView";
import {
  displayRows,
  displayTableRows,
} from "@/components/notebook/useNotebookResults";
import { PublishedAppSharePopover } from "@/components/sharing/PublishedAppSharePopover";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceData } from "@/components/workspace/WorkspaceDataContext";
import {
  parseEmbeddedApp,
  parseEmbeddedCell,
  parseEmbedToken,
} from "@/lib/cell-link";
import type { Cell, CellOutput, ProjectDocument } from "@/lib/model/contracts";
import type { ResolvedRoute } from "@/routes/routing/registry";

import type openPublishedResultDrill from "../../../actions/open-published-result-drill";
import type { PresignedEmbedTokenVerification } from "../../../shared/app-embedding";
import { appTabBookmark, resolveAppTab } from "../../../shared/app-layout";
import { appResultCellIds } from "../../../shared/published-app-projection";
import { AppLayoutSnapshot } from "./AppLayoutSnapshot";
import { PublishedAppSchedulePanel } from "./PublishedAppSchedulePanel";
import { usePublishedAppSession } from "./usePublishedAppSession";
import { usePublishedResultPages } from "./usePublishedResultPages";

import "@/components/notebook/notebook.css";

type ViewerProps = {
  route: ResolvedRoute;
  tabBookmark?: string | null;
  onTabChange?: (bookmark: string | null) => void;
  onSessionHref?: (href: string) => void;
  savedViewId?: string;
};

function publishedEmbed(project: ProjectDocument, cellId: string) {
  if (
    !project.cells.some((cell) => cell.id === cellId && !cell.contents.hidden)
  )
    return null;
  if (!project.appLayout) return { cellId, showLabel: true, tabId: null };
  for (const tab of project.appLayout.tabs) {
    const element = tab.rows
      .flatMap(({ columns }) => columns.flatMap(({ elements }) => elements))
      .find(
        (element) => element.cellId === cellId && element.display !== "source",
      );
    if (element)
      return { cellId, showLabel: element.showLabel, tabId: tab.tabId };
  }
  return null;
}

function SignedEmbedGate({
  projectId,
  embedToken,
  children,
}: {
  projectId: string;
  embedToken: string;
  children: ReactNode;
}) {
  const t = useT();
  const verification = useActionQuery<PresignedEmbedTokenVerification>(
    "verify-presigned-embed-token",
    { projectId, token: embedToken },
    { enabled: Boolean(projectId && embedToken), retry: false },
  );
  if (verification.isPending) {
    return (
      <main
        data-published-app="true"
        data-embedded="true"
        className="mx-auto max-w-[960px] space-y-4 p-6"
        aria-busy="true"
      >
        <span role="status" className="sr-only">
          {t("appEmbedding.verifyingToken")}
        </span>
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-56 w-full" />
      </main>
    );
  }
  if (verification.isError || !verification.data?.valid) {
    const reason = verification.data?.reason ?? "invalid";
    const errorDetail =
      reason === "ok"
        ? t("appEmbedding.tokenErrors.invalid")
        : t(`appEmbedding.tokenErrors.${reason}`);
    return (
      <div data-embed-error={reason}>
        <PublishedMessage
          title={t("appEmbedding.tokenErrorTitle")}
          detail={errorDetail}
          accessDenied
        />
      </div>
    );
  }
  return <>{children}</>;
}

export function PublishedProjectPage(props: ViewerProps) {
  const { projectLocator, version, appSessionId } = props.route.params;
  const embedToken = parseEmbedToken(props.route.query.toString());
  const sessionKey = JSON.stringify([
    projectLocator,
    version,
    appSessionId,
    props.savedViewId,
  ]);
  if (embedToken) {
    return (
      <SignedEmbedGate projectId={projectLocator ?? ""} embedToken={embedToken}>
        <PublishedSessionPage key={sessionKey} {...props} signedEmbedValid />
      </SignedEmbedGate>
    );
  }
  return <PublishedSessionPage key={sessionKey} {...props} />;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function usePublishedRefreshedLabel(ranAt: string | null | undefined) {
  const t = useT();
  const { formatDate, formatRelativeTime } = useFormatters();
  const time = ranAt ? Date.parse(ranAt) : Number.NaN;
  if (!Number.isFinite(time)) return undefined;
  const elapsedMs = Math.max(0, Date.now() - time);
  if (elapsedMs < MINUTE_MS) return t("notebook.justNow");
  if (elapsedMs < HOUR_MS) {
    return formatRelativeTime(-Math.floor(elapsedMs / MINUTE_MS), "minute", {
      style: "narrow",
    });
  }
  if (elapsedMs < DAY_MS) {
    return formatRelativeTime(-Math.floor(elapsedMs / HOUR_MS), "hour", {
      style: "narrow",
    });
  }
  if (elapsedMs < WEEK_MS) {
    return formatRelativeTime(-Math.floor(elapsedMs / DAY_MS), "day", {
      style: "narrow",
    });
  }
  return formatDate(time, { dateStyle: "medium" });
}

type PublishedRightPanel = "comments" | "agent" | null;

function PublishedSidePanel({
  panel,
  label,
  rail,
  wide,
  railId,
  onClose,
  children,
}: {
  panel: Exclude<PublishedRightPanel, null>;
  label: string;
  rail: HTMLElement | null;
  wide: boolean;
  railId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const widthClass = panel === "agent" ? "w-96" : "w-75";
  const docked = wide && rail !== null;
  if (docked) {
    return createPortal(
      <aside
        id={railId}
        aria-label={label}
        className={`flex h-full ${widthClass} flex-col border-s bg-background`}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !event.defaultPrevented &&
            event.currentTarget.contains(event.target as Node)
          ) {
            onClose();
          }
        }}
      >
        {children}
      </aside>,
      rail,
    );
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        aria-describedby={undefined}
        showClose={false}
        showOverlay={false}
        className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-full"
      >
        <SheetTitle className="sr-only">{label}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}

function PublishedPanelHeader({
  title,
  sheet,
  onClose,
}: {
  title: string;
  sheet: boolean;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 sm:size-8"
        aria-label={t("share.close")}
        onClick={onClose}
      >
        {sheet ? <IconX aria-hidden /> : <IconChevronRight aria-hidden />}
      </Button>
    </div>
  );
}

function PublishedCommentsPanel({
  projectId,
  canResolve,
  sheet,
  onClose,
}: {
  projectId: string;
  canResolve: boolean;
  sheet: boolean;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <>
      <PublishedPanelHeader
        title={t("notebookHeader.comments")}
        sheet={sheet}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ReviewThreadPanel
          resourceType="analytics-project"
          resourceId={projectId}
          title={t("notebookHeader.comments")}
          showHeader={false}
          variant="plain"
          showFilter
          filterLabel={t("analytics.lists.filters")}
          allCommentsLabel={t("analytics.lists.all")}
          openCommentsLabel={t("projectDiscussions.open")}
          resolvedCommentsLabel={t("projectDiscussions.resolved")}
          emptyState={t("projectDiscussions.empty")}
          loadingLabel={t("projectDiscussions.loading")}
          placeholder={t("projectDiscussions.start")}
          replyLabel={t("projectDiscussions.reply")}
          replyPlaceholder={t("projectDiscussions.reply")}
          cancelReplyLabel={t("common.cancel")}
          resolveLabel={t("projectDiscussions.resolve")}
          reopenLabel={t("projectDiscussions.reopen")}
          cancelDeleteLabel={t("common.cancel")}
          canReply
          canResolve={canResolve}
          canDeleteComment={(comment, thread) =>
            comment.id === thread.root.id
              ? comment.canDeleteThread === true
              : comment.canDelete === true
          }
        />
      </div>
    </>
  );
}

function PublishedAgentPanel({
  projectId,
  sheet,
  onClose,
}: {
  projectId: string;
  sheet: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const workspace = useWorkspaceData();
  const org = useOrg({ enabled: !workspace?.shell.workspace.id });
  const orgId =
    workspace?.shell.workspace.id ??
    (!org.isPending && !org.isError ? org.data.orgId : undefined);
  return (
    <>
      <PublishedPanelHeader
        title={t("analytics.navigation.agent")}
        sheet={sheet}
        onClose={onClose}
      />
      {orgId ? (
        <div className="nb-agent-pane min-h-0 w-full min-w-0 flex-1">
          <WorkspaceAgent mode="notebook" orgId={orgId} projectId={projectId} />
        </div>
      ) : org.isError ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 p-4 text-sm text-destructive"
        >
          <p>{t("error.genericDetails")}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void org.refetch()}
          >
            {t("error.retry")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 p-4" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
    </>
  );
}

function PublishedSessionPage({
  route,
  tabBookmark = null,
  onTabChange,
  onSessionHref,
  savedViewId,
  signedEmbedValid = false,
}: ViewerProps & { signedEmbedValid?: boolean }) {
  const projectId = route.params.projectLocator ?? "";
  const sessionId = route.params.appSessionId;
  const viewer = usePublishedAppSession({
    projectId,
    version: route.params.version ?? "latest",
    ...(sessionId ? { sessionId } : {}),
    ...(savedViewId ? { savedViewId } : {}),
  });
  const t = useT();
  const { formatNumber } = useFormatters();
  const session = viewer.session;
  const project = session?.projection.project;
  const layout = project?.appLayout;
  const embeddedCellId = parseEmbeddedCell(route.query.toString());
  const embeddedApp = parseEmbeddedApp(route.query.toString());
  const embedded = embeddedCellId !== null || embeddedApp;
  const embed =
    project && embeddedCellId ? publishedEmbed(project, embeddedCellId) : null;
  const age = usePublishedRefreshedLabel(session?.refreshedAt);
  const [localTab, setLocalTab] = useState<string | null>(null);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState("");
  const [savePending, setSavePending] = useState(false);
  const [scheduleRail, setScheduleRail] = useState<HTMLDivElement | null>(null);
  const [panelRail, setPanelRail] = useState<HTMLDivElement | null>(null);
  const [rightPanel, setRightPanel] = useState<PublishedRightPanel>(null);
  const [wide, setWide] = useState(false);
  const commentsTrigger = useRef<HTMLButtonElement>(null);
  const agentTrigger = useRef<HTMLButtonElement>(null);
  const panelRailId = useId();
  const [detail, setDetail] = useState<{
    title: string;
    output: CellOutput | null;
  } | null>(null);
  const detailGeneration = useRef(0);
  const header = useRef<HTMLElement>(null);
  const scrollArea = useRef<HTMLElement>(null);
  const [, setMinutes] = useState(0);
  const autoRan = useRef<string | null>(null);
  useEffect(() => {
    const viewport = window.matchMedia("(min-width: 768px)");
    const update = () => setWide(viewport.matches);
    update();
    viewport.addEventListener("change", update);
    return () => viewport.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    // A release published without a finished run has no results to show;
    // run it once on first open instead of leaving every cell empty.
    if (
      !session ||
      session.refreshUnavailable ||
      session.ageStatus !== "unavailable" ||
      session.state !== "ready" ||
      project?.appLayout?.settings.autoRefresh === false ||
      autoRan.current === session.sessionId
    )
      return;
    autoRan.current = session.sessionId;
    viewer.refresh(
      session.caps.refreshDefault && Object.keys(session.overrides).length === 0
        ? "default"
        : "session",
      "reuse",
    );
  });
  useEffect(() => {
    const timer = window.setInterval(
      () => setMinutes((count) => count + 1),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!session || !header.current || !scrollArea.current) return;
    const target = header.current;
    const container = scrollArea.current;
    function measure() {
      container.style.setProperty(
        "--app-session-tabs-offset",
        `${target.offsetHeight}px`,
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [Boolean(session), embedded]);
  const projectedSlugs = session?.projection.tabSlugs;
  const slugs = projectedSlugs && new Map(projectedSlugs);
  const activeTab = layout
    ? resolveAppTab(layout, localTab ?? tabBookmark, slugs).tabId
    : null;
  const neededResults =
    project && (!embeddedCellId || embed)
      ? appResultCellIds(
          project,
          embed?.tabId ?? activeTab,
          session.projection.canViewSource,
        )
      : new Set<string>();
  const { outputs, manifests, loadPage } = usePublishedResultPages(
    Object.entries(session?.projection.outputs ?? {})
      .filter(([cellId]) => neededResults.has(cellId))
      .map(([cellId, output]) => ({
        cellId,
        resultId:
          output.resultStatus === "ready" ? (output.resultId ?? null) : null,
      })),
    { sessionId: session?.sessionId ?? "" },
  );
  const sessionHref = session?.sessionHref;
  useEffect(() => {
    if (!sessionId && sessionHref) onSessionHref?.(sessionHref);
  }, [sessionId, sessionHref, onSessionHref]);
  useDocumentTitle(
    [
      actionErrorCode(viewer.error) === "project_not_found"
        ? t("publishedApp.projectNotFoundTitle")
        : viewer.accessDenied
          ? t("publishedAppSharing.unavailable")
          : project?.title || t("analytics.brand"),
    ],
    undefined,
  );

  function chartResult(cell: Cell) {
    const chart = cell.contents;
    if (chart.kind !== "chart" || chart.chartSpec.xTimeUnit) return undefined;
    const source = project?.cells.find(
      ({ id, contents }) =>
        (contents.kind === "sql" || contents.kind === "code") &&
        (chart.chartSpec.sourceCellId
          ? id === chart.chartSpec.sourceCellId
          : contents.resultVariable === chart.dataframe),
    );
    const manifest = source ? manifests[source.id] : undefined;
    if (!manifest || manifest.manifest.status !== "complete") return undefined;
    const fields = manifest.manifest.fields;
    const field = fields.findIndex(
      ({ name }) => name === chart.chartSpec.xField,
    );
    const column = fields[field];
    if (!column || column.type === "date" || column.type === "datetime")
      return undefined;
    return { manifest, field, column };
  }

  async function openDrilldown(
    cell: Cell,
    point: { x: string; series: string },
  ) {
    const source = chartResult(cell);
    if (!source || !session) return;
    const { manifest, field, column } = source;
    const fields = manifest.manifest.fields;
    const matches = new Map(
      displayRows(manifest.rows, fields).flatMap((row, index) => {
        const value = manifest.rows[index]?.[field];
        return String(row[field]) === point.x && value !== undefined
          ? [[JSON.stringify(value), value] as const]
          : [];
      }),
    );
    const value = matches.values().next().value;
    if (matches.size !== 1 || value === undefined) return;
    const generation = ++detailGeneration.current;
    setDetail({
      title: `${cell.contents.label ?? ""} — ${point.x}`,
      output: null,
    });
    try {
      const result = await callAction<
        Awaited<ReturnType<typeof openPublishedResultDrill.run>>
      >("open-published-result-drill", {
        sessionId: session.sessionId,
        resultId: manifest.manifest.result.resultId,
        filters: [{ fieldId: column.fieldId, value }],
      });
      if (generation !== detailGeneration.current) return;
      if (result.status !== "ready")
        throw new Error(t("publishedApp.drillFailed"));
      setDetail(
        (current) =>
          current && {
            ...current,
            output: displayTableRows(
              result.rows,
              result.fields,
              String(result.totalRows),
              false,
            ),
          },
      );
    } catch (error) {
      if (generation === detailGeneration.current)
        setDetail(
          (current) =>
            current && {
              ...current,
              output: {
                type: "error",
                message:
                  actionErrorMessage(error) ?? t("publishedApp.drillFailed"),
                detail: null,
              },
            },
        );
    }
  }

  async function saveCurrentView() {
    setSavePending(true);
    try {
      const saved = await viewer.saveView(viewName);
      setSavingView(false);
      setViewName("");
      toast.success(t("publishedApp.viewSaved"), {
        action: {
          label: t("publishedApp.openView"),
          onClick: () =>
            window.open(appPath(saved.href), "_blank", "noopener,noreferrer"),
        },
      });
    } catch (error) {
      toast.error(actionErrorMessage(error) ?? t("error.genericDetails"));
    } finally {
      setSavePending(false);
    }
  }

  if (!projectId) {
    return (
      <PublishedMessage
        title={t("publishedApp.missingProjectTitle")}
        detail={t("publishedApp.missingProjectDetail")}
      />
    );
  }
  if (viewer.loading) {
    return (
      <main
        data-published-app="true"
        className="mx-auto max-w-[960px] space-y-4 p-6"
        aria-busy="true"
      >
        <span role="status" className="sr-only">
          {t("publishedApp.loading")}
        </span>
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-56 w-full" />
      </main>
    );
  }
  if (actionErrorCode(viewer.error) === "project_not_found")
    return (
      <PublishedMessage
        title={t("publishedApp.projectNotFoundTitle")}
        detail={t("publishedApp.projectNotFoundDetail")}
        accessDenied
      />
    );
  if (viewer.accessDenied)
    return (
      <PublishedMessage
        title={t("publishedAppSharing.unavailable")}
        detail={t("publishedAppSharing.denied")}
        accessDenied
      />
    );
  if (!session || !project || project.id !== projectId) {
    return (
      <PublishedMessage
        title={t("publishedApp.openFailed")}
        detail={actionErrorMessage(viewer.error) ?? t("error.genericDetails")}
        onRetry={viewer.retry}
      />
    );
  }

  const canViewSource = session.projection.canViewSource;
  const runningCellIds = new Set<string>(session.projection.runningCellIds);
  const runningTabIds = new Set<string>();
  if (runningCellIds.size && layout && layout.tabs.length > 1) {
    for (const { tabId } of layout.tabs) {
      for (const cellId of appResultCellIds(project, tabId, canViewSource)) {
        if (!runningCellIds.has(cellId)) continue;
        runningTabIds.add(tabId);
        break;
      }
    }
  }
  const snapshot = (
    <AppLayoutSnapshot
      cells={project.cells}
      visualizationScope={{
        releaseId: session.releaseId,
        sessionId: session.sessionId,
      }}
      resultIds={Object.fromEntries(
        Object.entries(session.projection.outputs).map(([cellId, output]) => [
          cellId,
          output.resultStatus === "ready" ? (output.resultId ?? null) : null,
        ]),
      )}
      metricSourceResultIds={session.projection.metricSourceResultIds}
      outputs={{ ...session.projection.outputs, ...outputs }}
      layout={layout}
      tabBookmark={activeTab}
      embeddedCell={embeddedCellId !== null ? embed : undefined}
      onTabChange={(tabId) => {
        if (onTabChange && layout)
          onTabChange(appTabBookmark(layout, tabId, slugs));
        else setLocalTab(tabId);
      }}
      runningTabIds={runningTabIds}
      canViewSource={canViewSource}
      values={viewer.values}
      inputChoices={session.inputChoices}
      onChangeValue={viewer.changeInput}
      onCommitValue={viewer.commitInput}
      onCommitValues={viewer.commitInputs}
      onLoadPage={loadPage}
      onMarkClick={(cell, point) => void openDrilldown(cell, point)}
      canDrill={(cell) => chartResult(cell) !== undefined}
    />
  );
  const drilldownDialog = (
    <Dialog
      open={detail !== null}
      onOpenChange={(open) => {
        if (!open) {
          detailGeneration.current++;
          setDetail(null);
        }
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{detail?.title}</DialogTitle>
        </DialogHeader>
        {detail?.output ? (
          <CellOutputView output={detail.output} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
  if (embedded) {
    return (
      <main
        data-published-app="true"
        data-embedded="true"
        data-signed-embed={signedEmbedValid ? "true" : undefined}
        tabIndex={0}
        className="app-session-page p-2"
      >
        {snapshot}
        {drilldownDialog}
      </main>
    );
  }

  const overrideCount = Object.keys(session.overrides).length;
  const fullWidth = project.appLayout?.settings.fullWidth;
  const staleAfter =
    session.staleAfter.kind === "hours" ? session.staleAfter.value : 24;
  const autoRefresh = project.appLayout?.settings.autoRefresh !== false;
  const isStale = session.ageStatus === "stale";
  const refreshScope =
    session.caps.refreshDefault && overrideCount === 0 ? "default" : "session";
  const panelDocked = wide && panelRail !== null;
  function closeRightPanel() {
    const closing = rightPanel;
    setRightPanel(null);
    if (!panelDocked) return;
    const trigger =
      closing === "agent" ? agentTrigger.current : commentsTrigger.current;
    requestAnimationFrame(() => trigger?.focus());
  }
  function togglePresentation() {
    const el = scrollArea.current;
    if (!el) return;
    const failed = () =>
      toast.error(t("publishedApp.presentationMode"), {
        description: t("error.genericDetails"),
      });
    try {
      let request: Promise<void> | void;
      if (document.fullscreenElement) {
        if (typeof document.exitFullscreen !== "function") return failed();
        request = document.exitFullscreen();
      } else {
        if (typeof el.requestFullscreen !== "function") return failed();
        request = el.requestFullscreen();
      }
      void Promise.resolve(request).catch(failed);
    } catch {
      failed();
    }
  }
  const commentsLabel = t("notebookHeader.comments");
  const agentToggleLabel = t("agentPanel.toggleAgent");
  const refreshTriggerLabel = age
    ? t("publishedApp.dataRefreshed", { age })
    : t("publishedApp.dataAgeUnavailable");
  return (
    <main
      data-published-app="true"
      tabIndex={0}
      className="app-session-page"
      ref={scrollArea}
    >
      <header
        className="app-session-header border-b bg-background"
        ref={header}
      >
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-1">
          <div className="flex min-w-0 flex-1 basis-40 items-center gap-0.5">
            <h1 className="min-w-0 truncate px-1 text-sm font-medium">
              {project.title || t("analytics.lists.untitledProject")}
            </h1>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
            {overrideCount > 0 ? (
              <>
                {session.caps.saveView ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    title={t("publishedApp.saveViewTooltip")}
                    onClick={() => setSavingView(true)}
                  >
                    {t("publishedApp.saveView")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("publishedApp.resetInputs", {
                    count: overrideCount,
                  })}
                  title={t("publishedApp.resetInputs", {
                    count: overrideCount,
                  })}
                  onClick={viewer.reset}
                >
                  <IconRestore aria-hidden="true" />
                  {formatNumber(overrideCount)}
                </Button>
              </>
            ) : null}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground"
                  aria-label={refreshTriggerLabel}
                >
                  {viewer.busy ? (
                    <span className="nb-spinner" aria-hidden="true" />
                  ) : isStale && autoRefresh ? (
                    <IconClock size={14} aria-hidden="true" />
                  ) : null}
                  {age ?? t("publishedApp.dataAgeUnavailable")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="grid gap-3">
                <div className="text-sm font-medium">{refreshTriggerLabel}</div>
                {!session.refreshUnavailable && autoRefresh ? (
                  <p className="text-sm text-muted-foreground">
                    {t("publishedApp.refreshPolicy", {
                      count: staleAfter,
                      hours: formatNumber(staleAfter),
                    })}
                  </p>
                ) : null}
                {!session.refreshUnavailable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={viewer.busy}
                    onClick={() => viewer.refresh(refreshScope, "bypass")}
                  >
                    {isStale && autoRefresh ? (
                      <>
                        <IconRefresh aria-hidden="true" />
                        {t("publishedApp.refreshNow")}
                      </>
                    ) : (
                      <>
                        <IconPlayerPlay aria-hidden="true" />
                        {t("analytics.tasks.runNow")}
                      </>
                    )}
                  </Button>
                )}
              </PopoverContent>
            </Popover>
            <Tooltip
              content={commentsLabel}
              placement="bottom"
              trigger={
                <Button
                  ref={commentsTrigger}
                  type="button"
                  variant={rightPanel === "comments" ? "secondary" : "ghost"}
                  size="icon"
                  className="size-11 sm:size-8"
                  aria-label={commentsLabel}
                  aria-pressed={rightPanel === "comments"}
                  aria-controls={
                    panelDocked && rightPanel === "comments"
                      ? panelRailId
                      : undefined
                  }
                  onClick={() =>
                    setRightPanel((current) =>
                      current === "comments" ? null : "comments",
                    )
                  }
                >
                  <IconMessage size={16} aria-hidden="true" />
                </Button>
              }
            />
            <PublishedAppSchedulePanel
              projectId={project.id}
              releaseId={session.releaseId}
              rail={scheduleRail}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("publishedApp.presentationMode")}
              title={t("publishedApp.presentationMode")}
              className="hidden sm:inline-flex"
              onClick={togglePresentation}
            >
              <IconPresentation aria-hidden="true" />
            </Button>
            {session.caps.refreshDefault ? (
              <PublishedAppSharePopover
                projectId={project.id}
                title={project.title}
              />
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("common.more")}
                  title={t("common.more")}
                >
                  <IconDots aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!session.refreshUnavailable ? (
                  <DropdownMenuItem
                    disabled={viewer.busy}
                    onSelect={() => viewer.refresh(refreshScope, "bypass")}
                  >
                    <IconRefresh aria-hidden="true" />
                    {t("publishedApp.refreshNow")}
                  </DropdownMenuItem>
                ) : null}
                {overrideCount > 0 ? (
                  <DropdownMenuItem onSelect={viewer.reset}>
                    <IconRestore aria-hidden="true" />
                    {t("publishedApp.resetView")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={togglePresentation}>
                  <IconPresentation aria-hidden="true" />
                  {t("publishedApp.presentationMode")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip
              content={agentToggleLabel}
              placement="bottom"
              trigger={
                <Button
                  ref={agentTrigger}
                  type="button"
                  variant={rightPanel === "agent" ? "secondary" : "ghost"}
                  size="icon"
                  className="size-11 sm:size-8"
                  aria-label={agentToggleLabel}
                  aria-pressed={rightPanel === "agent"}
                  aria-controls={
                    panelDocked && rightPanel === "agent"
                      ? panelRailId
                      : undefined
                  }
                  onClick={() =>
                    setRightPanel((current) =>
                      current === "agent" ? null : "agent",
                    )
                  }
                >
                  <IconLayoutSidebarRight size={16} aria-hidden="true" />
                </Button>
              }
            />
          </div>
        </div>
        {viewer.busy ? (
          <div
            className="app-session-progress"
            role="progressbar"
            aria-label={t("publishedApp.runningApp")}
          />
        ) : null}
      </header>
      <div className="flex min-w-0">
        <div className="min-w-0 flex-1">
          <div
            className={
              fullWidth ? "p-4 sm:p-6" : "mx-auto max-w-[960px] p-4 sm:p-6"
            }
          >
            {project.allowEmbedding ? (
              <div
                data-signed-embed-banner="true"
                role="status"
                className="mb-4 flex items-center gap-2 rounded-md border border-border/80 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
              >
                <IconLock size={14} className="shrink-0" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {t("appEmbedding.signedEmbeddingEnabled")}
                </span>
                <span>{t("appEmbedding.signedEmbeddingCardDescription")}</span>
              </div>
            ) : null}
            {project.description &&
            project.appLayout?.settings.metadata !== false ? (
              <p className="mb-4 text-muted-foreground">
                {project.description}
              </p>
            ) : null}
            {session.refreshUnavailable && (
              <p className="mb-4 text-sm text-muted-foreground">
                {t("publishedApp.hostedKernelRequired")}
              </p>
            )}
            {session.state === "error" ? (
              <div
                role="alert"
                className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-destructive p-3"
              >
                <p className="text-sm">{t("publishedApp.errorRunning")}</p>
                {!session.refreshUnavailable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={viewer.busy}
                    onClick={() => viewer.refresh("session", "reuse")}
                  >
                    {t("publishedApp.rerunApp")}
                  </Button>
                )}
              </div>
            ) : null}
            {viewer.error ? (
              <div
                role="alert"
                className="mb-4 flex flex-wrap items-center gap-3 text-sm text-destructive"
              >
                <span>
                  {actionErrorMessage(viewer.error) ??
                    t("error.genericDetails")}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={viewer.busy}
                  onClick={viewer.retry}
                >
                  {t("error.retry")}
                </Button>
              </div>
            ) : null}
            {snapshot}
          </div>
        </div>
        <div
          ref={setPanelRail}
          className="sticky top-[var(--app-session-tabs-offset)] h-[calc(100dvh-var(--app-session-tabs-offset))] shrink-0 self-start empty:hidden"
        />
        <div
          ref={setScheduleRail}
          className="sticky top-[var(--app-session-tabs-offset)] h-[calc(100dvh-var(--app-session-tabs-offset))] shrink-0 self-start empty:hidden"
        />
      </div>
      {rightPanel === "comments" ? (
        <PublishedSidePanel
          panel="comments"
          label={commentsLabel}
          rail={panelRail}
          wide={wide}
          railId={panelRailId}
          onClose={closeRightPanel}
        >
          <PublishedCommentsPanel
            projectId={project.id}
            canResolve={session.caps.refreshDefault}
            sheet={!panelDocked}
            onClose={closeRightPanel}
          />
        </PublishedSidePanel>
      ) : null}
      {rightPanel === "agent" ? (
        <PublishedSidePanel
          panel="agent"
          label={t("analytics.navigation.agent")}
          rail={panelRail}
          wide={wide}
          railId={panelRailId}
          onClose={closeRightPanel}
        >
          <PublishedAgentPanel
            projectId={project.id}
            sheet={!panelDocked}
            onClose={closeRightPanel}
          />
        </PublishedSidePanel>
      ) : null}
      {drilldownDialog}
      <Dialog
        open={savingView}
        onOpenChange={(open) => {
          if (!savePending) setSavingView(open);
        }}
      >
        <DialogContent closeDisabled={savePending} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t("publishedApp.saveView")}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveCurrentView();
            }}
          >
            <Input
              aria-label={t("publishedApp.viewName")}
              placeholder={t("publishedApp.viewName")}
              maxLength={200}
              value={viewName}
              onChange={(event) => setViewName(event.target.value)}
              disabled={savePending}
            />
            <Button type="submit" disabled={savePending || !viewName.trim()}>
              {t("publishedApp.saveView")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function PublishedMessage({
  title,
  detail,
  accessDenied = false,
  onRetry,
}: {
  title: string;
  detail: string;
  accessDenied?: boolean;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <main
      data-published-app="true"
      className="mx-auto max-w-[640px] px-6 py-12"
    >
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">{detail}</p>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          className="mr-4 mt-2"
          onClick={onRetry}
        >
          {t("error.retry")}
        </Button>
      ) : null}
      <Link to={accessDenied ? "/home/all" : "/home"} className="underline">
        {t(
          accessDenied ? "publishedAppSharing.backToProjects" : "error.goHome",
        )}
      </Link>
    </main>
  );
}

export default function PublishedProjectRoutePage({
  route,
}: {
  route: ResolvedRoute;
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const savedViewId = params.get("savedViewId");
  return (
    <PublishedProjectPage
      route={route}
      tabBookmark={params.get("tab")}
      {...(savedViewId ? { savedViewId } : {})}
      onSessionHref={(href) => {
        if (
          pathname === href ||
          route.params.version === undefined ||
          route.params.version === "latest"
        ) {
          return;
        }
        const next = new URLSearchParams(params);
        next.delete("savedViewId");
        void navigate(
          { pathname: href, search: next.toString() },
          { replace: true, preventScrollReset: true },
        );
      }}
      onTabChange={(bookmark) =>
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            if (bookmark === null) next.delete("tab");
            else next.set("tab", bookmark);
            return next;
          },
          { preventScrollReset: true },
        )
      }
    />
  );
}
