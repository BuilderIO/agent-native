import {
  callAction,
  runActionQueryRead,
  useActionQueryCanFetch,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  formatLocaleDateTime,
  useReaderLocale,
} from "@agent-native/toolkit/app/shared/reader-locale";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProjectVersion } from "@/lib/model/project-version-contracts";

import type { NotebookHistoryItem } from "../../../shared/notebook-history";
import { ProjectVersionCompareDialog } from "./ProjectVersionCompareDialog";
import { projectVersionLabel, versionWhen } from "./version-age";

type HistoryGroup = Extract<
  NotebookHistoryItem,
  { kind: "edits" }
>["groups"][number];

const historyCellKinds: readonly string[] = [
  "sql",
  "code",
  "markdown",
  "input",
  "text",
];

function HistoryEffect({
  group,
  effect,
}: {
  group: HistoryGroup;
  effect: HistoryGroup["effects"][number];
}) {
  const t = useT();
  const kind =
    group.cellKind !== null && historyCellKinds.includes(group.cellKind)
      ? t(`notebook.history.cellKinds.${group.cellKind}`)
      : group.cellKind;
  switch (effect.type) {
    case "insert":
      return kind
        ? t("notebook.history.created", { kind })
        : t("notebook.history.updated");
    case "delete":
      return t("notebook.history.deleted");
    case "restore":
      return t(
        effect.field === "version"
          ? "notebook.history.restoredVersion"
          : "notebook.history.restored",
      );
    case "move":
      return t("notebook.history.moved");
    case "edit":
      break;
  }
  const value = effect.value;
  switch (effect.field) {
    case "source":
    case "markdown":
    case "text":
      return kind
        ? t("notebook.history.code", { kind })
        : t("notebook.history.updated");
    case "kind":
      return kind
        ? t("notebook.history.converted", { kind })
        : t("notebook.history.updated");
    case "label":
      return value
        ? t("notebook.history.labelTo", { value })
        : t("notebook.history.label");
    case "resultVariable":
      return value
        ? t("notebook.history.symbolTo", { value })
        : t("notebook.history.symbol");
    case "name":
      return value
        ? t("notebook.history.labelTo", { value })
        : t("notebook.history.label");
    case "dataConnectionId":
    case "connectionMode":
      return value
        ? t("notebook.history.sourceTo", { value })
        : t("notebook.history.source");
    case "defaultValueString":
      return value
        ? t("notebook.history.defaultTo", { value })
        : t("notebook.history.default");
    case "title":
      return t("notebook.history.titleChanged");
    case "description":
      return t("notebook.history.descriptionChanged");
    case "statusId":
      return t("notebook.history.statusChanged");
    case "layout":
      return t("notebook.history.layoutChanged");
    default:
      return t("notebook.history.updated");
  }
}

function saveShortcutLabel() {
  return typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    ? "⌘S"
    : "Ctrl+S";
}

export function versionPreviewCopy(
  version: ProjectVersion,
  t: ReturnType<typeof useT>,
) {
  const name = version.name?.trim();
  return name
    ? {
        viewing: t("notebook.history.viewingNamed", {
          version: version.number,
          name,
        }),
        confirm: t("notebook.history.confirmRestoreNamed", {
          version: version.number,
          name,
        }),
      }
    : {
        viewing: t("notebook.viewingVersion", { version: version.number }),
        confirm: t("notebook.confirmRestoreVersion", {
          version: version.number,
        }),
      };
}

export function ProjectHistoryPanel({
  projectId,
  onClose,
  onPreview,
  onCheckpoint,
  beforeCompare,
}: {
  projectId: string;
  onClose: () => void;
  onPreview?: ((version: ProjectVersion) => Promise<void>) | undefined;
  onCheckpoint?: (() => void) | undefined;
  beforeCompare?: (() => Promise<boolean>) | undefined;
}) {
  const t = useT();
  const locale = useReaderLocale();
  const [filter, setFilter] = useState<"all" | "versions">("all");
  const [comparison, setComparison] = useState<ProjectVersion | null>(null);
  const queryClient = useQueryClient();
  const queryKey = ["action", "list-notebook-history", { projectId, filter }];
  const enabled = useActionQueryCanFetch(queryKey);
  const history = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      runActionQueryRead(queryClient, queryKey, signal, (onResponse) =>
        callAction(
          "list-notebook-history",
          {
            projectId,
            filter,
            ...(pageParam === null ? {} : { cursor: pageParam }),
          },
          { method: "GET", signal, uiOnly: true, onResponse },
        ),
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: 1,
  });
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const canManage = history.data?.pages[0]?.canManageVersions;
  const compare = async (version: ProjectVersion) => {
    if (await beforeCompare?.()) setComparison(version);
  };
  const absolute = (value: string) =>
    formatLocaleDateTime(new Date(value), locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  const when = (value: string) => versionWhen(value, t, absolute);

  return (
    <aside className="nb-side-panel" aria-label={t("notebook.history.title")}>
      <header className="nb-side-panel-header">
        <h2 className="nb-side-panel-title">{t("notebook.history.title")}</h2>
        {onCheckpoint && canManage ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onCheckpoint}>
                  <IconPlus size={14} aria-hidden="true" />
                  {t("notebook.history.version")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("notebook.history.save")}{" "}
                <kbd aria-hidden="true">{saveShortcutLabel()}</kbd>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        <button
          type="button"
          className="nb-side-panel-close"
          aria-label={t("notebook.history.close")}
          onClick={onClose}
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      </header>
      <Tabs
        value={filter}
        onValueChange={(value) =>
          setFilter(value === "versions" ? value : "all")
        }
      >
        <TabsList className="mx-3 mt-2">
          <TabsTrigger value="all">{t("notebook.history.all")}</TabsTrigger>
          <TabsTrigger value="versions">
            {t("notebook.history.versions")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value={filter}>
          {history.isPending ? (
            <div className="grid gap-2 p-3" role="status">
              <span className="sr-only">{t("notebook.history.loading")}</span>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : items.length === 0 && !history.isError ? (
            <p className="nb-side-panel-note">{t("notebook.history.empty")}</p>
          ) : (
            <ol className="nb-history-list">
              {items.map((item) =>
                item.kind === "version" ? (
                  <li className="nb-history-item" key={item.id}>
                    {item.version.kind === "named" ? (
                      <span className="nb-history-name">
                        {t("notebook.history.savedVersion", {
                          actor: item.version.createdBy,
                        })}{" "}
                        (
                        {!item.version.isWorking && canManage && onPreview ? (
                          <button
                            type="button"
                            className="nb-history-name [overflow-wrap:anywhere]"
                            onClick={() => void onPreview(item.version)}
                          >
                            {projectVersionLabel(item.version, t)}
                          </button>
                        ) : (
                          projectVersionLabel(item.version, t)
                        )}
                        )
                      </span>
                    ) : !item.version.isWorking && canManage && onPreview ? (
                      <button
                        type="button"
                        className="nb-history-name [overflow-wrap:anywhere]"
                        onClick={() => void onPreview(item.version)}
                      >
                        {projectVersionLabel(item.version, t)}
                      </button>
                    ) : (
                      <span className="nb-history-name [overflow-wrap:anywhere]">
                        {projectVersionLabel(item.version, t)}
                      </span>
                    )}
                    <span
                      className="nb-history-meta"
                      title={absolute(item.version.createdAt)}
                    >
                      {item.version.kind === "named"
                        ? ""
                        : `${t(`notebook.history.${item.version.kind}`)} · `}
                      {when(item.version.createdAt)}
                      {item.version.isWorking
                        ? ` · ${t("notebook.history.working")}`
                        : ""}
                    </span>
                    {!item.version.isWorking && canManage && beforeCompare ? (
                      <button
                        type="button"
                        className="nb-text-button self-start"
                        onClick={() => void compare(item.version)}
                      >
                        {t("notebook.history.compare")}
                      </button>
                    ) : null}
                  </li>
                ) : (
                  <li className="nb-history-item" key={item.id}>
                    <details open>
                      <summary className="nb-history-name cursor-pointer">
                        {item.lowerBound
                          ? t("notebook.history.changesAtLeast", {
                              actor: item.actor,
                              count: item.changeCount,
                            })
                          : t("notebook.history.changes", {
                              actor: item.actor,
                              count: item.changeCount,
                            })}
                        <span className="nb-history-meta">
                          {" "}
                          · {when(item.endedAt)}
                        </span>
                      </summary>
                      <ul className="mt-2 grid gap-2">
                        {item.groups.map((group) => (
                          <li key={`${group.kind}:${group.id}`}>
                            <span className="nb-history-meta">
                              {group.label ??
                                t(`notebook.history.${group.kind}`)}
                            </span>
                            <ul className="nb-history-name">
                              {group.effects.map((effect) => (
                                <li key={`${effect.type}:${effect.field}`}>
                                  <HistoryEffect
                                    group={group}
                                    effect={effect}
                                  />
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ),
              )}
            </ol>
          )}
          {history.isError ? (
            <p className="nb-side-panel-error" role="alert">
              {t("notebook.history.loadFailed")}
            </p>
          ) : null}
          {history.hasNextPage ? (
            <Button
              variant="ghost"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {t("notebook.history.more")}
            </Button>
          ) : history.data?.pages.at(-1)?.editsTruncated ? (
            <p className="nb-side-panel-note">
              {t("notebook.history.olderEditsOmitted")}
            </p>
          ) : null}
        </TabsContent>
      </Tabs>
      {comparison ? (
        <ProjectVersionCompareDialog
          projectId={projectId}
          version={comparison}
          onClose={() => setComparison(null)}
        />
      ) : null}
    </aside>
  );
}
