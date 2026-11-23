import { compareAndSetClientAppState } from "@agent-native/core/client/application-state";
import {
  actionErrorMessage,
  callAction,
  useActionQuery,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSession } from "@agent-native/core/client/use-session";
import { IconFileText } from "@tabler/icons-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { z } from "zod";

import { ProjectCategoriesDialog } from "@/components/projects/ProjectCategoriesDialog";
import { ProjectStatusDialog } from "@/components/projects/ProjectStatusDialog";
import { TransferProjectOwnerDialog } from "@/components/projects/TransferProjectOwnerDialog";
import { secondaryFeaturesEnabled } from "@/components/shell/secondary-features";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotebookCommands } from "@/components/workspace/WorkspaceCommands";
import { notebookMessages } from "@/i18n/messages/notebook";
import { parseCellLinkHash } from "@/lib/cell-link";
import { relatedCellIds, type CellRelation } from "@/lib/model/cell-graph";
import {
  ADDABLE_CELL_KINDS,
  addCellMenuEntries,
  cellKindDefinition,
  creatableMenuKinds,
  type CellKind,
} from "@/lib/model/cell-types";
import type { Cell, CellContents } from "@/lib/model/contracts";
import { compareOrder } from "@/lib/model/order";
import { dependentSqlCells } from "@/lib/model/sql-dependents";
import { downloadProjectIpynb } from "@/lib/notebook-ipynb";
import { TAB_ID } from "@/lib/tab-id";

import {
  ANALYTICS_CONTROL_IDS as ids,
  capabilityAllowed,
} from "../../../shared/analytics-control-ids";
import {
  draftAppLayout,
  isDefaultAppCell,
  type AppDocument,
} from "../../../shared/app-layout";
import type { EditorPreferences } from "../../../shared/editor-preferences";
import {
  NOTEBOOK_SNAPSHOT_CELL_LIMIT,
  NOTEBOOK_SNAPSHOT_TEXT_LIMIT,
  type NotebookEditing,
} from "../../../shared/notebook-editing";
import type { notebookSnapshotReadSchema } from "../../../shared/notebook-operations";
import {
  canGroupInSection,
  canMoveIntoSection,
  MAX_SECTION_DEPTH,
  sectionDepth,
  sectionDescendantIds,
  sectionParent,
  sectionSelectionRoots,
} from "../../../shared/notebook-sections";
import { revisionSchema } from "../../../shared/notebook-snapshot-contract";
import type { QueryNotebookTableReceipt } from "../../../shared/notebook-table-query";
import { isSqlInputName } from "../../../shared/sql-input-name";
import { lazyRoute } from "../workspace/lazy-route";
import { loadNotebookCell } from "../workspace/route-critical-code";
import { addCellOptions } from "./add-cell-options";
import {
  AddCellBar,
  InsertCellBar,
  PendingCell,
  type MoreCellEntry,
} from "./AddCellBar";
import { AgentPane } from "./AgentPane";
import type { CellDropPlacement } from "./cell-drag";
import { CellEmbedDialog } from "./CellEmbedDialog";
import { projectChartDataframes } from "./chart-config";
import { publishNotebookEditing } from "./editing-snapshot";
import { requestInputConfig } from "./input-config-request";
import {
  groupInlineInputs,
  INLINE_SLOT_CLASS,
  isRenderableInput,
  RENDERABLE_INPUT_TYPES,
} from "./InputCellControl";
import { NewComponentDialog } from "./NewComponentDialog";
import { insertCommands, notebookLetter } from "./notebook-commands";
import { NotebookEmptyState } from "./NotebookEmptyState";
import {
  getCellRunShortcut,
  NotebookRunControls,
  type CellRunMode,
  type CellRunOptions,
} from "./NotebookRunControls";
import { PendingCellDiff } from "./PendingCellDiff";
import { PendingChangesPanel } from "./PendingChangesPanel";
import { ProjectAppBuilder } from "./ProjectAppBuilder";
import { ProjectComponentsPanel } from "./ProjectComponentsPanel";
import { ProjectDataBrowserPanel } from "./ProjectDataBrowserPanel";
import { ProjectEnvironmentPanel } from "./ProjectEnvironmentPanel";
import { ProjectErrorsPanel } from "./ProjectErrorsPanel";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { ProjectFindPanel } from "./ProjectFindPanel";
import { ProjectGraphView } from "./ProjectGraphView";
import { ProjectHeader } from "./ProjectHeader";
import { ProjectHelpPanel } from "./ProjectHelpPanel";
import { ProjectHistoryPanel } from "./ProjectHistoryPanel";
import { ProjectMetaPickers } from "./ProjectMetaPickers";
import { ProjectOutlinePanel } from "./ProjectOutlinePanel";
import { ProjectRunStatsView } from "./ProjectRunStatsView";
import { ProjectSourceView } from "./ProjectSourceView";
import {
  ProjectVariablesPanel,
  type NotebookVariable,
} from "./ProjectVariablesPanel";
import {
  PUBLISH_DIALOG_PARAM,
  PublishProjectDialog,
} from "./PublishProjectDialog";
import { SaveProjectVersionDialog } from "./SaveProjectVersionDialog";
import { SectionCell, SectionDestinationItems } from "./SectionCell";
import { ToolRail } from "./ToolRail";
import type {
  AddCellOptions,
  NotebookActionError,
  ProjectEditorProps,
  SectionChange,
} from "./types";
import { useCellDrafts } from "./useCellDrafts";
import { proposalCell } from "./useNotebookReview";
import type { NotebookRunIntent } from "./useNotebookRun";
import { useReactiveInputs } from "./useReactiveInputs";
import {
  cellContentsWithText,
  cellIsRunnable,
  editableCellText,
  isConnectionRequiredError,
  isPersistedQueryError,
  isRunningStatus,
  cellTitleAtPosition,
  inputDisplayLabel,
  toNotebookError,
} from "./utils";

import "./notebook.css";

const LazyNotebookCell = lazyRoute(loadNotebookCell);
type DeferredCellProps = ComponentProps<typeof LazyNotebookCell> & {
  onReady: () => void;
};

function ReadyNotebookCell({ onReady, ...props }: DeferredCellProps) {
  useLayoutEffect(onReady, [onReady]);
  return <LazyNotebookCell {...props} />;
}

function NotebookCellBoundary(props: DeferredCellProps) {
  return (
    <Suspense fallback={<Skeleton className="nb-cell h-24 w-full" />}>
      <ReadyNotebookCell {...props} />
    </Suspense>
  );
}

type CellFailureAction =
  | { kind: "run" }
  | { kind: "delete" }
  | { kind: "connection"; connectionId: string | null };

interface CellFailure {
  error: NotebookActionError;
  action: CellFailureAction;
}

interface AddFailure {
  error: NotebookActionError;
  kind: CellKind;
  afterCellId?: string;
  options?: AddCellOptions;
}

function withId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.add(id);
  return next;
}

function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

const COMMAND_ADD_KINDS: readonly CellKind[] = insertCommands.map(
  ({ kind }) => kind,
);

function focusCell(cellId: string, root: ParentNode | null = document) {
  const cell = root?.querySelector<HTMLElement>(
    `[data-notebook-cell="${CSS.escape(cellId)}"]`,
  );
  const editor = cell?.querySelector<HTMLElement>("textarea, .cm-content");
  if (editor && editor.getClientRects().length > 0) editor.focus();
  else cell?.focus();
}

function loadErrorMessage(
  error: string | null | undefined,
  retryError: NotebookActionError | null,
): string | null {
  return retryError?.message ?? error ?? null;
}

function notebookCellTitle(contents: CellContents, ordinal: number) {
  if (contents.kind === "input" && isSqlInputName(contents.name))
    return inputDisplayLabel(contents);
  return cellTitleAtPosition(contents, ordinal);
}

function initializeAppLayout(
  appLayout: ProjectEditorProps["appLayout"],
  cells: readonly Cell[],
  document = appLayout?.document,
) {
  if (
    appLayout &&
    !document?.initialized &&
    cells.some((cell) => isDefaultAppCell(cell, true))
  )
    return appLayout.commit([
      { type: "initialize", includeExecutionOutputs: true },
    ]);
}

function renderSectionRows(
  levels: ReadonlyMap<string | null, readonly Cell[]>,
  renderCell: (
    cell: Cell,
    position: number,
    siblings: readonly Cell[],
    depth: number,
    renderChildren: () => ReactNode[],
  ) => ReactNode,
  parent: string | null = null,
  depth = 0,
): ReactNode[] {
  const siblings = levels.get(parent) ?? [];
  return groupInlineInputs(
    siblings,
    siblings.map((cell, position) =>
      renderCell(cell, position, siblings, depth, () =>
        renderSectionRows(levels, renderCell, cell.id, depth + 1),
      ),
    ),
  );
}

export function ProjectEditor({
  isVersionPreview = false,
  recoveryNotice,
  appLayout,
  onPreviewVersion,
  focusTitle,
  untitledOrdinal,
  project,
  connections,
  addConnectionHref,
  onRename,
  onSaveCell,
  review,
  onLeaveReview,
  onSelectCell,
  onFixWithAgent,
  onUseAi,
  onSaveDescription,
  onClearOutputs,
  onDuplicate,
  onAddCell,
  onQueryTable,
  onDeleteCell,
  onMoveCell,
  onMoveCellTo,
  onSectionChange,
  onDuplicateCell,
  onPasteCell,
  onCreateComponent,
  onUndoCellEdit,
  execution,
  onRunCell,
  onSelectConnection,
  linkedConnectionIds,
  onImportConnection,
  outputs = {},
  loading = false,
  error = null,
  onRetryLoad,
  connectionsLoading = false,
  connectionsError = null,
  selectedConnectionStates = {},
  canEdit = true,
  capabilities,
  view = "notebook",
  onSelectView,
  onShare,
  sharePanel,
  onPublished,
  publishPending = false,
  onPublishingChange,
  onOpenComments,
  onOpenToolRailItem,
  agentOpen = view === "agent",
  onToggleAgent,
  agentPane,
  agentComposer,
  onSubmitAgentPrompt,
  onLearnMoreAgent,
  onAddAgentContext,
  emptyState,
  supportedAddKinds = ADDABLE_CELL_KINDS,
  onTrash,
  onFavorite,
  onExportYaml,
  onAddToCollection,
  onArchive,
  onNewProject,
  onLoadResultRows,
  onLoadResultPage,
  onLoadPythonPage,
}: ProjectEditorProps) {
  const t = useT();
  const canBrowseData =
    capabilities === undefined ||
    capabilityAllowed(capabilities, ids.dataBrowse);
  const canUseBuilder =
    canEdit &&
    (capabilities === undefined ||
      capabilityAllowed(capabilities, ids.editProject));
  const canViewPublishedApp =
    capabilities === undefined
      ? project.publishedVersionId !== null
      : capabilityAllowed(capabilities, ids.openPublishedApp);
  const allowedRuns = useMemo(
    () =>
      new Set<string>(
        capabilities?.flatMap((decision) =>
          (decision.controlId === ids.runDraftSql ||
            decision.controlId === ids.runDraftPython) &&
          decision.status === "allowed" &&
          decision.scope.kind === "cell"
            ? [decision.scope.cellId]
            : [],
        ),
      ),
    [capabilities],
  );
  const canRunCell = useCallback(
    (cell: Cell) =>
      cellIsRunnable(cell.contents) &&
      (capabilities === undefined ||
        allowedRuns.has(cell.id) ||
        (canEdit &&
          execution?.browser?.enabled === true &&
          cell.contents.kind === "code" &&
          cell.contents.language === "python")),
    [allowedRuns, canEdit, capabilities, execution?.browser?.enabled],
  );
  const orderedCells = useMemo(
    () =>
      [...project.cells].sort((a, b) =>
        compareOrder(a.contents.order, b.contents.order),
      ),
    [project.cells],
  );
  const cellsById = useMemo(
    () => new Map(orderedCells.map((cell) => [cell.id, cell])),
    [orderedCells],
  );
  const [sectionOverrides, setSectionOverrides] = useState<
    ReadonlyMap<string, boolean>
  >(new Map());
  const [sectionPending, setSectionPending] = useState(false);
  const sectionInFlight = useRef(false);
  useEffect(() => setSectionOverrides(new Map()), [project.id]);
  const revealSectionAncestors = useCallback(
    (cellId: string) => {
      let cell = cellsById.get(cellId);
      const collapsedIds: string[] = [];
      for (let depth = 0; cell && depth <= MAX_SECTION_DEPTH; depth++) {
        const parent = sectionParent(cell);
        if (parent === null) break;
        const section = cellsById.get(parent);
        if (section?.contents.kind !== "collapsible") break;
        if (sectionOverrides.get(parent) ?? section.contents.collapsed)
          collapsedIds.push(parent);
        cell = section;
      }
      if (collapsedIds.length === 0) return false;
      setSectionOverrides((previous) => {
        const next = new Map(previous);
        for (const id of collapsedIds) next.set(id, false);
        return next;
      });
      return true;
    },
    [cellsById, sectionOverrides],
  );
  const [importedHere, setImportedHere] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const importedConnectionIds = useMemo(
    () =>
      new Set([
        ...(linkedConnectionIds ?? []),
        ...importedHere,
        ...project.cells.flatMap(({ contents }) =>
          contents.kind === "sql" && contents.dataConnectionId
            ? [contents.dataConnectionId]
            : [],
        ),
      ]),
    [importedHere, linkedConnectionIds, project.cells],
  );
  const importConnection = useCallback(
    async (dataConnectionId: string) => {
      if (onImportConnection === undefined) return;
      await onImportConnection(dataConnectionId);
      setImportedHere((current) => new Set(current).add(dataConnectionId));
    },
    [onImportConnection],
  );
  const proposals = view !== "app" && canEdit ? review?.changes : undefined;
  const reviewByCell = new Map(
    proposals?.map((change, index) => [change.cellId, { change, index }]),
  );
  const visibleCells = orderedCells
    .filter((cell) => !reviewByCell.has(cell.id))
    .concat(
      (proposals ?? []).flatMap((change) => {
        const cell = proposalCell(change);
        return cell ? [cell] : [];
      }),
    )
    .sort((a, b) => compareOrder(a.contents.order, b.contents.order));
  const visibleLevels = new Map<string | null, Cell[]>();
  for (const cell of visibleCells) {
    const parent = sectionParent(cell);
    const siblings = visibleLevels.get(parent);
    if (siblings) siblings.push(cell);
    else visibleLevels.set(parent, [cell]);
  }
  const firstNotebookCell = visibleLevels.get(null)?.[0];
  const layoutDocument =
    appLayout?.document ??
    project.appLayout ??
    draftAppLayout(orderedCells, revisionSchema.parse("0"));
  const titles = useMemo(() => {
    return new Map(
      orderedCells.map((cell, index) => [
        cell.id,
        cell.contents.kind === "collapsible"
          ? cell.contents.title || t("notebook.section.name")
          : notebookCellTitle(cell.contents, index + 1),
      ]),
    );
  }, [orderedCells, t]);

  const moreEntries = useMemo<MoreCellEntry[]>(() => {
    const creatable = creatableMenuKinds(supportedAddKinds);
    return addCellMenuEntries().filter(
      (entry) =>
        creatable.has(entry.kind) &&
        (entry.inputType === undefined ||
          RENDERABLE_INPUT_TYPES.includes(entry.inputType)),
    );
  }, [supportedAddKinds]);

  // Variables are the result variables the run cells actually produced. The
  // panel reads the same saved outputs the cells show; a cell without an
  // output has no variable to list.
  const variables = useMemo<NotebookVariable[]>(() => {
    const next: NotebookVariable[] = [];
    for (const cell of orderedCells) {
      const contents = cell.contents;
      if (contents.kind !== "sql" && contents.kind !== "code") continue;
      const name = contents.resultVariable?.trim();
      if (!name) continue;
      const output = outputs[cell.id]?.output;
      if (output?.type !== "table") continue;
      next.push({
        cellId: cell.id,
        name,
        cellLabel: titles.get(cell.id) ?? "Untitled cell",
        kind: contents.kind,
        rows: output.rows.length,
        columns: output.columns.length,
      });
    }
    return next;
  }, [orderedCells, outputs, titles]);

  // The same variables, with the columns and rows a chart cell draws from, so a
  // chart's DataFrame picker offers exactly the results this notebook produced.
  const dataframes = useMemo(
    () => projectChartDataframes(orderedCells, outputs),
    [orderedCells, outputs],
  );
  const metricTitleValues = useMemo(
    () =>
      new Map(
        orderedCells.flatMap(({ contents }) =>
          contents.kind === "input"
            ? [[contents.name, contents.defaultValueString] as const]
            : [],
        ),
      ),
    [orderedCells],
  );
  function visualizationSourceResultId({ contents }: Cell) {
    const source =
      contents.kind === "pivot"
        ? contents.pivotConfig?.source
        : contents.kind === "display-table"
          ? contents.tableConfig?.source
          : contents.kind === "metric"
            ? contents.metricConfig?.source
            : null;
    return source
      ? (execution?.cells?.[source.cellId]?.resultId ?? null)
      : null;
  }

  const [publishSession, setPublishSession] = useState<{
    layoutWrite: Promise<AppDocument> | undefined;
    projectId: string;
  } | null>(null);
  const canPublish =
    onPublished !== undefined &&
    capabilityAllowed(capabilities, ids.publishProject);
  function openPublishDialog() {
    if (publishUnchanged || publishPending) return;
    setPublishSession({
      projectId: project.id,
      layoutWrite: appLayout?.pendingWrite(),
    });
  }
  useEffect(() => {
    setPublishSession(null);
  }, [project.id]);
  const connectionWrites = useRef(
    new Map<
      string,
      {
        projectId: string;
        baseRevisions: string[];
        connectionId: string | null;
        inFlight: boolean;
        promise: Promise<string | void>;
      }
    >(),
  );
  const projectScope = `${project.id}:${project.workingVersionId}`;
  const currentProjectScope = useRef(projectScope);
  const projectGeneration = useRef(0);
  if (currentProjectScope.current !== projectScope) {
    currentProjectScope.current = projectScope;
    projectGeneration.current += 1;
  }
  const currentCells = useRef(orderedCells);
  currentCells.current = orderedCells;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = useCallback(
    (generation: number) =>
      mounted.current && projectGeneration.current === generation,
    [],
  );
  const preparingRun = useRef<{
    generation: number;
    cellId: string | undefined;
  } | null>(null);
  const [savingForRun, setSavingForRun] = useState(false);
  const saveDraft = useCallback<ProjectEditorProps["onSaveCell"]>(
    async (
      cellId,
      contents,
      expectedUpdatedAt,
      inputOptionsResultId,
      suppressReactiveRun,
    ) => {
      const write = connectionWrites.current.get(cellId);
      if (write && write.projectId === project.id) {
        const revision = await write.promise;
        if (
          expectedUpdatedAt !== undefined &&
          write.baseRevisions.includes(expectedUpdatedAt) &&
          contents.kind === "sql"
        ) {
          if (revision == null) throw new Error(t("notebook.saveFailed"));
          const { connectionMode: _connectionMode, ...rest } = contents;
          contents = {
            ...rest,
            dataConnectionId: write.connectionId,
            ...(write.connectionId === null
              ? { connectionMode: "dataframes" as const }
              : {}),
          };
          expectedUpdatedAt = revision;
        }
      }
      const args = [cellId, contents, expectedUpdatedAt] as const;
      if (suppressReactiveRun)
        return onSaveCell(...args, inputOptionsResultId, true);
      return inputOptionsResultId === undefined
        ? onSaveCell(...args)
        : onSaveCell(...args, inputOptionsResultId);
    },
    [onSaveCell, project.id, t],
  );
  const drafts = useCellDrafts({ cells: orderedCells, onSaveCell: saveDraft });
  const publishUnchanged =
    project.publishedHead != null &&
    project.publishedHead.versionId === project.draftHead?.versionId &&
    project.publishedHead.revision === project.draftHead.revision &&
    !appLayout?.saving &&
    !orderedCells.some((cell) => drafts.isDirty(cell));
  const reopenPublishFromUrl = useEffectEvent(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("dialog") !== PUBLISH_DIALOG_PARAM) return;
    if (!canPublish) return;
    if (!publishUnchanged && !publishPending) {
      openPublishDialog();
      return;
    }
    url.searchParams.delete("dialog");
    window.history.replaceState(window.history.state, "", url);
  });
  useEffect(() => {
    reopenPublishFromUrl();
  }, [project.id, canPublish]);
  const dirtyInputDependents = useMemo(() => {
    const affected = new Set<string>();
    for (const cell of orderedCells) {
      if (cell.contents.kind !== "input" || !drafts.isDirty(cell)) continue;
      for (const id of dependentSqlCells(orderedCells, drafts.textFor, {
        inputName: cell.contents.name,
      }))
        affected.add(id);
    }
    return affected;
  }, [drafts.isDirty, drafts.textFor, orderedCells]);
  const inputs = useReactiveInputs({ drafts });
  const emptyCsvInputRef = useRef<HTMLInputElement>(null);
  const [importingEmptyCsv, setImportingEmptyCsv] = useState(false);
  const handleEmptyCsvUpload = useCallback(
    async (selected: FileList | null) => {
      const file = selected?.[0];
      if (!file || importingEmptyCsv) return;
      const csvMessages = notebookMessages.notebook.projectFiles;
      if (!file.name.toLowerCase().endsWith(".csv")) {
        toast.error(csvMessages.csvRequired);
        if (emptyCsvInputRef.current) emptyCsvInputRef.current.value = "";
        return;
      }
      if (!file.size || file.size > 2 * 1024 * 1024) {
        toast.error(csvMessages.csvSize);
        if (emptyCsvInputRef.current) emptyCsvInputRef.current.value = "";
        return;
      }
      setImportingEmptyCsv(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const result = await callAction<{
          dataset: { id: string; name: string; rowCount: number };
        }>("import-project-csv", {
          projectId: project.id,
          filename: file.name,
          dataBase64: btoa(binary),
        });
        toast.success(
          (result.dataset.rowCount === 1
            ? csvMessages.importedSingular
            : csvMessages.importedPlural
          )
            .replace("{{name}}", result.dataset.name)
            .replace("{{rows}}", String(result.dataset.rowCount)),
        );
      } catch (error) {
        toast.error(
          actionErrorMessage(error) ??
            (error instanceof Error ? error.message : csvMessages.importFailed),
        );
      } finally {
        setImportingEmptyCsv(false);
        if (emptyCsvInputRef.current) emptyCsvInputRef.current.value = "";
      }
    },
    [importingEmptyCsv, project.id],
  );
  const pendingContentSaves = useRef(new Set<Promise<unknown>>());
  const [chartEdits, setChartEdits] = useState<
    Record<
      string,
      { projectId: string; contents: Extract<CellContents, { kind: "chart" }> }
    >
  >({});
  const captureVersionHead = async () => {
    const generation = projectGeneration.current;
    const current = () => isCurrent(generation);
    await appLayout?.pendingWrite();
    await Promise.all(pendingContentSaves.current);
    await Promise.all(
      [...connectionWrites.current.values()]
        .filter((write) => write.projectId === project.id && write.inFlight)
        .map((write) => write.promise),
    );
    if (!(await inputs.flush(current, true)))
      throw new Error(t("notebook.saveFailed"));
    for (const cell of currentCells.current) {
      if (
        !current() ||
        !(await drafts.save(cell, undefined, true, false, undefined, true))
      )
        throw new Error(t("notebook.saveFailed"));
    }
    const read = await callAction(
      "get-notebook-snapshot",
      { projectId: project.id },
      { method: "GET", uiOnly: true },
    );
    if (
      !current() ||
      read.status !== "accepted" ||
      read.snapshot.head.versionId !== project.workingVersionId
    )
      throw new Error(t("notebook.saveFailed"));
    return read.snapshot.head;
  };
  useEffect(() => {
    setChartEdits({});
  }, [project.id]);
  const editingSnapshot = useMemo<NotebookEditing | null>(() => {
    if (!canEdit) return null;
    const cells: NotebookEditing["cells"] = [];
    const candidates = orderedCells.filter((cell) =>
      ["sql", "code", "markdown", "text", "chart"].includes(cell.contents.kind),
    );
    candidates.sort(
      (a, b) =>
        Number(
          Boolean(
            drafts.drafts[b.id] || chartEdits[b.id]?.projectId === project.id,
          ),
        ) -
        Number(
          Boolean(
            drafts.drafts[a.id] || chartEdits[a.id]?.projectId === project.id,
          ),
        ),
    );
    for (const cell of candidates.slice(0, NOTEBOOK_SNAPSHOT_CELL_LIMIT)) {
      const contents = cell.contents;
      if (contents.kind === "chart") {
        const pending =
          chartEdits[cell.id]?.projectId === project.id
            ? chartEdits[cell.id]?.contents
            : undefined;
        const chart = pending ?? contents;
        const short = (value: string | null) => value?.slice(0, 200) ?? null;
        const values = [
          chart.dataframe,
          chart.chartSpec.xField,
          chart.chartSpec.yField,
          chart.chartSpec.seriesField,
          chart.chartSpec.title,
        ];
        const spec = chart.chartSpec;
        const labels = Object.entries(spec.seriesLabels ?? {});
        const lists = [
          spec.yFields ?? [],
          spec.colors ?? [],
          spec.seriesOrder ?? [],
          labels.flat(),
        ];
        const boundedList = (values: string[]) =>
          values.slice(0, 4).map((value) => value.slice(0, 200));
        cells.push({
          id: cell.id.slice(0, 200),
          kind: "chart",
          dataframe: short(chart.dataframe),
          chartSpec: {
            mark: chart.chartSpec.mark,
            xField: short(chart.chartSpec.xField),
            ...(spec.xTimeUnit === undefined
              ? {}
              : { xTimeUnit: spec.xTimeUnit }),
            yField: short(chart.chartSpec.yField),
            ...(spec.yAggregation === undefined
              ? {}
              : { yAggregation: spec.yAggregation }),
            seriesField: short(chart.chartSpec.seriesField),
            title: short(chart.chartSpec.title),
            ...(spec.yFields ? { yFields: boundedList(spec.yFields) } : {}),
            ...(spec.colors ? { colors: boundedList(spec.colors) } : {}),
            ...(spec.seriesOrder
              ? { seriesOrder: boundedList(spec.seriesOrder) }
              : {}),
            ...(spec.seriesLabels
              ? {
                  seriesLabels: Object.fromEntries(
                    labels
                      .slice(0, 4)
                      .map(([key, value]) => [
                        key.slice(0, 200),
                        value.slice(0, 200),
                      ]),
                  ),
                }
              : {}),
            ...(spec.stacked === undefined ? {} : { stacked: spec.stacked }),
            ...(spec.legend === undefined ? {} : { legend: spec.legend }),
            ...(spec.yFormatter === undefined
              ? {}
              : { yFormatter: spec.yFormatter }),
          },
          truncated:
            values.some((value) => value != null && value.length > 200) ||
            labels.length > 4 ||
            lists.slice(0, 3).some((list) => list.length > 4) ||
            lists.some((list) => list.some((value) => value.length > 200)),
          unsaved:
            pending !== undefined &&
            JSON.stringify(pending) !== JSON.stringify(contents),
        });
      } else if (
        contents.kind === "sql" ||
        contents.kind === "code" ||
        contents.kind === "markdown" ||
        contents.kind === "text"
      ) {
        const text = drafts.textFor(cell);
        cells.push({
          id: cell.id.slice(0, 200),
          kind: contents.kind,
          text: text.slice(0, NOTEBOOK_SNAPSHOT_TEXT_LIMIT),
          truncated: text.length > NOTEBOOK_SNAPSHOT_TEXT_LIMIT,
          unsaved: drafts.isDirty(cell) || drafts.isSaving(cell.id),
        });
      }
    }
    return {
      projectId: project.id,
      cells,
      truncated: candidates.length > NOTEBOOK_SNAPSHOT_CELL_LIMIT,
    };
  }, [canEdit, chartEdits, drafts.drafts, orderedCells, project.id]);
  useEffect(() => {
    if (editingSnapshot) publishNotebookEditing(editingSnapshot);
  }, [editingSnapshot]);
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [connectionPendingIds, setConnectionPendingIds] = useState<
    ReadonlySet<string>
  >(new Set());
  useEffect(() => {
    setConnectionPendingIds(new Set());
  }, [project.id]);
  const [connectionOverrides, setConnectionOverrides] = useState<
    Record<string, string | null>
  >({});
  const [addPending, setAddPending] = useState<{
    kind: CellKind;
    afterCellId?: string;
  } | null>(null);
  const addPendingRef = useRef(false);
  const [addFailure, setAddFailure] = useState<AddFailure | null>(null);
  const [cellFailures, setCellFailures] = useState<Record<string, CellFailure>>(
    {},
  );
  const [loadRetrying, setLoadRetrying] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [railPanel, setRailPanel] = useState<
    | "history"
    | "toc"
    | "find"
    | "help"
    | "variables"
    | "components"
    | "environment"
    | "files"
    | "data-browser"
    | null
  >(null);
  const { session } = useSession();
  const [activeGap, setActiveGap] = useState<string | null>(null);
  const [railInsert, setRailInsert] = useState<{
    scope: string;
    afterCellId?: string | null;
    beforeCellId?: string;
    parentSectionId?: string;
  } | null>(null);
  const railAnchor = railInsert?.scope === projectScope ? railInsert : null;
  const bottomTools = (anchor?: NonNullable<typeof railInsert>) => ({
    data: canBrowseData
      ? () => {
          setRailInsert(anchor ?? null);
          setRailPanel("data-browser");
          void onOpenToolRailItem?.("data-browser");
        }
      : undefined,
    component:
      supportedAddKinds.includes("component-import") &&
      secondaryFeaturesEnabled()
        ? () => {
            setRailInsert(anchor ?? null);
            setRailPanel("components");
            void onOpenToolRailItem?.("components");
          }
        : undefined,
  });
  const [savingVersion, setSavingVersion] = useState(false);
  const canCheckpoint =
    canEdit &&
    project.draftHead !== undefined &&
    session?.email.toLowerCase() === project.ownerEmail.toLowerCase();
  useEffect(() => {
    if (!canCheckpoint) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "s"
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="menu"]')
      )
        return;
      event.preventDefault();
      setSavingVersion(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canCheckpoint]);
  const preferenceOwner = session?.email.toLowerCase();
  const editorPreferences = useActionQuery<EditorPreferences>(
    "get-editor-preferences",
    {},
    { enabled: !!preferenceOwner, queryKeyScope: [preferenceOwner] },
  );
  const preferenceWrite = useRef(Promise.resolve());
  const currentPreferenceOwner = useRef(preferenceOwner);
  currentPreferenceOwner.current = preferenceOwner;
  const [textChoice, setTextChoice] = useState<{
    owner: string | undefined;
    kind: "text" | "markdown";
  } | null>(null);
  const textKind =
    textChoice && textChoice.owner === preferenceOwner
      ? textChoice.kind
      : (editorPreferences.data?.addTextKind ?? "text");
  const textPreference = {
    textKind,
    onTextKindChange: (kind: "text" | "markdown") => {
      const choice = { owner: preferenceOwner, kind };
      setTextChoice(choice);
      if (!preferenceOwner) return;
      preferenceWrite.current = preferenceWrite.current.then(async () => {
        if (currentPreferenceOwner.current !== preferenceOwner) return;
        try {
          const saved = await callAction<EditorPreferences>(
            "set-editor-preferences",
            { addTextKind: kind },
          );
          await editorPreferences.refetch();
          setTextChoice((current) =>
            current === choice && saved.addTextKind === kind ? null : current,
          );
        } catch (error) {
          setTextChoice((current) => (current === choice ? null : current));
          if (currentPreferenceOwner.current === preferenceOwner)
            toast.error(toNotebookError(error).message);
        }
      });
    },
  };
  // Only read when the Components panel is open; the action is workspace-scoped.
  const componentsQuery = useActionQuery<{
    components?: Array<{
      id: string;
      name: string;
      sourceProjectId: string;
      cellCount: number;
      updatedAt: string;
    }>;
  }>("list-components", {}, { enabled: railPanel === "components" });
  const [transferOpen, setTransferOpen] = useState(false);
  const [loadRetryError, setLoadRetryError] =
    useState<NotebookActionError | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [pendingPanelJump, setPendingPanelJump] = useState<{
    projectId: string;
    cellId: string;
    focus: boolean;
  } | null>(null);
  const scrollToCell = useCallback((cellId: string, focus = false) => {
    const target = editorRef.current?.querySelector<HTMLElement>(
      `[data-notebook-cell="${CSS.escape(cellId)}"]`,
    );
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (focus) target?.focus({ preventScroll: true });
  }, []);
  const jumpToCell = useCallback(
    (cellId: string, focus = false) => {
      setPendingPanelJump({ projectId: project.id, cellId, focus });
    },
    [project.id],
  );
  useLayoutEffect(() => {
    if (!pendingPanelJump) return;
    if (pendingPanelJump.projectId !== project.id || view !== "notebook") {
      setPendingPanelJump(null);
      return;
    }
    if (!orderedCells.some((cell) => cell.id === pendingPanelJump.cellId)) {
      return;
    }
    if (revealSectionAncestors(pendingPanelJump.cellId)) return;
    const main = editorRef.current?.querySelector(".nb-main-scroll");
    if (
      railPanel !== null &&
      main &&
      getComputedStyle(main).display === "none"
    ) {
      setPendingPanelJump({ ...pendingPanelJump, focus: true });
      setRailPanel(null);
      return;
    }
    scrollToCell(pendingPanelJump.cellId, pendingPanelJump.focus);
    setPendingPanelJump(null);
  }, [
    orderedCells,
    pendingPanelJump,
    project.id,
    railPanel,
    revealSectionAncestors,
    scrollToCell,
    view,
  ]);
  const [pendingCellFocus, setPendingCellFocus] = useState<string | null>(null);
  const [cellRendererReady, setCellRendererReady] = useState(false);
  const markCellRendererReady = useCallback(
    () => setCellRendererReady(true),
    [],
  );
  const commandFocusRef = useRef<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    id: string;
    projectId: string;
  } | null>(null);
  const selectedCellRef = useRef<{
    kind: "cell";
    id: string;
    projectId: string;
  } | null>(null);
  useEffect(() => {
    setPendingCellFocus(null);
    setSelectedCell((selected) =>
      selected?.projectId === project.id ? selected : null,
    );
    if (selectedCellRef.current?.projectId !== project.id)
      selectedCellRef.current = null;
  }, [project.id]);
  useEffect(() => {
    setSelectedCell((selected) =>
      selected != null && !orderedCells.some((cell) => cell.id === selected.id)
        ? null
        : selected,
    );
  }, [orderedCells]);
  // The cells picked with "Select cell and..." stay marked until Escape, the
  // Clear button, or another project replaces them.
  const [selectedCellIds, setSelectedCellIds] = useState<readonly string[]>([]);
  const [embedCellId, setEmbedCellId] = useState<string | null>(null);
  const [componentSession, setComponentSession] = useState<{
    anchorId: string;
    ids: readonly string[];
  } | null>(null);
  useEffect(() => {
    setSelectedCellIds([]);
    setEmbedCellId(null);
    setComponentSession(null);
  }, [project.id]);
  const selectedSet = useMemo(
    () =>
      new Set(
        selectedCellIds.filter((id) =>
          orderedCells.some((cell) => cell.id === id),
        ),
      ),
    [orderedCells, selectedCellIds],
  );
  useEffect(() => {
    if (selectedSet.size === 0) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedCellIds([]);
      setSelectedCell(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSet.size]);
  const latest = useRef({ orderedCells, drafts, projectId: project.id });
  latest.current = { orderedCells, drafts, projectId: project.id };
  const graphCells = (view = latest.current) =>
    view.orderedCells.map((cell) =>
      editableCellText(cell.contents) == null
        ? cell
        : {
            ...cell,
            contents: cellContentsWithText(
              cell.contents,
              view.drafts.textFor(cell),
            ),
          },
    );
  const selectRelated = (cellId: string, relation: CellRelation) => {
    const ids = relatedCellIds(graphCells(), cellId, relation);
    setSelectedCellIds(ids);
    setSelectedCell(null);
    const first = ids[0];
    if (first !== undefined) {
      document
        .querySelector<HTMLElement>(
          `[data-notebook-cell="${CSS.escape(first)}"]`,
        )
        ?.scrollIntoView({ block: "nearest" });
    }
  };
  useEffect(
    () => () => {
      const selection = selectedCellRef.current;
      if (selection?.projectId === project.id) {
        void compareAndSetClientAppState(
          `selection:${TAB_ID}`,
          selection,
          null,
          { requestSource: TAB_ID },
        ).catch((error) =>
          console.error("Could not clear notebook selection", error),
        );
      }
    },
    [project.id],
  );
  useEffect(() => {
    const selected = selectedCellRef.current;
    if (
      !selected ||
      selected.projectId !== project.id ||
      orderedCells.some((cell) => cell.id === selected.id)
    )
      return;
    selectedCellRef.current = null;
    void compareAndSetClientAppState(`selection:${TAB_ID}`, selected, null, {
      requestSource: TAB_ID,
    }).catch((error) =>
      console.error("Could not clear notebook selection", error),
    );
  }, [orderedCells, project.id]);

  const revision = `${project.workingVersionId}:${project.updatedAt}`;
  useEffect(() => {
    setConnectionOverrides((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([cellId]) =>
            connectionWrites.current.get(cellId)?.inFlight &&
            connectionWrites.current.get(cellId)?.projectId === project.id,
        ),
      ),
    );
  }, [project.id, revision]);

  const clearCellFailure = useCallback((cellId: string) => {
    setCellFailures((previous) => {
      if (previous[cellId] == null) return previous;
      const next = { ...previous };
      delete next[cellId];
      return next;
    });
  }, []);

  const runningIds = execution?.runningIds;
  const browserSession = execution?.browser;
  const runId = execution?.run?.runId;
  useEffect(() => {
    if (!runId || !canEdit || view === "agent") return;
    const key = `notebook-run:${TAB_ID}`;
    const selected = { projectId: project.id, runId };
    const source = { requestSource: TAB_ID };
    void writeClientAppState(key, selected, source).catch((error) =>
      console.error("Could not update notebook run state", error),
    );
    return () => {
      void compareAndSetClientAppState(key, selected, null, source).catch(
        (error) => console.error("Could not clear notebook run state", error),
      );
    };
  }, [runId, canEdit, project.id, view]);
  const runAdmissionPending =
    savingForRun ||
    execution?.pending === true ||
    execution?.restarting === true;
  const runBusy = runAdmissionPending || (runningIds?.size ?? 0) > 0;
  const busyAny = runBusy || drafts.savingAny;
  const canChangeStructure =
    canEdit && !busyAny && !sectionPending && onSectionChange != null;
  const changeSection = async (change: SectionChange) => {
    if (!canEdit || !onSectionChange || sectionInFlight.current) return false;
    sectionInFlight.current = true;
    setSectionPending(true);
    try {
      await onSectionChange(change);
      return true;
    } catch (error) {
      toast.error(toNotebookError(error).message);
      return false;
    } finally {
      sectionInFlight.current = false;
      setSectionPending(false);
    }
  };
  const canMoveByDrag =
    canEdit &&
    !busyAny &&
    !sectionPending &&
    (onMoveCellTo != null || canChangeStructure) &&
    orderedCells.length > 1;
  const moveSelection = async (
    cellIds: string[],
    parentSectionId: string | null,
    beforeCellId?: string,
  ) => {
    const first = cellIds[0];
    if (
      !first ||
      !canChangeStructure ||
      !canMoveIntoSection(orderedCells, cellIds, parentSectionId)
    )
      return;
    const applied = await changeSection({
      type: "move-to-section",
      cellId: first,
      cellIds,
      parentSectionId,
      ...(beforeCellId ? { beforeCellId } : {}),
    });
    if (applied) jumpToCell(first, true);
  };
  const dropCell = (
    draggedCellId: string,
    targetCellId: string,
    placement: CellDropPlacement,
  ) => {
    const target = cellsById.get(targetCellId);
    if (!target || draggedCellId === targetCellId) return;
    if (canChangeStructure) {
      const members = selectedSet.has(draggedCellId)
        ? sectionSelectionRoots(orderedCells, [...selectedSet]).map(
            ({ id }) => id,
          )
        : [draggedCellId];
      if (members.includes(targetCellId)) return;
      const parent =
        placement === "inside" ? targetCellId : sectionParent(target);
      const siblings = orderedCells.filter(
        (cell) => sectionParent(cell) === parent,
      );
      const before =
        placement === "before"
          ? targetCellId
          : placement === "after"
            ? siblings
                .slice(siblings.indexOf(target) + 1)
                .find((cell) => !members.includes(cell.id))?.id
            : undefined;
      void moveSelection(members, parent, before);
      return;
    }
    if (!onMoveCellTo || placement === "inside") return;
    const from = orderedCells.findIndex((c) => c.id === draggedCellId);
    const to = orderedCells.indexOf(target);
    if (from < 0 || to < 0 || to + (placement === "before" ? -1 : 1) === from)
      return;
    void onMoveCellTo(draggedCellId, { cellId: targetCellId, placement })
      .then(() =>
        document
          .querySelector<HTMLElement>(
            `[data-notebook-cell="${CSS.escape(draggedCellId)}"]`,
          )
          ?.focus(),
      )
      .catch((error: unknown) => toast.error(toNotebookError(error).message));
  };
  const hasAllowedRun = orderedCells.some(canRunCell);
  const canRunSection = useCallback(
    (sectionId: string) =>
      canEdit &&
      execution?.ready === true &&
      sectionDescendantIds(orderedCells, sectionId).some((id) => {
        const cell = cellsById.get(id);
        return cell !== undefined && canRunCell(cell);
      }),
    [canEdit, canRunCell, cellsById, execution?.ready, orderedCells],
  );
  const canRun = execution
    ? (canEdit || hasAllowedRun) && execution.ready
    : canEdit && onRunCell != null;
  const canQueryTable =
    canRun &&
    (capabilities === undefined ||
      capabilityAllowed(capabilities, ids.queryNotebookTable));
  const observeTableAdmission = execution?.observeAdmission;
  const tableQueryGeneration = projectGeneration.current;
  const canRunAll = canRun && execution != null && hasAllowedRun;

  const selectConnection = useCallback(
    async (cell: Cell, connectionId: string | null) => {
      if (connectionPendingIds.has(cell.id)) return;
      clearCellFailure(cell.id);
      setConnectionPendingIds((previous) => withId(previous, cell.id));
      const hadOverride = Object.prototype.hasOwnProperty.call(
        connectionOverrides,
        cell.id,
      );
      const previousOverride = connectionOverrides[cell.id];
      setConnectionOverrides((previous) => ({
        ...previous,
        [cell.id]: connectionId,
      }));
      const generation = projectGeneration.current;
      const inFlightSave = drafts.waitForSave(cell.id);
      const write = {
        projectId: project.id,
        baseRevisions: [cell.updatedAt],
        connectionId,
        inFlight: true,
        promise: Promise.resolve().then(async () => {
          const revision = await inFlightSave;
          if (revision !== undefined) write.baseRevisions.push(revision);
          if (!isCurrent(generation)) throw new Error(t("notebook.saveFailed"));
          return onSelectConnection(cell.id, connectionId);
        }),
      };
      connectionWrites.current.set(cell.id, write);
      try {
        await write.promise;
        if (!isCurrent(generation)) return;
        setConnectionOverrides((previous) => ({
          ...previous,
          [cell.id]: connectionId,
        }));
      } catch (connectionError) {
        if (connectionWrites.current.get(cell.id) === write)
          connectionWrites.current.delete(cell.id);
        if (!isCurrent(generation)) return;
        setConnectionOverrides((previous) => {
          const next = { ...previous };
          if (hadOverride && previousOverride !== undefined)
            next[cell.id] = previousOverride;
          else delete next[cell.id];
          return next;
        });
        setCellFailures((previous) => ({
          ...previous,
          [cell.id]: {
            error: toNotebookError(connectionError),
            action: { kind: "connection", connectionId },
          },
        }));
      } finally {
        write.inFlight = false;
        if (isCurrent(generation))
          setConnectionPendingIds((previous) => withoutId(previous, cell.id));
        else if (connectionWrites.current.get(cell.id) === write)
          connectionWrites.current.delete(cell.id);
      }
    },
    [
      clearCellFailure,
      connectionPendingIds,
      connectionOverrides,
      drafts,
      isCurrent,
      onSelectConnection,
      project.id,
      t,
    ],
  );

  const submitRun = useCallback(
    async (
      intent: NotebookRunIntent,
      {
        onReady,
        overwrite = false,
      }: {
        onReady?: (() => void) | undefined;
        overwrite?: boolean;
      } = {},
    ) => {
      const generation = projectGeneration.current;
      if (
        !canRun ||
        execution?.restarting ||
        preparingRun.current?.generation === generation
      )
        return;
      const cellId =
        "cellId" in intent
          ? intent.cellId
          : "sectionId" in intent
            ? intent.sectionId
            : undefined;
      if ("cellId" in intent) {
        const target = currentCells.current.find(
          (cell) => cell.id === intent.cellId,
        );
        if (!target || !canRunCell(target) || runningIds?.has(intent.cellId))
          return;
      } else if (
        runBusy ||
        ("sectionId" in intent ? !canRunSection(intent.sectionId) : !canRunAll)
      ) {
        return;
      }
      const current = () => isCurrent(generation);
      const preparation = { generation, cellId };
      preparingRun.current = preparation;
      setSavingForRun(true);
      let admitted = false;
      try {
        if (cellId) clearCellFailure(cellId);
        const sectionMembers =
          "sectionId" in intent
            ? new Set(
                sectionDescendantIds(currentCells.current, intent.sectionId),
              )
            : undefined;
        if (
          !(await inputs.flush(
            current,
            "all" in intent || "sectionId" in intent,
            sectionMembers,
          ))
        )
          return;
        const relevant = currentCells.current.filter(
          (cell) =>
            canRunCell(cell) &&
            (sectionMembers === undefined || sectionMembers.has(cell.id)) &&
            (cellId === cell.id ||
              !("cellId" in intent) ||
              (intent.mode ?? execution?.defaultMode) !== "cell-only"),
        );
        const saved = await Promise.all(
          relevant.map(async (cell) => {
            const implicitConnection = connections.find(
              ({ isDefault }) => isDefault,
            );
            const selecting =
              cell.contents.kind === "sql" &&
              !cell.contents.dataConnectionId &&
              cell.contents.connectionMode !== "dataframes" &&
              implicitConnection &&
              !connectionWrites.current.has(cell.id)
                ? selectConnection(cell, implicitConnection.id)
                : undefined;
            const source = connectionWrites.current.get(cell.id);
            if (source?.projectId === project.id) {
              try {
                await source.promise;
              } catch {
                await selecting;
                return false;
              }
            }
            await selecting;
            if (!current()) return false;
            return drafts.save(
              cell,
              undefined,
              false,
              overwrite && cell.id === cellId,
            );
          }),
        );
        if (!current() || saved.some((ok) => !ok)) return;
        if (execution) admitted = await execution.start(intent);
        else if (cellId && onRunCell)
          admitted = (await onRunCell(cellId)) !== false;
        if (admitted && current()) onReady?.();
      } catch (error) {
        if (!current()) return;
        const connectionRequired = isConnectionRequiredError(error);
        if (!connectionRequired && isPersistedQueryError(error)) return;
        if (cellId)
          setCellFailures((previous) => ({
            ...previous,
            [cellId]: {
              error: connectionRequired
                ? { message: t("notebook.connectionRequired"), details: null }
                : toNotebookError(error),
              action: { kind: "run" },
            },
          }));
        else toast.error(toNotebookError(error).message);
      } finally {
        if (preparingRun.current === preparation) {
          preparingRun.current = null;
          if (mounted.current) setSavingForRun(false);
        }
      }
    },
    [
      canRun,
      canRunAll,
      canRunCell,
      canRunSection,
      clearCellFailure,
      connections,
      selectConnection,
      drafts,
      execution,
      inputs,
      isCurrent,
      onRunCell,
      project.id,
      runBusy,
      runningIds,
      t,
    ],
  );

  const runCell = useCallback(
    (
      cell: Cell,
      mode?: CellRunMode,
      options?: CellRunOptions,
      onReady?: () => void,
    ) =>
      submitRun(
        {
          cellId: cell.id,
          ...(mode ? { mode } : {}),
          ...(options ? { options } : {}),
        },
        { onReady },
      ),
    [submitRun],
  );

  const runAllCells = (
    options: { restart?: boolean; bypassCache?: boolean } = {},
  ) => submitRun({ all: true, ...options });

  const kernelSession = execution?.session;
  const activeKernelState = kernelSession?.state;
  const showKernelStatus =
    browserSession ||
    (kernelSession &&
      orderedCells.some(({ contents }) => contents.kind === "code"));
  const lastKernelRun =
    browserSession?.lastRunAt ??
    Object.values(execution?.cells ?? {})
      .flatMap(({ finishedAt }) => (finishedAt ? [finishedAt] : []))
      .sort()
      .at(-1);
  const restartKernel =
    execution?.restart && (kernelSession || execution.browser?.enabled)
      ? () => {
          void execution.restart?.().then(
            () => toast.success(t("notebook.runRestarted")),
            (error) => toast.error(toNotebookError(error).message),
          );
        }
      : undefined;

  const cancelRun = (cellId?: string) => {
    void execution
      ?.cancel(cellId)
      .catch((error) => toast.error(toNotebookError(error).message));
  };

  const overwriteCell = (cell: Cell) =>
    submitRun({ cellId: cell.id }, { overwrite: true });

  const deleteCell = useCallback(
    async (cell: Cell, onStart?: () => void) => {
      if (
        !canEdit ||
        runningIds?.has(cell.id) ||
        preparingRun.current?.cellId === cell.id ||
        drafts.isSaving(cell.id) ||
        deletingIds.has(cell.id)
      )
        return;
      onStart?.();
      clearCellFailure(cell.id);
      setDeletingIds((previous) => withId(previous, cell.id));
      try {
        await onDeleteCell(cell.id);
        drafts.discard(cell);
        return true;
      } catch (deleteError) {
        setCellFailures((previous) => ({
          ...previous,
          [cell.id]: {
            error: toNotebookError(deleteError),
            action: { kind: "delete" },
          },
        }));
        return false;
      } finally {
        setDeletingIds((previous) => withoutId(previous, cell.id));
      }
    },
    [canEdit, clearCellFailure, deletingIds, drafts, onDeleteCell, runningIds],
  );

  const addCell = useCallback(
    async (kind: CellKind, afterCellId?: string, options?: AddCellOptions) => {
      if (addPendingRef.current) return;
      addPendingRef.current = true;
      setAddFailure(null);
      setAddPending({
        kind,
        ...(afterCellId === undefined ? {} : { afterCellId }),
      });
      try {
        return await onAddCell(
          kind,
          afterCellId,
          addCellOptions(kind, options),
        );
      } catch (addError) {
        setAddFailure({
          error: toNotebookError(addError),
          kind,
          ...(afterCellId === undefined ? {} : { afterCellId }),
          ...(options === undefined ? {} : { options }),
        });
        return;
      } finally {
        addPendingRef.current = false;
        setAddPending(null);
      }
    },
    [onAddCell],
  );

  const addConnectionCell = useCallback(
    async (dataConnectionId: string, source: string | null) => {
      if (!importedConnectionIds.has(dataConnectionId))
        await importConnection(dataConnectionId);
      const added = await addCell("sql", railAnchor?.afterCellId ?? undefined, {
        dataConnectionId,
        ...(railAnchor?.beforeCellId === undefined
          ? {}
          : { beforeCellId: railAnchor.beforeCellId }),
        ...(railAnchor?.parentSectionId === undefined
          ? {}
          : { parentSectionId: railAnchor.parentSectionId }),
        ...(source === null ? {} : { source }),
      });
      if (added === undefined) throw new Error("The SQL cell was not added.");
      setPendingCellFocus(added);
    },
    [addCell, importConnection, importedConnectionIds, railAnchor],
  );

  useEffect(() => {
    if (view !== "notebook" || pendingCellFocus == null || !cellRendererReady)
      return;
    const added = orderedCells.find((cell) => cell.id === pendingCellFocus);
    if (!added) return;
    if (revealSectionAncestors(added.id)) return;
    const element = document.querySelector<HTMLElement>(
      `[data-notebook-cell="${CSS.escape(added.id)}"]`,
    );
    if (commandFocusRef.current === added.id) {
      commandFocusRef.current = null;
      element?.focus();
      setPendingCellFocus(null);
      return;
    }
    const alreadyFocused = Boolean(element?.contains(document.activeElement));
    if (!alreadyFocused) focusCell(added.id);
    if (added.contents.kind === "input" && canEdit && !alreadyFocused)
      requestInputConfig(added.id);
    if (
      added.contents.kind === "sql" &&
      canEdit &&
      element &&
      !element.querySelector(".cm-content")
    ) {
      let frame: number | undefined;
      const observer = new MutationObserver(() => {
        if (!element.querySelector(".cm-content")) return;
        observer.disconnect();
        // CodeMirror inserts its DOM during an update; focusing it then re-enters that update.
        frame = requestAnimationFrame(() => {
          if (document.activeElement === element) focusCell(added.id);
          setPendingCellFocus(null);
        });
      });
      observer.observe(element, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
        if (frame !== undefined) cancelAnimationFrame(frame);
      };
    }
    setPendingCellFocus(null);
  }, [
    canEdit,
    cellRendererReady,
    orderedCells,
    pendingCellFocus,
    revealSectionAncestors,
    view,
  ]);

  const restoredLinkRef = useRef<string | null>(null);
  const [linkTarget, setLinkTarget] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : parseCellLinkHash(window.location.hash),
  );
  useEffect(() => {
    const read = () => setLinkTarget(parseCellLinkHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => {
    if (linkTarget === null) {
      restoredLinkRef.current = null;
      return;
    }
    const key = `${project.id}:${linkTarget}`;
    if (restoredLinkRef.current === key) return;
    if (!orderedCells.some((cell) => cell.id === linkTarget)) return;
    if (revealSectionAncestors(linkTarget)) return;
    restoredLinkRef.current = key;
    document
      .querySelector<HTMLElement>(
        `[data-notebook-cell="${CSS.escape(linkTarget)}"]`,
      )
      ?.scrollIntoView({ block: "center" });
    focusCell(linkTarget);
  }, [linkTarget, orderedCells, project.id, revealSectionAncestors]);

  const updateCollapsed = async (cell: Cell, collapsed: boolean) => {
    if (cell.contents.kind !== "collapsible") return;
    if (canEdit && onSectionChange && sectionInFlight.current) return;
    const prior = sectionOverrides.get(cell.id);
    setSectionOverrides((previous) =>
      new Map(previous).set(cell.id, collapsed),
    );
    if (!canEdit || !onSectionChange || cell.contents.collapsed === collapsed)
      return;
    const applied = await changeSection({
      type: "set-section",
      cellId: cell.id,
      config: { collapsed },
    });
    setSectionOverrides((previous) => {
      if (previous.get(cell.id) !== collapsed) return previous;
      const next = new Map(previous);
      if (!applied && prior !== undefined) next.set(cell.id, prior);
      else next.delete(cell.id);
      return next;
    });
  };

  const sectionDestinationItems = (cellIds: readonly string[]) => {
    const roots = () =>
      sectionSelectionRoots(orderedCells, cellIds).map(({ id }) => id);
    return (
      <SectionDestinationItems
        getOptions={() => {
          const ids = roots();
          return {
            destinations: orderedCells.flatMap((cell) =>
              cell.contents.kind === "collapsible"
                ? [
                    {
                      id: cell.id,
                      title: titles.get(cell.id) ?? t("notebook.section.name"),
                      depth: sectionDepth(orderedCells, cell.id) ?? 0,
                      disabled: !canMoveIntoSection(orderedCells, ids, cell.id),
                    },
                  ]
                : [],
            ),
            canGroup: canGroupInSection(orderedCells, ids),
          };
        }}
        onMove={(id) => void moveSelection(roots(), id)}
        onGroup={() => {
          const cellId = crypto.randomUUID();
          void changeSection({
            type: "group-section",
            cellId,
            cellIds: roots(),
          }).then((applied) => {
            if (!applied) return;
            setSelectedCellIds([cellId]);
            jumpToCell(cellId, true);
          });
        }}
      />
    );
  };

  const sectionSubmenu = (cellIds: readonly string[]) =>
    canChangeStructure ? (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="nb-menu-item">
          {t("notebook.section.addTo")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="nb-popover nb-menu-list">
          {sectionDestinationItems(cellIds)}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : undefined;

  const siblingsOf = (cell: Cell) =>
    orderedCells.filter(
      (sibling) => sectionParent(sibling) === sectionParent(cell),
    );

  const moveCellOne = (cell: Cell, direction: "up" | "down") => {
    const siblings = siblingsOf(cell);
    const adjacent =
      siblings[siblings.indexOf(cell) + (direction === "up" ? -1 : 1)];
    if (!adjacent) return;
    if (
      canChangeStructure &&
      (sectionParent(cell) !== null ||
        cell.contents.kind === "collapsible" ||
        adjacent.contents.kind === "collapsible")
    ) {
      dropCell(cell.id, adjacent.id, direction === "up" ? "before" : "after");
    } else {
      void onMoveCell?.(cell.id, direction)
        .then(() => jumpToCell(cell.id, true))
        .catch((error: unknown) => toast.error(toNotebookError(error).message));
    }
  };

  const retryFailure = useCallback(
    (cell: Cell, failure: CellFailure) => {
      if (failure.action.kind === "delete") {
        void deleteCell(cell);
      } else if (failure.action.kind === "connection") {
        void selectConnection(cell, failure.action.connectionId);
      } else {
        void runCell(cell);
      }
    },
    [deleteCell, runCell, selectConnection],
  );

  const retryLoad = useCallback(async () => {
    if (onRetryLoad == null || loadRetrying) return;
    setLoadRetrying(true);
    setLoadRetryError(null);
    try {
      await onRetryLoad();
    } catch (retryError) {
      setLoadRetryError(toNotebookError(retryError));
    } finally {
      setLoadRetrying(false);
    }
  }, [loadRetrying, onRetryLoad]);

  const loadError = loadErrorMessage(error, loadRetryError);
  const pendingAfterFound =
    addPending?.afterCellId != null &&
    orderedCells.some((cell) => cell.id === addPending.afterCellId);

  const renderBanner = (
    failure: NotebookActionError,
    onRetry: (() => void) | undefined,
    onDismiss: (() => void) | undefined,
    retrying = false,
  ) => (
    <div className="nb-banner nb-banner-danger" role="alert">
      <p className="nb-banner-message">{failure.message}</p>
      {failure.details != null && (
        <details className="nb-banner-details">
          <summary>Error details</summary>
          <pre>{failure.details}</pre>
        </details>
      )}
      {(onRetry != null || onDismiss != null) && (
        <div className="nb-banner-actions">
          {onRetry != null && (
            <button
              type="button"
              className="nb-text-button"
              disabled={retrying}
              onClick={onRetry}
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
          {onDismiss != null && (
            <button
              type="button"
              className="nb-text-button"
              disabled={retrying}
              onClick={onDismiss}
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );

  const exportIpynb = useCallback(() => {
    downloadProjectIpynb(project);
  }, [project]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("export") !== "ipynb") return;
    url.searchParams.delete("export");
    window.history.replaceState({}, "", url);
    if (!isVersionPreview) exportIpynb();
  }, [exportIpynb, isVersionPreview]);

  useEffect(() => {
    if (view !== "notebook" || !canEdit || !onUndoCellEdit) return;
    const undo = (event: globalThis.KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const keyZ = notebookLetter(event) === "Z";
      const bareCommandUndo = !mod && !event.shiftKey && !event.altKey && keyZ;
      const modUndo = mod && !event.altKey && keyZ;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        (!bareCommandUndo && !modUndo)
      )
        return;
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !editorRef.current?.contains(target) ||
        !target.closest("[data-notebook-cell]") ||
        target.matches(
          "input, textarea, select, [contenteditable='true'], [contenteditable='']",
        ) ||
        Boolean(target.closest(".cm-editor, [contenteditable='true']")) ||
        document.querySelector(
          '[role="dialog"]:not([data-state="closed"]):not([data-closed]):not([hidden]), [role="menu"]:not([data-state="closed"]):not([data-closed]):not([hidden])',
        )
      )
        return;
      event.preventDefault();
      if (!busyAny && !addPendingRef.current && deletingIds.size === 0)
        void onUndoCellEdit(modUndo && event.shiftKey).catch((error) =>
          toast.error(toNotebookError(error).message),
        );
    };
    window.addEventListener("keydown", undo);
    return () => window.removeEventListener("keydown", undo);
  }, [view, canEdit, onUndoCellEdit, busyAny, deletingIds.size]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = useCallback(
    () => setSidebarCollapsed((value) => !value),
    [],
  );
  const openCellAgent = useCallback(() => {
    const selected = selectedCellRef.current;
    const cell =
      selected?.projectId === project.id
        ? cellsById.get(selected.id)
        : undefined;
    if (!cell || !canEdit || !onUseAi) return;
    const connectionId =
      cell.contents.kind === "sql" ? cell.contents.dataConnectionId : undefined;
    onUseAi(
      {
        projectId: project.id,
        cellId: cell.id,
        title:
          titles.get(cell.id) ??
          notebookCellTitle(
            cell.contents,
            orderedCells.findIndex((entry) => entry.id === cell.id) + 1,
          ),
      },
      cell.contents.kind === "sql"
        ? connections.find(({ id }) => id === connectionId)?.name
        : undefined,
    );
  }, [
    project.id,
    cellsById,
    canEdit,
    onUseAi,
    connections,
    titles,
    orderedCells,
  ]);
  const openPalette = useNotebookCommands([
    {
      id: "sidebar",
      label: t("commandPalette.sidebar"),
      group: t("commandPalette.notebook"),
      shortcut: "Alt + Shift + `",
      run: toggleSidebar,
    },
    ...(canEdit && onUseAi
      ? [
          {
            id: "cell-agent",
            label: t("commandPalette.cellAgent"),
            group: t("commandPalette.notebook"),
            shortcut: "Mod + Shift + M",
            run: openCellAgent,
          },
        ]
      : []),
    ...[
      ["find", "Find"],
      ["toc", "Table of contents"],
      ["help", "Help & support"],
    ].map(([id, label]) => ({
      id: `panel-${id}`,
      label: label!,
      group: t("commandPalette.notebook"),
      run: () => {
        setSidebarCollapsed(false);
        setRailPanel(id as "find" | "toc" | "help");
      },
    })),
    ...(onSelectView
      ? ["notebook", ...(canUseBuilder ? ["app"] : [])].map((next) => ({
          id: `view-${next}`,
          label: next === "app" ? "Go to: App builder" : "Go to: Notebook",
          group: t("commandPalette.navigation"),
          run: () => onSelectView(next as "app" | "notebook"),
        }))
      : []),
    ...(canRunAll && !runBusy
      ? [
          {
            id: "run-all",
            label: t("notebook.runAll"),
            group: t("commandPalette.notebook"),
            shortcut: "Mod + Shift + A",
            run: () => runAllCells(),
          },
        ]
      : []),
  ]);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        document.querySelector(
          '[role="dialog"]:not([data-state="closed"]):not([data-closed]):not([hidden]), [role="menu"]:not([data-state="closed"]):not([data-closed]):not([hidden])',
        )
      )
        return;
      const mod = event.ctrlKey || event.metaKey;
      if (
        event.altKey &&
        event.shiftKey &&
        !mod &&
        (event.code === "Backquote" || event.key === "`" || event.key === "~")
      ) {
        if (
          event.target instanceof Element &&
          event.target.closest('input,textarea,select,[contenteditable="true"]')
        )
          return;
        event.preventDefault();
        toggleSidebar();
      } else if (
        mod &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "m" &&
        canEdit &&
        onUseAi &&
        selectedCellRef.current
      ) {
        event.preventDefault();
        openCellAgent();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [toggleSidebar, openCellAgent, canEdit, onUseAi]);

  const handleNotebookKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.repeat)
      return;
    const target = event.target as HTMLElement;
    if (target.closest('[role="dialog"], [role="menu"]')) return;
    const editable = target.matches(
      "input, textarea, select, [contenteditable=true]",
    );
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (
      mod &&
      !event.altKey &&
      key === "f" &&
      (!editable || target.closest("[data-notebook-cell]"))
    ) {
      event.preventDefault();
      setRailPanel("find");
      editorRef.current
        ?.querySelector<HTMLInputElement>(".nb-find-input")
        ?.focus();
      return;
    }
    if (view === "notebook" && canEdit) {
      if (
        event.altKey &&
        !mod &&
        !event.shiftKey &&
        notebookLetter(event) === "R" &&
        canRunAll &&
        !runBusy
      ) {
        event.preventDefault();
        void runAllCells({ restart: true });
        return;
      }
      if (
        event.altKey &&
        mod &&
        !event.shiftKey &&
        notebookLetter(event) === "I" &&
        execution?.run &&
        (runningIds?.size ?? 0) > 0
      ) {
        event.preventDefault();
        cancelRun();
        return;
      }
    }
    if (
      !editable &&
      !mod &&
      event.altKey &&
      !event.shiftKey &&
      notebookLetter(event) === "A" &&
      canEdit &&
      !busyAny
    ) {
      const slot = target.closest<HTMLElement>("[data-notebook-cell]");
      const gap = target.closest<HTMLButtonElement>(".nb-insert-button");
      if (gap && !gap.disabled && !gap.closest("." + INLINE_SLOT_CLASS)) {
        event.preventDefault();
        gap.click();
      } else if (slot?.dataset.notebookCell && addPending == null) {
        event.preventDefault();
        setActiveGap(gapKey(slot.dataset.notebookCell, "after"));
      }
      return;
    }
    if (editable) return;
    if (
      event.altKey &&
      event.shiftKey &&
      !mod &&
      ["Digit1", "Digit2"].includes(event.code)
    ) {
      const next = event.code === "Digit1" ? "notebook" : "app";
      if (next === "app" && !canUseBuilder) return;
      if (onSelectView) void onSelectView(next);
      else if (next !== "app" && onToggleAgent && agentOpen)
        void onToggleAgent();
      else return;
      event.preventDefault();
      return;
    }
    if (mod && !event.altKey && event.shiftKey && key === "p" && canPublish) {
      event.preventDefault();
      openPublishDialog();
      return;
    }
    if (view !== "notebook") return;
    const article = target.closest<HTMLElement>("[data-notebook-cell]");
    const cell =
      target === article
        ? cellsById.get(article.dataset.notebookCell ?? "")
        : undefined;
    const shortcut = getCellRunShortcut(event);
    if (shortcut && cell?.contents.kind === "collapsible") {
      event.preventDefault();
      if (shortcut === "auto") void submitRun({ sectionId: cell.id });
      return;
    }
    if (shortcut && cell && cellIsRunnable(cell.contents)) {
      if (canRun && canRunCell(cell)) {
        event.preventDefault();
        void runCell(cell, shortcut);
      }
      return;
    }
    if (
      (shortcut === "auto" ||
        (mod && event.shiftKey && !event.altKey && key === "enter")) &&
      canRunAll &&
      !runBusy
    ) {
      event.preventDefault();
      void runAllCells();
      return;
    }
    if (!cell) return;
    const focusCommand = (id: string) =>
      editorRef.current
        ?.querySelector<HTMLElement>(`[data-notebook-cell="${CSS.escape(id)}"]`)
        ?.focus();
    const articles = editorRef.current?.querySelectorAll<HTMLElement>(
      "[data-notebook-cell]",
    );
    const visibleOrder = articles ? Array.from(articles) : [];
    const index = article ? visibleOrder.indexOf(article) : -1;
    const visibleIds = visibleOrder.map(
      (element) => element.dataset.notebookCell ?? "",
    );
    if (key === "enter" && !mod && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      focusCell(cell.id, editorRef.current);
    } else if (
      key === "s" &&
      !mod &&
      !event.altKey &&
      !event.shiftKey &&
      canCheckpoint
    ) {
      event.preventDefault();
      setSavingVersion(true);
    } else if (mod && !event.altKey && !event.shiftKey && key === "a") {
      event.preventDefault();
      setSelectedCellIds(visibleIds);
      setSelectedCell(null);
    } else if (
      event.shiftKey &&
      !mod &&
      !event.altKey &&
      (key === "arrowup" || key === "k" || key === "arrowdown" || key === "j")
    ) {
      event.preventDefault();
      const direction = key === "arrowup" || key === "k" ? -1 : 1;
      const picked = selectedSet.has(cell.id)
        ? selectedSet
        : new Set([cell.id]);
      const adjacent = visibleIds[index + direction];
      if (adjacent) {
        setSelectedCellIds(
          visibleIds.filter((id) => picked.has(id) || id === adjacent),
        );
        setSelectedCell(null);
        focusCommand(adjacent);
      }
    } else if (
      mod &&
      !event.altKey &&
      !event.shiftKey &&
      canChangeStructure &&
      (key === "arrowleft" || key === "arrowright")
    ) {
      if (key === "arrowleft") {
        const parent = cellsById.get(sectionParent(cell) ?? "");
        if (!parent) return;
        const siblings = siblingsOf(parent);
        const next = siblings[siblings.indexOf(parent) + 1];
        event.preventDefault();
        void moveSelection([cell.id], sectionParent(parent), next?.id);
      } else {
        const siblings = siblingsOf(cell);
        const previous = siblings[siblings.indexOf(cell) - 1];
        if (previous?.contents.kind !== "collapsible") return;
        event.preventDefault();
        void moveSelection([cell.id], previous.id);
      }
    } else if (
      !event.shiftKey &&
      !event.altKey &&
      (key === "arrowup" || key === "k" || key === "arrowdown" || key === "j")
    ) {
      event.preventDefault();
      const direction = key === "arrowup" || key === "k" ? -1 : 1;
      if (mod) {
        if (canEdit && !busyAny && !sectionPending)
          moveCellOne(cell, direction < 0 ? "up" : "down");
      } else {
        const adjacent = visibleOrder[index + direction]?.dataset.notebookCell;
        if (adjacent) focusCommand(adjacent);
      }
    } else if (
      event.altKey &&
      !mod &&
      !event.shiftKey &&
      (key === "arrowup" || key === "arrowdown")
    ) {
      event.preventDefault();
      const destination = visibleOrder.at(key === "arrowup" ? 0 : -1)?.dataset
        .notebookCell;
      if (destination) focusCommand(destination);
    }
  };

  const pickCell = (
    entry: Omit<MoreCellEntry, "name">,
    afterCellId?: string,
    beforeCellId?: string,
    parentSectionId?: string,
  ) => {
    const options =
      entry.inputType === undefined &&
      beforeCellId === undefined &&
      parentSectionId === undefined
        ? undefined
        : {
            ...(entry.inputType === undefined
              ? {}
              : { inputType: entry.inputType }),
            ...(beforeCellId === undefined ? {} : { beforeCellId }),
            ...(parentSectionId === undefined ? {} : { parentSectionId }),
          };
    void addCell(entry.kind, afterCellId, options).then((added) => {
      if (added) setPendingCellFocus(added);
    });
  };

  const gapKey = (id: string, edge: "before" | "after" | "child") =>
    `${projectScope}:${edge}:${id}`;
  const renderInsert = (
    id: string,
    vertical: boolean,
    {
      edge = "after",
      depth = 0,
    }: { edge?: "before" | "after" | "child"; depth?: number } = {},
  ) => {
    const key = gapKey(id, edge);
    const afterCellId = edge === "after" ? id : undefined;
    const pick = (entry: Omit<MoreCellEntry, "name">) =>
      pickCell(
        entry,
        afterCellId,
        edge === "before" ? id : undefined,
        edge === "child" ? id : undefined,
      );
    return (
      <InsertCellBar
        afterCellId={id}
        vertical={vertical}
        expanded={activeGap === key}
        onExpandedChange={(open) =>
          setActiveGap((current) =>
            open ? key : current === key ? null : current,
          )
        }
        disabled={addPending != null || sectionPending}
        entries={
          depth >= MAX_SECTION_DEPTH
            ? moreEntries.filter(({ kind }) => kind !== "collapsible")
            : moreEntries
        }
        supportedKinds={supportedAddKinds}
        tools={bottomTools({
          scope: projectScope,
          afterCellId: afterCellId ?? null,
          ...(edge === "before" ? { beforeCellId: id } : {}),
          ...(edge === "child" ? { parentSectionId: id } : {}),
        })}
        {...textPreference}
        onAdd={(kind) => pick({ kind })}
        onPick={pick}
      />
    );
  };

  const addCellBar = canEdit && (
    <AddCellBar
      disabled={addPending != null || sectionPending}
      entries={moreEntries}
      onAdd={(kind) => pickCell({ kind })}
      onPick={pickCell}
      supportedKinds={supportedAddKinds}
      tools={bottomTools()}
      {...textPreference}
    />
  );

  const notebookView = view === "notebook" || view === "agent";
  const editorReady = !loading && loadError == null;
  const layoutInitAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (view !== "app") {
      layoutInitAttempt.current = null;
      return;
    }
    if (
      !editorReady ||
      !canUseBuilder ||
      appLayout?.pendingWrite() ||
      layoutInitAttempt.current === projectScope
    )
      return;
    const write = initializeAppLayout(appLayout, orderedCells);
    if (!write) return;
    layoutInitAttempt.current = projectScope;
    void write.catch((error: unknown) => {
      if (currentProjectScope.current === projectScope)
        toast.error(toNotebookError(error).message);
    });
  }, [appLayout, canUseBuilder, editorReady, orderedCells, projectScope, view]);
  const failedCells =
    view === "notebook"
      ? visibleCells.filter(({ id }) => {
          if (runningIds?.has(id)) return false;
          return (
            cellFailures[id] != null ||
            outputs[id]?.status === "error" ||
            execution?.cells?.[id]?.attempt?.state.status === "failed"
          );
        })
      : [];
  const firstFailedCell = failedCells[0];

  return (
    <div
      ref={editorRef}
      className="nb-root"
      data-notebook-view={view}
      onKeyDown={handleNotebookKeyDown}
    >
      <ProjectHeader
        key={project.id}
        title={project.title}
        focusTitle={focusTitle}
        untitledOrdinal={untitledOrdinal}
        canRename={canEdit}
        isVersionPreview={isVersionPreview}
        onRename={onRename}
        view={view}
        views={[
          ...(agentPane != null || onToggleAgent != null
            ? ["agent" as const]
            : []),
          "notebook",
          ...(onSelectView != null
            ? ["source" as const, "graph" as const, "run-stats" as const]
            : []),
          ...(onSelectView != null && canUseBuilder ? ["app" as const] : []),
        ]}
        onSelectView={
          onSelectView ??
          ((next) => {
            if (onToggleAgent != null && (next === "agent") !== agentOpen)
              void onToggleAgent();
          })
        }
        onShare={onShare}
        onPublish={canPublish ? openPublishDialog : undefined}
        publishedAppPath={
          canViewPublishedApp
            ? `/app/${encodeURIComponent(project.id)}/latest`
            : undefined
        }
        publishDisabled={publishUnchanged}
        publishPending={publishPending}
        hasPublishedApp={project.publishedVersionId != null}
        onOpenHistory={
          editorReady
            ? () => {
                setRailInsert(null);
                setRailPanel("history");
              }
            : undefined
        }
        agentOpen={agentOpen}
        onToggleAgent={
          notebookView
            ? (onToggleAgent ??
              (agentPane != null && onSelectView != null
                ? () => onSelectView(agentOpen ? "notebook" : "agent")
                : undefined))
            : undefined
        }
        cellErrors={
          firstFailedCell
            ? {
                count: failedCells.length,
                labels: failedCells.map(
                  ({ id }) => titles.get(id) ?? "Untitled cell",
                ),
                jump: () => jumpToCell(firstFailedCell.id, true),
              }
            : undefined
        }
        onOpenComments={onOpenComments}
        onTrash={onTrash}
        onExportIpynb={project.language === "python" ? exportIpynb : undefined}
        onExportYaml={onExportYaml}
        onClearOutputs={
          canEdit && onClearOutputs != null
            ? () => {
                browserSession?.clear();
                void onClearOutputs().catch((error) =>
                  toast.error(toNotebookError(error).message),
                );
              }
            : undefined
        }
        onAddToCollection={canEdit ? onAddToCollection : undefined}
        onArchive={canEdit ? onArchive : undefined}
        onNewProject={onNewProject}
        favorited={project.favorited}
        onFavorite={canEdit ? onFavorite : undefined}
        onStatus={
          canEdit && !notebookView ? () => setStatusOpen(true) : undefined
        }
        onCategories={
          canEdit && !notebookView ? () => setCategoriesOpen(true) : undefined
        }
        description={project.description}
        onSaveDescription={canEdit ? onSaveDescription : undefined}
        notebookPickers={
          notebookView && editorReady ? (
            <ProjectMetaPickers
              projectId={project.id}
              statusId={project.statusId}
              canEdit={canEdit}
            />
          ) : null
        }
        renderWorkbench={renderWorkbench}
        onDuplicate={
          canEdit && onDuplicate != null ? () => onDuplicate() : undefined
        }
        onTransfer={canEdit ? () => setTransferOpen(true) : undefined}
      />
      {savingVersion && canCheckpoint ? (
        <SaveProjectVersionDialog
          projectId={project.id}
          captureHead={captureVersionHead}
          onClose={() => setSavingVersion(false)}
        />
      ) : null}
      {sharePanel}
      {componentSession !== null && onCreateComponent != null ? (
        <NewComponentDialog
          cellCount={componentSession.ids.length}
          cells={orderedCells
            .filter((cell) => componentSession.ids.includes(cell.id))
            .map((cell) => ({
              id: cell.id,
              kind: cell.contents.kind,
              label: cell.contents.label ?? null,
            }))}
          onCreate={async (name) => {
            const startedIn = project.id;
            const select = () =>
              relatedCellIds(
                graphCells(),
                componentSession.anchorId,
                "upstream",
              );
            const refuseChanged = (ids: readonly string[]): never => {
              if (latest.current.projectId === startedIn) {
                setComponentSession({
                  anchorId: componentSession.anchorId,
                  ids,
                });
                setSelectedCellIds(ids);
              }
              throw new Error(t("notebook.component.changed"));
            };
            let ids = select();
            if (ids.join() !== componentSession.ids.join()) refuseChanged(ids);
            let attempts = 0;
            const written = new Map<string, string>();
            for (;;) {
              if (latest.current.projectId !== startedIn) {
                throw new Error(t("notebook.component.changed"));
              }
              const view = latest.current;
              const pending = ids.flatMap((id) => {
                const cell = view.orderedCells.find((entry) => entry.id === id);
                return cell !== undefined &&
                  (view.drafts.isDirty(cell) ||
                    view.drafts.isSaving(cell.id)) &&
                  view.drafts.textFor(cell) !== written.get(id)
                  ? [cell]
                  : [];
              });
              const next = pending[0];
              if (next === undefined) break;
              await view.drafts.waitForSave(next.id);
              const text = view.drafts.textFor(next);
              if (!(await view.drafts.save(next, undefined, true))) {
                throw new Error(t("notebook.component.unsaved"));
              }
              written.set(next.id, text);
              attempts += 1;
              if (attempts > ids.length * 4 + 4) {
                throw new Error(t("notebook.component.unsaved"));
              }
              const after = select();
              if (after.join() !== ids.join()) refuseChanged(after);
            }
            if (latest.current.projectId !== startedIn) {
              throw new Error(t("notebook.component.changed"));
            }
            ids = select();
            if (ids.join() !== componentSession.ids.join()) refuseChanged(ids);
            return await onCreateComponent(name, ids);
          }}
          onClose={() => setComponentSession(null)}
        />
      ) : null}
      {embedCellId !== null ? (
        <CellEmbedDialog
          projectId={project.id}
          cellId={embedCellId}
          onClose={() => setEmbedCellId(null)}
        />
      ) : null}
      {publishSession?.projectId === project.id && canPublish ? (
        <PublishProjectDialog
          projectId={project.id}
          canForce={capabilityAllowed(capabilities, ids.forcePublishProject)}
          publishedAppPath={
            canViewPublishedApp
              ? `/app/${encodeURIComponent(project.id)}/latest`
              : undefined
          }
          onClose={() =>
            setPublishSession((current) =>
              current === publishSession ? null : current,
            )
          }
          onPublished={onPublished}
          onPublishingChange={(pending) =>
            onPublishingChange?.(project.id, pending)
          }
          prepare={async () => {
            const generation = projectGeneration.current;
            const initialLayout = await publishSession.layoutWrite;
            const pendingLayout = await appLayout?.pendingWrite();
            for (const cell of currentCells.current) {
              const source = connectionWrites.current.get(cell.id);
              if (source?.projectId === project.id) await source.promise;
              if (
                projectGeneration.current !== generation ||
                !(await drafts.save(
                  cell,
                  undefined,
                  true,
                  false,
                  undefined,
                  true,
                ))
              )
                throw new Error(t("notebook.saveFailed"));
            }
            if (!isCurrent(generation))
              throw new Error(t("publishedApp.previewStale"));
            await initializeAppLayout(
              appLayout,
              currentCells.current,
              pendingLayout ?? initialLayout,
            );
            const accepted = await callAction<
              z.infer<typeof notebookSnapshotReadSchema>
            >(
              "get-notebook-snapshot",
              { projectId: project.id },
              { method: "GET" },
            );
            if (
              accepted.status !== "accepted" ||
              accepted.snapshot.head.versionId !== project.workingVersionId ||
              projectGeneration.current !== generation
            )
              throw new Error(t("publishedApp.previewStale"));
            return {
              expectedHead: accepted.snapshot.head,
              expectedReleaseId: project.publishedVersionId,
            };
          }}
        />
      ) : null}
      {statusOpen ? (
        <ProjectStatusDialog
          project={project}
          onClose={() => setStatusOpen(false)}
        />
      ) : null}
      {categoriesOpen ? (
        <ProjectCategoriesDialog
          project={project}
          onClose={() => setCategoriesOpen(false)}
        />
      ) : null}
      {transferOpen ? (
        <TransferProjectOwnerDialog
          project={project}
          onClose={() => setTransferOpen(false)}
        />
      ) : null}
    </div>
  );

  function renderWorkbench(metadata: ReactNode) {
    return (
      <div className="nb-workbench">
        <div className="nb-main-card">
          {!sidebarCollapsed && (
            <ToolRail
              onOpenCommandPalette={openPalette}
              canBrowseData={canBrowseData}
              onSelect={(item) => {
                if (
                  item === "history" ||
                  item === "toc" ||
                  item === "find" ||
                  item === "help" ||
                  item === "data-browser" ||
                  item === "variables" ||
                  item === "components" ||
                  item === "environment" ||
                  item === "files"
                ) {
                  setRailInsert(null);
                  setRailPanel((current) => (current === item ? null : item));
                }
                return onOpenToolRailItem?.(item);
              }}
            />
          )}
          {!sidebarCollapsed &&
          railPanel === "data-browser" &&
          canBrowseData ? (
            <ProjectDataBrowserPanel
              key={projectScope}
              connections={connections}
              importedConnectionIds={importedConnectionIds}
              afterCellId={railAnchor?.afterCellId}
              {...(onImportConnection === undefined
                ? {}
                : { onImport: importConnection })}
              onQueryConnection={addConnectionCell}
              onClose={() => {
                setRailInsert(null);
                setRailPanel(null);
                const selected = selectedCellRef.current;
                if (selected?.projectId === project.id)
                  editorRef.current
                    ?.querySelector<HTMLElement>(
                      `[data-notebook-cell="${CSS.escape(selected.id)}"]`,
                    )
                    ?.focus();
              }}
              {...(canQueryTable && observeTableAdmission
                ? {
                    projectId: project.id,
                    onAdmitted: (receipt: QueryNotebookTableReceipt) => {
                      if (!isCurrent(tableQueryGeneration)) return;
                      observeTableAdmission(receipt.run);
                      jumpToCell(receipt.cellId, true);
                    },
                  }
                : {})}
              queryDisabled={busyAny || addPending !== null}
              onQuery={
                canQueryTable && onQueryTable
                  ? async (table) => {
                      if (busyAny || addPendingRef.current) return;
                      const generation = projectGeneration.current;
                      addPendingRef.current = true;
                      setAddFailure(null);
                      setAddPending({ kind: "sql" });
                      try {
                        const cellId = await onQueryTable(table);
                        if (cellId && isCurrent(generation)) jumpToCell(cellId);
                      } catch (error) {
                        if (isCurrent(generation))
                          toast.error(toNotebookError(error).message);
                      } finally {
                        addPendingRef.current = false;
                        setAddPending(null);
                      }
                    }
                  : undefined
              }
            />
          ) : null}
          {!sidebarCollapsed && railPanel === "help" ? (
            <ProjectHelpPanel onClose={() => setRailPanel(null)} />
          ) : null}
          {!sidebarCollapsed && railPanel === "find" ? (
            <ProjectFindPanel
              cells={orderedCells.map((cell) => ({
                id: cell.id,
                label: titles.get(cell.id) ?? "Untitled cell",
                kind:
                  cell.contents.kind === "input" ? "Input" : cell.contents.kind,
                text:
                  cell.contents.kind === "sql" || cell.contents.kind === "code"
                    ? cell.contents.source
                    : cell.contents.kind === "markdown"
                      ? cell.contents.markdown
                      : cell.contents.kind === "text"
                        ? cell.contents.text
                        : "",
              }))}
              onClose={() => {
                setRailPanel(null);
                const selected = selectedCellRef.current;
                if (selected?.projectId === project.id)
                  editorRef.current
                    ?.querySelector<HTMLElement>(
                      `[data-notebook-cell="${CSS.escape(selected.id)}"]`,
                    )
                    ?.focus();
              }}
              onJump={jumpToCell}
            />
          ) : null}
          {!sidebarCollapsed && railPanel === "toc" ? (
            <ProjectOutlinePanel
              cells={orderedCells.map((cell) => ({
                id: cell.id,
                label: titles.get(cell.id) ?? "Untitled cell",
                kind: cell.contents.kind,
              }))}
              onClose={() => setRailPanel(null)}
              onJump={jumpToCell}
            />
          ) : null}
          {!sidebarCollapsed && railPanel === "history" ? (
            <ProjectHistoryPanel
              projectId={project.id}
              onCheckpoint={
                canCheckpoint ? () => setSavingVersion(true) : undefined
              }
              beforeCompare={
                canEdit
                  ? async () => {
                      try {
                        await captureVersionHead();
                        return true;
                      } catch (error) {
                        toast.error(toNotebookError(error).message);
                        return false;
                      }
                    }
                  : undefined
              }
              onPreview={
                canEdit && onPreviewVersion
                  ? async (version) => {
                      try {
                        const head = await captureVersionHead();
                        await onPreviewVersion(version, head);
                      } catch (error) {
                        toast.error(toNotebookError(error).message);
                      }
                    }
                  : undefined
              }
              onClose={() => setRailPanel(null)}
            />
          ) : null}
          {!sidebarCollapsed && railPanel === "files" ? (
            <ProjectFilesPanel
              key={project.id}
              projectId={project.id}
              canEdit={canEdit}
              onClose={() => setRailPanel(null)}
            />
          ) : null}
          {!sidebarCollapsed && railPanel === "environment" ? (
            <ProjectEnvironmentPanel
              language={project.language}
              onClose={() => setRailPanel(null)}
            />
          ) : null}
          {!sidebarCollapsed && railPanel === "components" ? (
            <ProjectComponentsPanel
              components={componentsQuery.data?.components ?? []}
              loading={componentsQuery.isPending}
              onClose={() => setRailPanel(null)}
              onInsert={
                canEdit
                  ? (componentVersionId, name) =>
                      void addCell(
                        "component-import",
                        railAnchor?.afterCellId ?? undefined,
                        {
                          name,
                          componentVersionId,
                          ...(railAnchor?.beforeCellId === undefined
                            ? {}
                            : { beforeCellId: railAnchor.beforeCellId }),
                          ...(railAnchor?.parentSectionId === undefined
                            ? {}
                            : {
                                parentSectionId: railAnchor.parentSectionId,
                              }),
                        },
                      ).then((added) => {
                        if (added) setPendingCellFocus(added);
                      })
                  : undefined
              }
            />
          ) : null}
          {!sidebarCollapsed && railPanel === "variables" ? (
            <ProjectVariablesPanel
              variables={variables}
              liveVariables={kernelSession?.variables}
              onOpenEnvironment={
                kernelSession ? () => setRailPanel("environment") : undefined
              }
              onClose={() => setRailPanel(null)}
              onJump={jumpToCell}
            />
          ) : null}
          <div className="nb-main-scroll">
            <div
              className={
                editorPreferences.data?.fullWidthCells === false
                  ? "nb-body nb-body-contained"
                  : "nb-body"
              }
            >
              {recoveryNotice}
              {metadata != null && (editorReady || orderedCells.length > 0) && (
                <div className="nb-notebook-heading">
                  {metadata}
                  {visibleCells.length > 0 && canEdit && execution ? (
                    <NotebookRunControls
                      canRun={canRunAll}
                      showRunAll={capabilities === undefined || hasAllowedRun}
                      busy={runBusy}
                      run={execution.run}
                      saving={savingForRun && !browserSession?.active.size}
                      pending={execution.pending}
                      restarting={execution.restarting}
                      stopping={execution.stopping}
                      browserRunning={
                        browserSession?.active.size !== 0 &&
                        browserSession !== undefined
                      }
                      kernelStatus={
                        showKernelStatus
                          ? {
                              phase:
                                browserSession?.phase ??
                                (execution.restarting ||
                                activeKernelState === "starting"
                                  ? "starting"
                                  : activeKernelState === "busy"
                                    ? "running"
                                    : activeKernelState === "idle"
                                      ? "ready"
                                      : activeKernelState === "expired"
                                        ? "error"
                                        : "idle"),
                              runtime: browserSession ? "Pyodide" : "Python",
                              cells: orderedCells.length,
                              editedAt: project.updatedAt,
                              lastRunAt: lastKernelRun,
                              durations: Object.entries(outputs).flatMap(
                                ([id, output]) =>
                                  output?.durationMs == null
                                    ? []
                                    : [
                                        {
                                          label: titles.get(id) ?? id,
                                          milliseconds: output.durationMs,
                                        },
                                      ],
                              ),
                            }
                          : undefined
                      }
                      defaultMode={execution.defaultMode}
                      cellTitles={titles}
                      onRunAll={(options) => void runAllCells(options)}
                      onInterrupt={cancelRun}
                      onStop={cancelRun}
                      onRestart={restartKernel}
                      onClearOutputs={() => {
                        browserSession?.clear();
                        void onClearOutputs?.().catch((error) =>
                          toast.error(toNotebookError(error).message),
                        );
                      }}
                      onDefaultModeChange={(defaultMode) =>
                        void execution.setSettings({ defaultMode })
                      }
                      autoRerun={execution.autoRerun}
                      onAutoRerunChange={(autoRerun) =>
                        void execution.setSettings({ autoRerun })
                      }
                      onConfigureEnvironment={() => setRailPanel("environment")}
                    />
                  ) : null}
                </div>
              )}
              {view !== "app" && canEdit && review?.threadId && (
                <PendingChangesPanel
                  key={review.threadId}
                  review={review}
                  onViewVersions={() => setRailPanel("history")}
                  onLeaveThread={onLeaveReview}
                />
              )}

              {preferenceOwner && editorPreferences.isError ? (
                <div className="nb-banner-stack">
                  <div className="nb-banner nb-banner-danger" role="alert">
                    <p className="nb-banner-message">
                      {t("editorPreferences.loadFailed")}
                    </p>
                    <div className="nb-banner-actions">
                      <button
                        type="button"
                        className="nb-text-button"
                        onClick={() => void editorPreferences.refetch()}
                      >
                        {t("editorPreferences.retry")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {loadError != null && orderedCells.length > 0 && (
                <div className="nb-banner-stack">
                  {renderBanner(
                    loadRetryError ?? { message: loadError },
                    onRetryLoad == null ? undefined : () => void retryLoad(),
                    loadRetryError == null
                      ? undefined
                      : () => setLoadRetryError(null),
                    loadRetrying,
                  )}
                </div>
              )}

              {addFailure != null && (
                <div className="nb-banner-stack">
                  {renderBanner(
                    addFailure.error,
                    () => {
                      const failure = addFailure;
                      setAddFailure(null);
                      void addCell(
                        failure.kind,
                        failure.afterCellId,
                        failure.options,
                      );
                    },
                    () => setAddFailure(null),
                  )}
                </div>
              )}

              {loading && orderedCells.length === 0 ? (
                <div
                  className="nb-centered"
                  role="status"
                  aria-label="Loading notebook"
                >
                  <span
                    className="nb-spinner nb-spinner-large"
                    aria-hidden="true"
                  />
                </div>
              ) : loadError != null && orderedCells.length === 0 ? (
                <div className="nb-centered nb-nonideal" role="alert">
                  <IconFileText size={28} aria-hidden="true" />
                  <h2>Notebook unavailable</h2>
                  <p>{loadError}</p>
                  {onRetryLoad != null && (
                    <button
                      type="button"
                      className="nb-button"
                      disabled={loadRetrying}
                      onClick={() => void retryLoad()}
                    >
                      {loadRetrying ? "Retrying…" : "Retry"}
                    </button>
                  )}
                </div>
              ) : visibleCells.length === 0 &&
                view !== "app" &&
                view !== "source" &&
                view !== "graph" &&
                view !== "run-stats" ? (
                <>
                  <NotebookEmptyState
                    canBrowseData={canBrowseData}
                    connections={connections}
                    emptyState={{
                      ...emptyState,
                      ...(emptyState?.onSelectConnection
                        ? { onSelectConnection: emptyState.onSelectConnection }
                        : canBrowseData
                          ? {
                              onSelectConnection: () =>
                                setRailPanel("data-browser"),
                            }
                          : {}),
                      onBrowseAllData:
                        emptyState?.onBrowseAllData ??
                        (() => setRailPanel("data-browser")),
                      onSearchData:
                        emptyState?.onSearchData ??
                        (() => setRailPanel("data-browser")),
                      ...(canEdit
                        ? {
                            onUploadCsv:
                              emptyState?.onUploadCsv ??
                              (() => emptyCsvInputRef.current?.click()),
                          }
                        : {}),
                    }}
                  />
                  {canEdit && emptyState?.onUploadCsv == null ? (
                    <input
                      ref={emptyCsvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      hidden
                      aria-label={
                        notebookMessages.notebook.projectFiles.importCsv
                      }
                      onChange={(e) =>
                        void handleEmptyCsvUpload(e.currentTarget.files)
                      }
                    />
                  ) : null}
                  {addCellBar}
                </>
              ) : view === "source" ? (
                <ProjectSourceView cells={orderedCells} titles={titles} />
              ) : view === "graph" ? (
                <ProjectGraphView cells={orderedCells} titles={titles} />
              ) : view === "run-stats" ? (
                <ProjectRunStatsView
                  cells={orderedCells}
                  titles={titles}
                  outputs={outputs}
                />
              ) : view === "app" ? (
                <ProjectAppBuilder
                  cells={orderedCells}
                  outputs={outputs}
                  onLoadPythonPage={onLoadPythonPage}
                  getVisualizationSourceResultId={visualizationSourceResultId}
                  canEdit={canEdit && appLayout !== undefined}
                  layout={layoutDocument}
                  onChangeLayout={appLayout?.commit}
                  onInsertCell={appLayout?.insert}
                  addEntries={moreEntries}
                  supportedAddKinds={supportedAddKinds}
                  tabBookmark={appLayout?.bookmark}
                  onTabChange={appLayout?.selectTab}
                  onGenerate={
                    canEdit ? emptyState?.onAskDataQuestion : undefined
                  }
                  onViewCell={
                    onSelectView
                      ? (cellId) => {
                          setPendingCellFocus(cellId);
                          void onSelectView("notebook");
                        }
                      : undefined
                  }
                  getSourceRun={(cell) => {
                    if (!canEdit || !canRunCell(cell)) return undefined;
                    const running =
                      (savingForRun &&
                        preparingRun.current?.cellId === cell.id) ||
                      runningIds?.has(cell.id) === true;
                    return {
                      running,
                      disabled: !canRun || runAdmissionPending || running,
                      error: running
                        ? null
                        : (cellFailures[cell.id]?.error.message ??
                          drafts.drafts[cell.id]?.error?.message ??
                          outputs[cell.id]?.error ??
                          null),
                      start: () => void runCell(cell),
                    };
                  }}
                />
              ) : (
                <>
                  {selectedSet.size > 0 ? (
                    <div role="status" className="nb-selection-bar">
                      <span>
                        {selectedSet.size === 1
                          ? t("notebook.selection.one")
                          : t("notebook.selection.many", {
                              count: selectedSet.size,
                            })}
                      </span>
                      {canChangeStructure && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="nb-button">
                              {t("notebook.section.addTo")}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            className="nb-popover nb-menu-list"
                            align="start"
                          >
                            {sectionDestinationItems([...selectedSet])}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      <button
                        type="button"
                        className="nb-button"
                        onClick={() => setSelectedCellIds([])}
                      >
                        {t("notebook.selection.clear")}
                      </button>
                    </div>
                  ) : null}
                  {canEdit && !runBusy ? (
                    <ProjectErrorsPanel
                      failedCount={
                        visibleCells.filter(
                          ({ id }) =>
                            cellFailures[id] != null ||
                            outputs[id]?.error != null ||
                            execution?.cells?.[id]?.attempt?.state.status ===
                              "failed",
                        ).length
                      }
                      onRerun={() => void runAllCells()}
                    />
                  ) : null}
                  {canEdit && firstNotebookCell && (
                    <div className="nb-leading-insert">
                      {renderInsert(firstNotebookCell.id, false, {
                        edge: "before",
                      })}
                    </div>
                  )}
                  {renderSectionRows(
                    visibleLevels,
                    (cell, position, siblings, depth, renderChildren) => {
                      const item = reviewByCell.get(cell.id);
                      const title =
                        titles.get(cell.id) ??
                        notebookCellTitle(cell.contents, position + 1);
                      const selection = {
                        projectId: project.id,
                        cellId: cell.id,
                        title,
                      };
                      if (item && review) {
                        return (
                          <div
                            key={cell.id}
                            onFocusCapture={() => {
                              setSelectedCell(null);
                              onSelectCell?.({
                                ...selection,
                                proposalId: item.change.id,
                              });
                            }}
                          >
                            <PendingCellDiff
                              change={item.change}
                              index={item.index}
                              title={title}
                              review={review}
                              onFix={onFixWithAgent}
                            />
                          </div>
                        );
                      }
                      const failedAttempt =
                        execution?.cells?.[cell.id]?.attempt;
                      const chartEdit = chartEdits[cell.id];
                      const failure = cellFailures[cell.id];
                      const draftError = drafts.drafts[cell.id]?.error ?? null;
                      const primaryError = failure?.error ?? draftError;
                      const connectionId = Object.prototype.hasOwnProperty.call(
                        connectionOverrides,
                        cell.id,
                      )
                        ? connectionOverrides[cell.id]!
                        : cell.contents.kind === "sql"
                          ? (cell.contents.dataConnectionId ??
                            (cell.contents.connectionMode === "dataframes"
                              ? null
                              : connections.find(
                                  (connection) => connection.isDefault,
                                )?.id))
                          : undefined;
                      const pendingHere = addPending?.afterCellId === cell.id;
                      const addAdjacent =
                        canEdit && !busyAny
                          ? (above: boolean) => {
                              const previous = siblings[position - 1];
                              const key =
                                above && previous
                                  ? gapKey(previous.id, "after")
                                  : gapKey(cell.id, above ? "before" : "after");
                              setActiveGap(key);
                            }
                          : undefined;
                      const inlineInput = isRenderableInput(cell.contents);
                      const selectCellOnFocus = (
                        event: FocusEvent<HTMLDivElement>,
                      ) => {
                        const article = event.target.closest<HTMLElement>(
                          "[data-notebook-cell]",
                        );
                        if (article && article.dataset.notebookCell !== cell.id)
                          return;
                        const selection = {
                          kind: "cell" as const,
                          id: cell.id,
                          projectId: project.id,
                        };
                        if (
                          selectedCell?.id !== cell.id ||
                          selectedCell.projectId !== project.id
                        )
                          setSelectedCell(selection);
                        onSelectCell?.({
                          projectId: project.id,
                          cellId: cell.id,
                          title,
                        });
                        if (
                          selectedCellRef.current?.id === cell.id &&
                          selectedCellRef.current.projectId === project.id
                        )
                          return;
                        selectedCellRef.current = selection;
                        void writeClientAppState(
                          `selection:${TAB_ID}`,
                          selection,
                          { requestSource: TAB_ID },
                        ).catch((error) => {
                          if (selectedCellRef.current === selection)
                            selectedCellRef.current = null;
                          console.error(
                            "Could not update notebook selection",
                            error,
                          );
                        });
                      };
                      const isModSelectionClick = (
                        event: MouseEvent<HTMLDivElement>,
                      ) => {
                        if (
                          event.button !== 0 ||
                          !(event.metaKey || event.ctrlKey) ||
                          event.altKey ||
                          event.shiftKey
                        )
                          return false;
                        const target = event.target as HTMLElement | null;
                        if (
                          target?.closest(
                            'input, textarea, select, [contenteditable="true"], a[href], [role="menu"], [role="dialog"]',
                          )
                        )
                          return false;
                        const article = target?.closest<HTMLElement>(
                          "[data-notebook-cell]",
                        );
                        return (
                          !article || article.dataset.notebookCell === cell.id
                        );
                      };
                      const handleCellSlotMouseDownCapture = (
                        event: MouseEvent<HTMLDivElement>,
                      ) => {
                        if (!isModSelectionClick(event)) return;
                        event.preventDefault();
                        const seed =
                          selectedSet.size > 0
                            ? [...selectedSet]
                            : selectedCell?.projectId === project.id
                              ? [selectedCell.id]
                              : [];
                        const next = new Set(seed);
                        if (next.has(cell.id)) next.delete(cell.id);
                        else next.add(cell.id);
                        const orderedNext = orderedCells
                          .map((entry) => entry.id)
                          .filter((id) => next.has(id));
                        setSelectedCellIds(orderedNext);
                        setSelectedCell(null);
                      };
                      const handleCellSlotClickCapture = (
                        event: MouseEvent<HTMLDivElement>,
                      ) => {
                        if (!isModSelectionClick(event)) return;
                        event.preventDefault();
                        event.stopPropagation();
                      };
                      if (cell.contents.kind === "collapsible") {
                        const descendants = sectionDescendantIds(
                          orderedCells,
                          cell.id,
                        );
                        const errored = descendants.filter((id) =>
                          browserSession?.outputs[id]
                            ? browserSession.outputs[id].status === "error"
                            : execution?.cells?.[id]?.attempt?.state.status ===
                                "failed" || outputs[id]?.status === "error",
                        );
                        const running = descendants.filter(
                          (id) =>
                            runningIds?.has(id) ||
                            isRunningStatus(outputs[id]?.status),
                        );
                        const hot = errored.length > 0 ? errored : running;
                        const firstChild = visibleLevels.get(cell.id)?.[0];
                        const collapsed =
                          sectionOverrides.get(cell.id) ??
                          cell.contents.collapsed;
                        return (
                          <div
                            className="nb-cell-slot"
                            key={cell.id}
                            onFocusCapture={selectCellOnFocus}
                            onMouseDownCapture={handleCellSlotMouseDownCapture}
                            onClickCapture={handleCellSlotClickCapture}
                          >
                            <SectionCell
                              id={cell.id}
                              title={cell.contents.title}
                              collapsed={collapsed}
                              depth={depth}
                              headingStyle={cell.contents.headingStyle}
                              selected={
                                selectedSet.size > 0
                                  ? selectedSet.has(cell.id)
                                  : selectedCell?.projectId === project.id &&
                                    selectedCell.id === cell.id
                              }
                              empty={firstChild === undefined}
                              status={
                                hot[0] === undefined
                                  ? undefined
                                  : {
                                      count: hot.length,
                                      kind:
                                        errored.length > 0
                                          ? "errored"
                                          : "running",
                                      jump: () => {
                                        const target = hot[0];
                                        if (target !== undefined) {
                                          setSelectedCellIds([]);
                                          jumpToCell(target, true);
                                        }
                                      },
                                    }
                              }
                              error={primaryError?.message}
                              destinationMenu={sectionSubmenu([cell.id])}
                              canDrag={canMoveByDrag && canChangeStructure}
                              canChangeStructure={canChangeStructure}
                              configPending={sectionPending}
                              runBusy={runBusy || sectionPending}
                              onToggle={() =>
                                void updateCollapsed(cell, !collapsed)
                              }
                              onConfigure={
                                canEdit && onSectionChange
                                  ? (config) =>
                                      void changeSection({
                                        type: "set-section",
                                        cellId: cell.id,
                                        config,
                                      })
                                  : undefined
                              }
                              onDropCell={
                                canChangeStructure && canMoveByDrag
                                  ? (draggedId, placement) =>
                                      dropCell(draggedId, cell.id, placement)
                                  : undefined
                              }
                              onDelete={() =>
                                changeSection({
                                  type: "remove-section",
                                  cellId: cell.id,
                                  mode: "delete",
                                })
                              }
                              onEject={() =>
                                void changeSection({
                                  type: "remove-section",
                                  cellId: cell.id,
                                  mode: "eject",
                                })
                              }
                              onRun={
                                canRunSection(cell.id)
                                  ? () =>
                                      void submitRun({
                                        sectionId: cell.id,
                                      })
                                  : undefined
                              }
                            >
                              {canEdit &&
                                renderInsert(firstChild?.id ?? cell.id, false, {
                                  edge: firstChild ? "before" : "child",
                                  depth: depth + 1,
                                })}
                              {!collapsed && renderChildren()}
                            </SectionCell>
                            {pendingHere && (
                              <PendingCell kind={addPending.kind} />
                            )}
                            {canEdit &&
                              !pendingHere &&
                              renderInsert(cell.id, false, { depth })}
                          </div>
                        );
                      }
                      const index = orderedCells.indexOf(cell);
                      return (
                        <div
                          className={
                            inlineInput ? INLINE_SLOT_CLASS : "nb-cell-slot"
                          }
                          key={cell.id}
                          onFocusCapture={selectCellOnFocus}
                          onMouseDownCapture={handleCellSlotMouseDownCapture}
                          onClickCapture={handleCellSlotClickCapture}
                        >
                          <NotebookCellBoundary
                            onReady={markCellRendererReady}
                            justAdded={pendingCellFocus === cell.id}
                            selected={
                              selectedSet.size > 0
                                ? selectedSet.has(cell.id)
                                : selectedCell?.projectId === project.id &&
                                  selectedCell.id === cell.id
                            }
                            lineNumbers={
                              editorPreferences.data?.lineNumbers ?? true
                            }
                            vim={editorPreferences.data?.vim === true}
                            cell={
                              chartEdit?.projectId === project.id
                                ? {
                                    ...cell,
                                    contents: chartEdit.contents,
                                  }
                                : cell
                            }
                            title={
                              titles.get(cell.id) ??
                              cellKindDefinition(cell.contents.kind).name
                            }
                            connections={connections}
                            importedConnectionIds={importedConnectionIds}
                            addConnectionHref={addConnectionHref}
                            dataframes={dataframes}
                            metricTitleValues={metricTitleValues}
                            visualizationSourceResultId={visualizationSourceResultId(
                              cell,
                            )}
                            dataframeSchema={
                              cell.contents.kind === "sql" &&
                              connectionId === null
                                ? Object.fromEntries(
                                    orderedCells
                                      .slice(0, index)
                                      .flatMap((producer) => {
                                        if (
                                          producer.contents.kind !== "sql" ||
                                          !producer.contents.resultVariable
                                        )
                                          return [];
                                        const state = outputs[producer.id];
                                        if (
                                          state?.status !== "complete" ||
                                          !state.resultFields
                                        )
                                          return [];
                                        return [
                                          [
                                            producer.contents.resultVariable,
                                            state.resultFields.map(
                                              ({ name, type }) => ({
                                                label: name,
                                                detail: type,
                                                type: "property",
                                              }),
                                            ),
                                          ] as const,
                                        ];
                                      }),
                                  )
                                : undefined
                            }
                            connectionsLoading={connectionsLoading}
                            connectionsError={connectionsError}
                            selectionStatus={
                              typeof connectionId === "string"
                                ? selectedConnectionStates[connectionId]
                                : undefined
                            }
                            canEdit={canEdit}
                            canRun={
                              (canEdit || execution != null) && canRunCell(cell)
                            }
                            busy={busyAny}
                            runBusy={!canRun || runAdmissionPending}
                            deleteBlocked={
                              preparingRun.current?.cellId === cell.id
                            }
                            running={runningIds?.has(cell.id) ?? false}
                            saving={drafts.isSaving(cell.id)}
                            deleting={deletingIds.has(cell.id)}
                            connectionPending={connectionPendingIds.has(
                              cell.id,
                            )}
                            connectionId={connectionId}
                            draftText={drafts.textFor(cell)}
                            dirty={drafts.isDirty(cell)}
                            stale={drafts.isStale(cell)}
                            runMode={execution?.defaultMode ?? "auto"}
                            runState={
                              browserSession?.outputs[cell.id] ||
                              (outputs[cell.id]?.status === "error" &&
                                execution?.cells?.[cell.id]?.attempt?.state
                                  .status === "blocked")
                                ? undefined
                                : execution?.cells?.[cell.id]?.attempt?.state
                            }
                            staleOutput={
                              dirtyInputDependents.has(cell.id) ||
                              (browserSession?.outputs[cell.id]
                                ? browserSession.stale.has(cell.id) ||
                                  drafts.isDirty(cell)
                                : execution?.cells?.[cell.id]?.stale === true)
                            }
                            outputState={outputs[cell.id]}
                            onFixWithAgent={
                              onFixWithAgent &&
                              cell.contents.kind === "sql" &&
                              failedAttempt?.state.status === "failed"
                                ? () =>
                                    onFixWithAgent(
                                      cell.id,
                                      failedAttempt.attempt.attemptId,
                                    )
                                : undefined
                            }
                            onUseAi={
                              onUseAi && cell.contents.kind === "sql"
                                ? () =>
                                    onUseAi(
                                      selection,
                                      connections.find(
                                        ({ id }) => id === connectionId,
                                      )?.name,
                                    )
                                : undefined
                            }
                            onLoadResultRows={
                              onLoadResultRows == null
                                ? undefined
                                : (requiredRowCount) =>
                                    onLoadResultRows(cell.id, requiredRowCount)
                            }
                            onLoadResultPage={
                              onLoadResultPage == null
                                ? undefined
                                : (offset, requestId) =>
                                    onLoadResultPage(cell.id, offset, requestId)
                            }
                            onLoadPythonPage={onLoadPythonPage}
                            error={primaryError}
                            onTextChange={(text) => {
                              if (cell.contents.kind === "input")
                                inputs.change(cell, text);
                              else drafts.update(cell, text);
                            }}
                            onSaveDraft={(value, optionsResultId) => {
                              if (cell.contents.kind === "input")
                                void inputs.commit(
                                  cell,
                                  value,
                                  optionsResultId,
                                );
                              else void drafts.save(cell, value);
                            }}
                            onAddResultCell={
                              canEdit && !busyAny
                                ? (kind, dataframe) => {
                                    void addCell(kind, cell.id, {
                                      dataframe,
                                    });
                                  }
                                : undefined
                            }
                            onDuplicateMetricAsSql={
                              canEdit && !busyAny
                                ? (source, dataConnectionId) => {
                                    void addCell("sql", cell.id, {
                                      source,
                                      dataConnectionId,
                                    });
                                  }
                                : undefined
                            }
                            onSaveContents={(
                              contents,
                              expectedUpdatedAt,
                              optionsResultId,
                            ) => {
                              const save =
                                expectedUpdatedAt === undefined &&
                                optionsResultId === undefined
                                  ? onSaveCell(cell.id, contents)
                                  : onSaveCell(
                                      cell.id,
                                      contents,
                                      expectedUpdatedAt,
                                      optionsResultId,
                                    );
                              pendingContentSaves.current.add(save);
                              if (contents.kind !== "chart") {
                                return save
                                  .catch((error) =>
                                    toast.error(toNotebookError(error).message),
                                  )
                                  .finally(() =>
                                    pendingContentSaves.current.delete(save),
                                  );
                              }
                              const edit = {
                                projectId: project.id,
                                contents,
                              };
                              setChartEdits((previous) => ({
                                ...previous,
                                [cell.id]: edit,
                              }));
                              void save
                                .then(() => {
                                  pendingContentSaves.current.delete(save);
                                  setChartEdits((previous) => {
                                    if (previous[cell.id] !== edit)
                                      return previous;
                                    const next = { ...previous };
                                    delete next[cell.id];
                                    return next;
                                  });
                                })
                                .catch((error) => {
                                  pendingContentSaves.current.delete(save);
                                  setChartEdits((previous) => {
                                    if (previous[cell.id] !== edit)
                                      return previous;
                                    const next = { ...previous };
                                    delete next[cell.id];
                                    return next;
                                  });
                                  console.error(
                                    "Could not save chart settings",
                                    error,
                                  );
                                  toast.error(toNotebookError(error).message);
                                });
                            }}
                            onRun={(mode, options) =>
                              void runCell(cell, mode, options)
                            }
                            {...(execution && canRunCell(cell)
                              ? { onStop: () => cancelRun(cell.id) }
                              : {})}
                            stopping={
                              execution?.stopping === true &&
                              runningIds?.has(cell.id) === true
                            }
                            stopAvailable={runningIds?.has(cell.id) ?? false}
                            onRunAndAdvance={(insert) => {
                              void runCell(cell, undefined, undefined, () => {
                                const currentIndex =
                                  currentCells.current.findIndex(
                                    (candidate) => candidate.id === cell.id,
                                  );
                                const next =
                                  currentCells.current[currentIndex + 1];
                                if (!insert && next) {
                                  focusCell(next.id);
                                  return;
                                }
                                void addCell(
                                  insert && supportedAddKinds.includes("code")
                                    ? "code"
                                    : cell.contents.kind,
                                  cell.id,
                                ).then((added) => {
                                  if (added) setPendingCellFocus(added);
                                });
                              });
                            }}
                            onDiscard={() => {
                              drafts.discard(cell);
                              drafts.clearError(cell.id);
                              clearCellFailure(cell.id);
                            }}
                            onOverwrite={() => void overwriteCell(cell)}
                            onDelete={() => void deleteCell(cell)}
                            onCommandDelete={() => {
                              const next =
                                siblings[position + 1] ??
                                siblings[position - 1];
                              void deleteCell(cell).then((deleted) => {
                                if (deleted && next)
                                  editorRef.current
                                    ?.querySelector<HTMLElement>(
                                      `[data-notebook-cell="${CSS.escape(next.id)}"]`,
                                    )
                                    ?.focus();
                              });
                            }}
                            onAddAbove={
                              addAdjacent && (() => addAdjacent(true))
                            }
                            onAddBelow={
                              addAdjacent && (() => addAdjacent(false))
                            }
                            onCommandAdd={
                              canEdit && !busyAny
                                ? (kind, above) => {
                                    const added = kind ?? cell.contents.kind;
                                    if (
                                      !COMMAND_ADD_KINDS.includes(added) ||
                                      !supportedAddKinds.includes(added)
                                    ) {
                                      addAdjacent?.(above);
                                      return;
                                    }
                                    void addCell(
                                      added,
                                      above ? undefined : cell.id,
                                      above
                                        ? { beforeCellId: cell.id }
                                        : undefined,
                                    ).then((id) => {
                                      if (!id) return;
                                      commandFocusRef.current = id;
                                      setPendingCellFocus(id);
                                    });
                                  }
                                : undefined
                            }
                            hasPublishedApp={project.publishedVersionId != null}
                            onSelectRelated={(relation) =>
                              selectRelated(cell.id, relation)
                            }
                            onEmbed={() => setEmbedCellId(cell.id)}
                            onNewComponent={
                              canEdit &&
                              onCreateComponent != null &&
                              secondaryFeaturesEnabled()
                                ? () => {
                                    const ids = relatedCellIds(
                                      graphCells(),
                                      cell.id,
                                      "upstream",
                                    );
                                    setSelectedCellIds(ids);
                                    setComponentSession({
                                      anchorId: cell.id,
                                      ids,
                                    });
                                  }
                                : undefined
                            }
                            onPasteCell={
                              canEdit && onPasteCell != null
                                ? (contents) => onPasteCell(cell.id, contents)
                                : undefined
                            }
                            onFormatSql={
                              canEdit
                                ? async (source) =>
                                    (
                                      await callAction<{
                                        formattedSource: string;
                                      }>("format-notebook-sql", {
                                        projectId: cell.projectId,
                                        cellId: cell.id,
                                        source,
                                      })
                                    ).formattedSource
                                : undefined
                            }
                            unavailableVariables={orderedCells.flatMap(
                              ({ id, contents }) =>
                                id === cell.id
                                  ? []
                                  : contents.kind === "input"
                                    ? [contents.name]
                                    : "resultVariable" in contents &&
                                        contents.resultVariable
                                      ? [contents.resultVariable]
                                      : [],
                            )}
                            onDuplicateCell={
                              canEdit && onDuplicateCell != null
                                ? () => void onDuplicateCell(cell.id)
                                : undefined
                            }
                            onMoveUp={
                              canEdit &&
                              position > 0 &&
                              (onMoveCell != null || canChangeStructure)
                                ? () => moveCellOne(cell, "up")
                                : undefined
                            }
                            onMoveDown={
                              canEdit &&
                              position < siblings.length - 1 &&
                              (onMoveCell != null || canChangeStructure)
                                ? () => moveCellOne(cell, "down")
                                : undefined
                            }
                            canDrag={canMoveByDrag}
                            sectionDestinationMenu={sectionSubmenu([cell.id])}
                            canMoveThroughSections={canChangeStructure}
                            onDropCell={
                              canMoveByDrag
                                ? (draggedCellId, placement) =>
                                    dropCell(draggedCellId, cell.id, placement)
                                : undefined
                            }
                            onSelectConnection={(connectionIdValue) =>
                              void selectConnection(cell, connectionIdValue)
                            }
                            onDismissError={() => {
                              drafts.clearError(cell.id);
                              clearCellFailure(cell.id);
                            }}
                            onRetryError={
                              (failure && failure.action.kind !== "run") ||
                              canRunCell(cell)
                                ? () => {
                                    if (failure) retryFailure(cell, failure);
                                    else void runCell(cell);
                                  }
                                : undefined
                            }
                          />
                          {pendingHere && addPending != null && (
                            <PendingCell kind={addPending.kind} />
                          )}
                          {canEdit &&
                            !pendingHere &&
                            renderInsert(cell.id, inlineInput, { depth })}
                        </div>
                      );
                    },
                  )}
                  {addPending != null && !pendingAfterFound && (
                    <PendingCell kind={addPending.kind} />
                  )}
                  {addCellBar}
                </>
              )}
            </div>
          </div>
        </div>
        {agentOpen && (
          <AgentPane
            fullPage={view === "agent"}
            agentPane={agentPane}
            agentComposer={agentComposer}
            onClose={
              onToggleAgent == null ? undefined : () => void onToggleAgent()
            }
            onLearnMore={
              onLearnMoreAgent == null
                ? undefined
                : () => void onLearnMoreAgent()
            }
            onAddContext={
              onAddAgentContext == null
                ? undefined
                : () => void onAddAgentContext()
            }
            onSubmitPrompt={onSubmitAgentPrompt}
          />
        )}
      </div>
    );
  }
}
