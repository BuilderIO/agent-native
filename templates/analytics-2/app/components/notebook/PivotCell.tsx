import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Cell } from "@/lib/model/contracts";

import type getProject from "../../../actions/get-project";
import {
  defaultPivotConfig,
  upgradePivotConfig,
  type PivotConfig,
  type PivotConfigV2,
} from "../../../shared/pivot-config";
import type { NotebookTransform } from "../../../shared/visualization-contracts";
import { mergeSavedCell } from "../workspace/merge-saved-cell";
import { PivotOutput } from "./PivotOutput";
import type { VisualizationViewScope } from "./types";
import { VisualizationDataPanel } from "./VisualizationDataPanel";

type PivotContents = Extract<Cell["contents"], { kind: "pivot" }>;
type ProjectRead = Awaited<ReturnType<typeof getProject.run>>;

function notice(
  result: NotebookTransform["result"] | undefined,
  config: PivotConfig,
  canEdit: boolean,
): string | undefined {
  switch (result?.status) {
    case "denied":
      return "pivot.denied";
    case "stale":
      return "pivot.stale";
    case "blocked":
      if (result.reason === "result_incomplete") return "pivot.incomplete";
      if (result.reason === "result_limit") return "pivot.limit";
      return "pivot.blocked";
    case "empty":
      return "pivot.noData";
    case "unconfigured":
      if (config.source != null) return "pivot.needsValue";
      return canEdit ? undefined : "pivot.chooseSource";
    case "ready":
    case "unreadable":
    case undefined:
      return undefined;
  }
}

export function PivotCell({
  cell,
  contents,
  canEdit,
  scope,
  sourceResultId,
}: {
  cell: Cell;
  contents: PivotContents;
  canEdit: boolean;
  scope?: VisualizationViewScope | undefined;
  sourceResultId?: string | null;
}) {
  const t = useT();
  const client = useQueryClient();
  const [view, setView] = useState<"pivot" | "table">("pivot");
  const [rowPage, setRowPage] = useState(1);
  const [columnPage, setColumnPage] = useState(1);
  const savedConfig = contents.pivotConfig ?? defaultPivotConfig;
  const query = useActionQuery<NotebookTransform>(
    "get-notebook-transform",
    {
      projectId: cell.projectId,
      cellId: cell.id,
      ...(scope ?? { expectedVersionId: cell.versionId }),
      expectedConfigRevision: savedConfig.revision,
      rowPage,
      columnPage,
    },
    { queryKeyScope: [sourceResultId] },
  );
  const projectKey = ["action", "get-project", { projectId: cell.projectId }];
  const save = useActionMutation("save-project-cell", {
    beforeInvalidate: (saved, change) => {
      client.setQueryData<ProjectRead>(projectKey, (current) =>
        current
          ? {
              ...current,
              project: mergeSavedCell(
                current.project,
                saved.project,
                change.cellId,
                change.expectedUpdatedAt,
              ),
            }
          : current,
      );
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: projectKey });
    },
  });
  const projection = query.isError ? undefined : query.data;
  const result = projection?.result;
  const pivotResult = result && "columns" in result ? result : undefined;
  const committedConfig =
    pivotResult?.config ?? upgradePivotConfig(savedConfig);
  const draft = save.isPending ? save.variables.contents : undefined;
  const config =
    draft?.kind === "pivot" && draft.pivotConfig
      ? upgradePivotConfig(draft.pivotConfig)
      : committedConfig;
  const canConfigure = canEdit && !query.isPending;
  const retry = query.isError || result?.status === "unreadable";
  const message = retry
    ? "pivot.readFailed"
    : notice(result, savedConfig, canEdit);

  function changeConfig(patch: Partial<PivotConfigV2>) {
    if (!canConfigure || save.isPending) return;
    setRowPage(1);
    setColumnPage(1);
    save.mutate({
      projectId: cell.projectId,
      cellId: cell.id,
      expectedUpdatedAt: cell.updatedAt,
      contents: {
        ...contents,
        pivotConfig: {
          ...committedConfig,
          ...patch,
          revision: savedConfig.revision + 1,
        },
      },
    });
  }

  return (
    <Tabs
      className="min-w-0 pt-1"
      value={view}
      onValueChange={(value) => setView(value === "table" ? "table" : "pivot")}
    >
      <div className="px-3 pb-2">
        <TabsList className="h-8">
          <TabsTrigger value="pivot">{t("pivot.label")}</TabsTrigger>
          <TabsTrigger value="table">{t("notebookInsert.table")}</TabsTrigger>
        </TabsList>
      </div>
      {canEdit && (
        <VisualizationDataPanel
          config={config}
          sources={projection?.sources ?? []}
          disabled={!canConfigure || save.isPending}
          onChange={changeConfig}
        />
      )}
      {save.isError && (
        <p role="alert" className="px-3 pb-3 text-sm text-destructive">
          {t("pivot.saveFailed")}
        </p>
      )}
      {save.isPending && !query.isPending && (
        <span role="status" className="sr-only">
          {t("pivot.updating")}
        </span>
      )}
      {query.isPending ? (
        <div role="status" className="grid gap-2 border-t p-3" aria-busy="true">
          <span className="sr-only">
            {t(save.isPending ? "pivot.updating" : "pivot.loading")}
          </span>
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : pivotResult?.status === "ready" ? (
        <PivotOutput
          key={
            pivotResult.visualizationResultId ??
            pivotResult.source.result.resultId
          }
          cell={cell}
          result={pivotResult}
          config={committedConfig}
          scope={scope}
          view={view}
          onRowPage={setRowPage}
          onColumnPage={setColumnPage}
        />
      ) : message ? (
        <div className="flex items-center gap-3 border-t px-3 py-2 text-sm text-muted-foreground">
          <span
            role={retry || result?.status === "denied" ? "alert" : "status"}
          >
            {t(message)}
          </span>
          {result?.status === "empty" && <span>{t("pivot.zeroRows")}</span>}
          {retry && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              {t("editorPreferences.retry")}
            </Button>
          )}
        </div>
      ) : null}
    </Tabs>
  );
}
