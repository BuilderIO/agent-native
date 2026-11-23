import { appBasePath } from "@agent-native/core/client/api-path";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { AgentNativeIcon } from "@agent-native/toolkit/app/shared";
import {
  IconArrowsMaximize,
  IconBinoculars,
  IconCopy,
  IconDownload,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

import { MarkdownCellView } from "@/components/notebook/MarkdownCellView";
import { VegaChart } from "@/components/notebook/VegaChart";
import { appMountedHref } from "@/components/projects/projectList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type {
  readThreadTurnsOutput,
  threadAccessList,
  threadBindingRef,
} from "../../../shared/analytics-thread";
import type { CreationReceipt } from "../../../shared/notebook-creation";
import type { DraftHead } from "../../../shared/notebook-snapshot-contract";
import { ThreadPageSkeleton } from "./ThreadPageSkeleton";

type Binding = z.infer<typeof threadBindingRef>;
type Member = { id: string; displayName: string; email: string };
type Turns = z.infer<typeof readThreadTurnsOutput>;
type UnsavedProjectView = "notebook" | "app";

export function AskThreadHeader({
  binding,
  threadId = null,
  threadTitle,
  title,
  listed,
  workingHead,
  canShare,
  canSubmit = true,
  identity,
  refetch,
  trailingActions,
}: {
  binding: Binding | null;
  threadId?: string | null | undefined;
  threadTitle?: string | undefined;
  title: string;
  listed: boolean;
  workingHead: DraftHead | null;
  canShare: boolean;
  canSubmit?: boolean | undefined;
  identity: string;
  refetch: () => Promise<unknown>;
  trailingActions?: ReactNode | undefined;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [listedNow, setListedNow] = useState(false);
  const [openingView, setOpeningView] = useState<UnsavedProjectView | null>(
    null,
  );
  const openingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const save = useActionMutation("save-analytics-thread-project", {
    errorNotification: "caller",
  });
  const createProject = useActionMutation("create-project", {
    errorNotification: "caller",
  });
  const bindNotebookThread = useActionMutation("bind-notebook-thread", {
    errorNotification: "caller",
  });
  const resolvedThreadId = binding?.threadId ?? threadId ?? null;
  const projectHref = binding
    ? `/project/${encodeURIComponent(binding.projectId)}/latest`
    : null;
  const agentHref = binding
    ? binding.href
    : resolvedThreadId
      ? `/thread/${encodeURIComponent(resolvedThreadId)}`
      : "/thread";
  const inspectorOpen =
    Boolean(resolvedThreadId) && searchParams.get("threadInspector") === "open";

  function setInspectorOpen(open: boolean) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (open) next.set("threadInspector", "open");
        else next.delete("threadInspector");
        return next;
      },
      { replace: true },
    );
  }

  async function saveProject(expectedHead: DraftHead) {
    if (!binding) return;
    try {
      await save.mutateAsync({
        threadId: binding.threadId,
        opId: crypto.randomUUID(),
        expectedHead,
      });
      setListedNow(true);
      toast.success(t("analytics.ask.savedProject"));
      await queryClient.invalidateQueries({ queryKey: ["action"] });
      await refetch();
    } catch {
      toast.error(t("analytics.ask.saveProjectFailed"));
      await refetch();
    }
  }

  async function openUnsavedView(view: UnsavedProjectView) {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpeningView(view);
    const trimmedTitle = threadTitle?.trim();
    try {
      const created = (await createProject.mutateAsync({
        requestId: crypto.randomUUID(),
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
      })) as Partial<CreationReceipt> | undefined;
      const projectId = created?.projectId ?? created?.id;
      if (!projectId) throw new Error("missing_project_id");
      const head = created?.snapshot?.snapshot.head;
      if (resolvedThreadId && head) {
        await bindNotebookThread.mutateAsync({
          projectId,
          threadId: resolvedThreadId,
          opId: crypto.randomUUID(),
          head,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      const targetHref =
        view === "app"
          ? `/project/${encodeURIComponent(projectId)}/latest/ui`
          : `/project/${encodeURIComponent(projectId)}/latest`;
      if (mountedRef.current) void navigate(targetHref);
    } catch (error) {
      toast.error(
        actionErrorMessage(error) ?? t("notebookCreation.createFailed"),
      );
    } finally {
      openingRef.current = false;
      if (mountedRef.current) setOpeningView(null);
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/home"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent"
            aria-label={t("analytics.shell.home")}
            title={t("analytics.shell.home")}
          >
            <AgentNativeIcon size={18} />
          </Link>
          <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
        </div>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <Button asChild size="sm" variant="secondary">
            <Link aria-current="page" to={agentHref}>
              {t("analytics.ask.agentTab")}
            </Link>
          </Button>
          {projectHref ? (
            <>
              <Button asChild size="sm" variant="ghost">
                <Link to={projectHref}>{t("analytics.ask.notebookTab")}</Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link to={`${projectHref}/ui`}>
                  {t("analytics.ask.appBuilderTab")}
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={openingView !== null}
                aria-busy={openingView === "notebook"}
                onClick={() => void openUnsavedView("notebook")}
              >
                {t("analytics.ask.notebookTab")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={openingView !== null}
                aria-busy={openingView === "app"}
                onClick={() => void openUnsavedView("app")}
              >
                {t("analytics.ask.appBuilderTab")}
              </Button>
            </>
          )}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {!listed && !listedNow && workingHead && binding ? (
            <>
              <span
                className="text-xs text-muted-foreground"
                title={t("analytics.ask.unlistedDescription")}
                aria-label={t("analytics.ask.unlistedTitle")}
              >
                {t("analytics.ask.unlisted")}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={save.isPending}
                onClick={() => void saveProject(workingHead)}
              >
                {t("analytics.ask.saveProject")}
              </Button>
            </>
          ) : null}
          {canShare && binding ? (
            <AskThreadShare
              binding={binding}
              title={title}
              identity={identity}
            />
          ) : null}
          {resolvedThreadId ? (
            <Button
              type="button"
              size="icon-sm"
              variant={inspectorOpen ? "secondary" : "ghost"}
              aria-label={t("analytics.ask.headerActions.showThreadInspector")}
              aria-pressed={inspectorOpen}
              title={t("analytics.ask.headerActions.showThreadInspector")}
              onClick={() => setInspectorOpen(!inspectorOpen)}
            >
              <IconBinoculars aria-hidden="true" size={16} stroke={1.8} />
            </Button>
          ) : null}
          {trailingActions}
        </div>
      </header>
      {resolvedThreadId ? (
        <ThreadInspectorSheet
          open={inspectorOpen}
          onOpenChange={setInspectorOpen}
          threadId={resolvedThreadId}
          hasBinding={Boolean(binding)}
          canSubmit={canSubmit}
          identity={identity}
        />
      ) : null}
    </>
  );
}

function ThreadInspectorSheet({
  open,
  onOpenChange,
  threadId,
  hasBinding,
  canSubmit,
  identity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
  hasBinding: boolean;
  canSubmit: boolean;
  identity: string;
}) {
  const t = useT();
  const turnsQuery = useActionQuery<Turns>(
    "get-analytics-thread-turns",
    { threadId },
    {
      enabled: open && hasBinding,
      queryKeyScope: [identity],
    },
  );
  const turns = turnsQuery.data?.turns ?? [];
  const toolReceipts = turns.flatMap((turn) => turn.toolReceipts);
  const durationTurns = turns.filter((turn) => turn.durationMs !== null);
  const totalDurationMs = durationTurns.reduce(
    (sum, turn) => sum + (turn.durationMs ?? 0),
    0,
  );
  const accessStatus = canSubmit ? "can-reply" : "read-only";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full max-w-md overflow-y-auto p-0 sm:max-w-md"
        showClose={false}
      >
        <div className="border-b p-6 text-left">
          <div className="flex items-center justify-between gap-4">
            <SheetTitle>
              {t("analytics.ask.headerActions.threadDetails")}
            </SheetTitle>
            <Button
              aria-label={t("analytics.ask.headerActions.closePanel")}
              onClick={() => onOpenChange(false)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <IconX aria-hidden="true" size={15} stroke={1.8} />
            </Button>
          </div>
        </div>
        <Tabs defaultValue="overview" className="p-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">
              {t("observability.overview")}
            </TabsTrigger>
            <TabsTrigger value="tools">{t("observability.tools")}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <dl className="grid gap-5">
              <div className="grid gap-1">
                <dt className="text-sm text-muted-foreground">
                  {t("analytics.ask.headerActions.conversationId")}
                </dt>
                <dd className="break-all font-mono text-sm">{threadId}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-sm text-muted-foreground">
                  {t("analytics.ask.headerActions.messageCount")}
                </dt>
                <dd className="text-sm">
                  {hasBinding && turnsQuery.isPending ? (
                    <Skeleton className="h-4 w-10" />
                  ) : hasBinding && turnsQuery.isError ? (
                    t("analytics.ask.headerActions.unavailable")
                  ) : (
                    turns.length
                  )}
                </dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-sm text-muted-foreground">
                  {t("analytics.ask.headerActions.replyAccess")}
                </dt>
                <dd className="text-sm">
                  {t(`analytics.ask.headerActions.${accessStatus}`)}
                </dd>
              </div>
              {durationTurns.length > 0 ? (
                <div className="grid gap-1">
                  <dt className="text-sm text-muted-foreground">
                    {t("observability.duration")}
                  </dt>
                  <dd className="text-sm">
                    {t("analytics.ask.durationSeconds", {
                      count: Math.floor(totalDurationMs / 1000),
                    })}
                  </dd>
                </div>
              ) : null}
            </dl>
          </TabsContent>
          <TabsContent value="tools" className="mt-4">
            {hasBinding && turnsQuery.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : hasBinding && turnsQuery.isError ? (
              <div className="flex flex-col items-start gap-3" role="alert">
                <p className="text-sm text-destructive">
                  {t("analytics.ask.turnsUnreadable")}
                </p>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => void turnsQuery.refetch()}
                >
                  {t("analytics.ask.threadRetry")}
                </Button>
              </div>
            ) : toolReceipts.length > 0 ? (
              <ul className="grid gap-2">
                {toolReceipts.map((tool) => (
                  <li
                    key={tool.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {tool.label ?? tool.name}
                    </span>
                    <Badge variant="outline">{tool.state}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">0</p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function AskThreadShare({
  binding,
  title,
  identity,
}: {
  binding: Binding;
  title: string;
  identity: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const filter = useDeferredValue(search.trim());
  const threadId = binding.threadId;
  const { data: access, refetch } = useActionQuery<
    z.infer<typeof threadAccessList>
  >(
    "list-analytics-thread-access",
    { threadId },
    { enabled: open, queryKeyScope: [identity] },
  );
  const members = useActionQuery<{ members: Member[] }>(
    "search-analytics-thread-members",
    { threadId, search: filter },
    {
      enabled: open && Boolean(filter) && !selected,
      queryKeyScope: [identity],
    },
  );
  const entries = (members.data?.members ?? []).filter(
    ({ id }) => !access?.grants.some(({ memberId }) => memberId === id),
  );
  const listOpen = open && entries.length > 0 && !selected;
  const mutate = useActionMutation("set-analytics-thread-access", {
    errorNotification: "caller",
  });
  async function changeAccess(
    change:
      | { kind: "grant"; memberId: string }
      | { kind: "revoke"; grantId: string },
  ) {
    if (!access) return;
    try {
      await mutate.mutateAsync({
        threadId,
        opId: crypto.randomUUID(),
        expectedRevision: access.revision,
        change,
      });
      setSearch("");
      setSelected(null);
    } catch {
      toast.error(t("analytics.ask.shareFailed"));
    } finally {
      await refetch();
    }
  }
  async function copyLink() {
    const path = appMountedHref(binding.href, appBasePath());
    try {
      await navigator.clipboard.writeText(
        new URL(path, window.location.origin).href,
      );
      toast.success(t("analytics.ask.linkCopied"));
    } catch {
      toast.error(t("analytics.ask.copyLinkFailed"));
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSearch("");
          setSelected(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {t("analytics.ask.share")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("analytics.ask.shareTitle", { title })}</DialogTitle>
        </DialogHeader>
        <Command shouldFilter={false} label={t("analytics.ask.addUsers")}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <CommandInput
                placeholder={t("analytics.ask.addUsers")}
                value={selected?.displayName ?? search}
                onValueChange={(value) => {
                  setSelected(null);
                  setSearch(value);
                }}
              />
            </div>
            <Button
              type="button"
              disabled={!selected || !access || mutate.isPending}
              onClick={() =>
                selected &&
                void changeAccess({ kind: "grant", memberId: selected.id })
              }
            >
              {t("analytics.ask.add")}
            </Button>
          </div>
          <CommandList className="max-h-40">
            {listOpen
              ? entries.map((member) => (
                  <CommandItem
                    key={member.id}
                    value={member.id}
                    onSelect={() => setSelected(member)}
                  >
                    {member.displayName}
                  </CommandItem>
                ))
              : null}
          </CommandList>
        </Command>
        <div className="space-y-2">
          {access?.grants.map(({ id, displayName }) => (
            <div
              key={id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="grow truncate">{displayName}</span>
              <span className="text-muted-foreground">
                {t("analytics.ask.canViewThread")}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={mutate.isPending}
                aria-label={t("analytics.ask.removeAccess", {
                  name: displayName,
                })}
                onClick={() =>
                  void changeAccess({ kind: "revoke", grantId: id })
                }
              >
                <IconX size={16} aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {t("analytics.ask.inviteOnly")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copyLink()}
          >
            <IconCopy size={16} aria-hidden="true" />
            {t("analytics.ask.copyLink")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const sharedChart = z.object({
  chartSeries: z.object({
    type: z.enum(["bar", "line", "area", "scatter", "pie"]),
    xKey: z.string(),
    series: z.array(
      z.object({ key: z.string(), label: z.string().optional() }),
    ),
    data: z.array(
      z.record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      ),
    ),
  }),
});

export function SharedAskThread({
  threadId,
  identity,
  title,
}: {
  threadId: string;
  identity: string;
  title?: string;
}) {
  const t = useT();
  const [expandedChart, setExpandedChart] = useState<{
    title: string;
    type: z.infer<typeof sharedChart>["chartSeries"]["type"];
    columns: string[];
    rows: (string | number | boolean | null)[][];
  } | null>(null);
  const query = useActionQuery<Turns>(
    "get-analytics-thread-turns",
    { threadId },
    {
      refetchInterval: (q) =>
        q.state.data?.turns.some(
          (turn) =>
            turn.receipt.phase === "queued" ||
            turn.receipt.phase === "admitted",
        )
          ? 5000
          : false,
      queryKeyScope: [identity],
    },
  );
  function downloadChartCsv(
    chartTitle: string,
    columns: string[],
    rows: (string | number | boolean | null)[][],
  ) {
    const escapeCell = (value: string | number | boolean | null) => {
      const text = value === null ? "" : String(value);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const csv = [
      columns.map(escapeCell).join(","),
      ...rows.map((row) => row.map(escapeCell).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${chartTitle || "chart"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  if (query.isPending) return <ThreadPageSkeleton />;
  if (query.isError)
    return (
      <div className="flex flex-col items-start gap-3 p-6" role="alert">
        <p className="text-sm text-destructive">
          {t("analytics.ask.turnsUnreadable")}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("analytics.ask.threadRetry")}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/home/threads">
              {t("analytics.ask.threadBackToThreads")}
            </Link>
          </Button>
        </div>
      </div>
    );
  return (
    <section className="agent-panel-root mx-auto w-full max-w-3xl space-y-6 overflow-auto p-4">
      <h1 className="text-sm font-medium">
        {title || t("analytics.ask.sharedThread")}
      </h1>
      {query.data.turns.map((turn) => (
        <article
          key={turn.receipt.messageId}
          className="agentkit-message space-y-3"
        >
          {turn.denied ? (
            <p role="status">{t("analytics.ask.sourceDenied")}</p>
          ) : (
            <>
              {turn.toolReceipts.length ? (
                <details className="space-y-2 text-sm text-muted-foreground">
                  <summary>
                    {turn.durationMs === null
                      ? t("agentChat.tool.worked")
                      : t("agentChat.tool.workedFor", {
                          duration: t("analytics.ask.durationSeconds", {
                            count: Math.floor(turn.durationMs / 1000),
                          }),
                        })}
                  </summary>
                  <ul className="ms-4 list-disc">
                    {turn.toolReceipts.map(({ id, name, label }) => (
                      <li key={id}>{label ?? name}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {turn.answerBlocks.map(({ text }, index) => (
                <MarkdownCellView key={index} markdown={text} />
              ))}
              {turn.chartArtifacts.map(({ id, title, widget }) => {
                const chart = sharedChart.safeParse(widget);
                if (!chart.success) return null;
                const { type, xKey, series, data } = chart.data.chartSeries;
                const columns = [xKey, ...series.map(({ key }) => key)];
                const rows = data.map((row) =>
                  columns.map((key) => row[key] ?? null),
                );
                return (
                  <div key={id} className="rounded-md border bg-card">
                    <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {title}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("notebook.downloadCsv")}
                          title={t("notebook.downloadCsv")}
                          onClick={() => downloadChartCsv(title, columns, rows)}
                        >
                          <IconDownload size={16} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("notebook.cellActions.fullScreen")}
                          title={t("notebook.cellActions.fullScreen")}
                          onClick={() =>
                            setExpandedChart({ title, type, columns, rows })
                          }
                        >
                          <IconArrowsMaximize size={16} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <div className="p-3">
                      <VegaChart
                        mark={type}
                        title={title}
                        columns={columns}
                        rows={rows}
                      />
                    </div>
                    <table aria-label={title} className="sr-only">
                      <thead>
                        <tr>
                          {columns.map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((value, columnIndex) => (
                              <td key={columnIndex}>
                                {value === null ? "" : String(value)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </>
          )}
        </article>
      ))}
      <Dialog
        open={expandedChart !== null}
        onOpenChange={(open) => {
          if (!open) setExpandedChart(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{expandedChart?.title}</DialogTitle>
          </DialogHeader>
          {expandedChart ? (
            <VegaChart
              mark={expandedChart.type}
              title={expandedChart.title}
              columns={expandedChart.columns}
              rows={expandedChart.rows}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
