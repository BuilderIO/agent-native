import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useReaderLocale } from "@agent-native/toolkit/app/shared/reader-locale";
import { Tooltip } from "@agent-native/toolkit/design-system";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { closeCompletion, completionStatus } from "@codemirror/autocomplete";
import { sql, type SQLNamespace } from "@codemirror/lang-sql";
import { vim as vimExtension } from "@replit/codemirror-vim";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowUp,
  IconArrowsMaximize,
  IconBold,
  IconCode,
  IconChevronDown,
  IconChevronRight,
  IconClipboard,
  IconCopy,
  IconCut,
  IconDots,
  IconGripVertical,
  IconHeading,
  IconItalic,
  IconLink,
  IconList,
  IconListTree,
  IconMarkdown,
  IconPlayerStopFilled,
  IconPuzzle,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconTrash,
} from "@tabler/icons-react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notebookMessages } from "@/i18n/messages/notebook";
import { cellLinkHref } from "@/lib/cell-link";
import type { CellRelation } from "@/lib/model/cell-graph";
import { inputNameToLabel } from "@/lib/model/cell-references";
import type { CellKind } from "@/lib/model/cell-types";
import type { Cell, CellOutput, ChartSpec } from "@/lib/model/contracts";
import { referencedCteName, splitSqlCtes } from "@/lib/model/split-sql-ctes";

import type { CellRunReceipt } from "../../../shared/notebook-execution";
import { isSqlInputName } from "../../../shared/sql-input-name";
import {
  decodeCellFromClipboard,
  encodeCellForClipboard,
} from "./cell-clipboard";
import {
  useCellDragSource,
  useCellDropTarget,
  type CellDropPlacement,
} from "./cell-drag";
import { CellOutputView } from "./CellOutputView";
import type { ChartDataframe } from "./chart-config";
import { ChartConfigBody } from "./ChartConfigBody";
import { CompleteChartEditor, usesCompleteChart } from "./CompleteResultChart";
import { ComponentImportBody } from "./ComponentImportBody";
import { ConnectionPicker } from "./ConnectionPicker";
import { DbtMetricCell } from "./DbtMetricCell";
import { InputCellControl, isRenderableInput } from "./InputCellControl";
import { MarkdownCellView } from "./MarkdownCellView";
import { MetricCell } from "./MetricCell";
import {
  insertCommands,
  notebookCommands,
  notebookLetter,
} from "./notebook-commands";
import {
  CellRunActions,
  CellRunButton,
  getCellRunShortcut,
  useLastRunLabel,
  type CellRunMode,
  type CellRunOptions,
} from "./NotebookRunControls";
import { PivotCell } from "./PivotCell";
import { PythonCellExports, PythonCellOutput } from "./PythonCellOutput";
import { PythonSourceHighlight } from "./PythonSourceHighlight";
import { TableCell } from "./TableCell";
import type {
  LoadPythonPage,
  LoadResultPage,
  LoadResultRows,
  NotebookActionError,
  NotebookCellOutputState,
  NotebookConnection,
} from "./types";
import { useCellCollapsed } from "./useCellCollapse";
import {
  cellIsRunnable,
  cellLabelFromInput,
  cellContentsWithText,
  cellUsesConnection,
  describeCell,
  editableCellText,
  formatOutputSummary,
  isRunningStatus,
} from "./utils";
import { VegaSpecChart } from "./VegaChart";

/**
 * A collapsed source or output keeps a placeholder button for expanding it.
 */
export function CollapsedCellPlaceholder({
  label,
  onExpand,
}: {
  /** "Code collapsed" or "Result collapsed". */
  label: string;
  onExpand: () => void;
}) {
  const t = useT();
  return (
    <div className="nb-cell-collapsed">
      <Tooltip
        content={t("notebook.clickToExpand", {
          defaultValue: notebookMessages.notebook.clickToExpand,
        })}
        delayMs={1000}
        placement="bottom"
        trigger={
          <button
            type="button"
            className="nb-collapsed-button"
            onClick={onExpand}
          >
            {label}
          </button>
        }
      />
    </div>
  );
}

export function NotebookCell({
  justAdded = false,
  lineNumbers = false,
  vim = false,
  cell,
  title,
  selected = false,
  connections,
  importedConnectionIds,
  addConnectionHref,
  dataframes = [],
  visualizationSourceResultId = null,
  metricTitleValues,
  dataframeSchema,
  connectionsLoading = false,
  connectionsError = null,
  selectionStatus,
  workspaceId = null,
  canEdit,
  canRun = canEdit,
  busy,
  runBusy = busy,
  deleteBlocked = false,
  running,
  saving,
  deleting,
  connectionPending,
  connectionId,
  draftText,
  dirty,
  stale,
  staleOutput: staleAcceptedOutput = false,
  runMode = "auto",
  runState,
  outputState,
  onLoadResultRows,
  onLoadResultPage,
  onLoadPythonPage,
  onFixWithAgent,
  onUseAi,
  error,
  onTextChange,
  onSaveDraft,
  onSaveContents,
  onAddResultCell,
  onDuplicateMetricAsSql,
  onRun,
  onStop,
  stopping = false,
  stopAvailable = false,
  onRunAndAdvance,
  onDiscard,
  onOverwrite,
  onDelete,
  onCommandDelete,
  onAddAbove,
  onAddBelow,
  onCommandAdd,
  unavailableVariables = [],
  onMoveUp,
  onMoveDown,
  sectionDestinationMenu,
  canMoveThroughSections,
  canDrag = false,
  onDropCell,
  onDuplicateCell,
  onPasteCell,
  onFormatSql,
  hasPublishedApp = false,
  onSelectRelated,
  onEmbed,
  onNewComponent,
  onSelectConnection,
  onDismissError,
  onRetryError,
}: {
  lineNumbers?: boolean;
  vim?: boolean;
  cell: Cell;
  title: string;
  selected?: boolean;
  connections: readonly NotebookConnection[];
  importedConnectionIds?: ReadonlySet<string> | undefined;
  addConnectionHref?: string | undefined;
  /** The result variables a chart cell can be drawn from. */
  dataframes?: readonly ChartDataframe[] | undefined;
  visualizationSourceResultId?: string | null;
  metricTitleValues?: ReadonlyMap<string, string> | undefined;
  dataframeSchema?: SQLNamespace | undefined;
  connectionsLoading?: boolean;
  connectionsError?: string | null;
  selectionStatus?: "missing" | "unavailable" | undefined;
  /** Workspace the project belongs to; scopes remembered collapse state. */
  workspaceId?: string | null;
  canEdit: boolean;
  canRun?: boolean;
  /** Another cell is saving or running. */
  busy: boolean;
  runBusy?: boolean;
  deleteBlocked?: boolean;
  running: boolean;
  saving: boolean;
  deleting: boolean;
  connectionPending: boolean;
  connectionId: string | null | undefined;
  draftText: string;
  dirty: boolean;
  stale: boolean;
  staleOutput?: boolean;
  runMode?: CellRunMode;
  runState?: CellRunReceipt["state"] | undefined;
  outputState: NotebookCellOutputState | undefined;
  onLoadResultRows?: LoadResultRows | undefined;
  onLoadResultPage?: LoadResultPage | undefined;
  onLoadPythonPage?: LoadPythonPage | undefined;
  onFixWithAgent?: (() => void) | undefined;
  onUseAi?: (() => void) | undefined;
  error: NotebookActionError | null;
  onTextChange: (text: string) => void;
  onSaveDraft: (value?: string, inputOptionsResultId?: string) => void;
  /** Saves a cell's own settings, such as a dropdown input's values. */
  onSaveContents?:
    | ((
        contents: Cell["contents"],
        expectedUpdatedAt?: string,
        optionsResultId?: string,
      ) => void | Promise<unknown>)
    | undefined;
  onAddResultCell?:
    | ((kind: "sql" | "chart" | "pivot", dataframe: string) => void)
    | undefined;
  onDuplicateMetricAsSql?:
    | ((sql: string, dataConnectionId: string) => void)
    | undefined;
  onRun: (mode?: CellRunMode, options?: CellRunOptions) => void;
  onStop?: () => void;
  stopping?: boolean;
  stopAvailable?: boolean;
  onRunAndAdvance?: (insert: boolean) => void;
  onDiscard: () => void;
  onOverwrite: () => void;
  onDelete: () => void;
  onCommandDelete?: () => void;
  onAddAbove?: (() => void) | undefined;
  onAddBelow?: (() => void) | undefined;
  onCommandAdd?:
    | ((kind: CellKind | undefined, above: boolean) => void)
    | undefined;
  unavailableVariables?: readonly string[];
  onMoveUp?: (() => void) | undefined;
  onMoveDown?: (() => void) | undefined;
  sectionDestinationMenu?: ReactNode;
  canMoveThroughSections?: boolean;
  canDrag?: boolean | undefined;
  onDropCell?:
    | ((draggedCellId: string, placement: CellDropPlacement) => void)
    | undefined;
  onDuplicateCell?: (() => void) | undefined;
  /** Insert a copied cell after this one. */
  onPasteCell?:
    | ((contents: Omit<Cell["contents"], "id" | "order">) => Promise<void>)
    | undefined;
  /** Returns the formatted text, or rejects with the reason to show. */
  onFormatSql?: ((sql: string) => Promise<string>) | undefined;
  hasPublishedApp?: boolean | undefined;
  onSelectRelated?: ((relation: CellRelation) => void) | undefined;
  onEmbed?: (() => void) | undefined;
  onNewComponent?: (() => void) | undefined;
  onSelectConnection: (connectionId: string | null) => void;
  onDismissError: () => void;
  onRetryError?: (() => void) | undefined;
  justAdded?: boolean;
}) {
  const t = useT();
  const locale = useReaderLocale();
  const proseCell =
    cell.contents.kind === "text" || cell.contents.kind === "markdown";
  const [proseEditing, setProseEditing] = useState(false);
  useEffect(() => {
    if (justAdded && proseCell) setProseEditing(true);
  }, [justAdded, proseCell]);
  const editCellLabel = t("notebook.editCellLabel", {
    title,
    defaultValue: notebookMessages.notebook.editCellLabel,
  });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(title);
  const [invalidRename, setInvalidRename] = useState(false);
  const startRename = () => {
    setRenameDraft(inputContents?.name ?? title);
    setInvalidRename(false);
    setRenaming(true);
  };
  const bodyId = useId();
  const outputId = useId();
  const articleRef = useRef<HTMLElement>(null);
  const commandPrefix = useRef<{ key: string; at: number } | null>(null);
  const pythonPaintRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Input and output sections remember independent per-cell presentation
  // preferences so a reload keeps the same layout.
  const {
    sourceCollapsed,
    outputCollapsed: savedOutputCollapsed,
    toggleSourceCollapsed,
    toggleOutputCollapsed,
  } = useCellCollapsed({
    cellId: cell.id,
    projectId: cell.projectId,
    workspaceId,
  });
  const expandLabel = t("notebook.cellExpand", {
    defaultValue: notebookMessages.notebook.cellExpand,
  });
  const collapseLabel = t("notebook.cellCollapse", {
    defaultValue: notebookMessages.notebook.cellCollapse,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const skipMenuFocusRestore = useRef(false);
  const drag = useCellDragSource(cell.id);
  const drop = useCellDropTarget(onDropCell);
  const inputContents = cell.contents.kind === "input" ? cell.contents : null;
  const showInputNameError =
    canEdit &&
    inputContents !== null &&
    (invalidRename || !isSqlInputName(inputContents.name));

  // A chart cell is configured in its own body: every control there saves the
  // cell's settings, so what the person picks is what the cell keeps.
  const chartContents = cell.contents.kind === "chart" ? cell.contents : null;
  const saveChartSettings = (next: {
    dataframe?: string | null;
    chartSpec?: Partial<ChartSpec>;
  }) => {
    if (chartContents == null || onSaveContents == null || !canEdit || saving) {
      return;
    }
    const chartSpec = { ...chartContents.chartSpec, ...next.chartSpec };
    if (chartSpec.version === 3)
      chartSpec.revision = (chartContents.chartSpec.revision ?? 0) + 1;
    onSaveContents({
      ...chartContents,
      ...(chartSpec.version !== undefined && next.chartSpec?.title !== undefined
        ? { label: next.chartSpec.title }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(next, "dataframe")
        ? { dataframe: next.dataframe ?? null }
        : {}),
      chartSpec,
    });
  };

  const editable = editableCellText(cell.contents) != null;
  const blocked = runState?.status === "blocked";
  const output = blocked ? null : (outputState?.output ?? null);
  const runnable = canRun && cellIsRunnable(cell.contents);
  const python =
    cell.contents.kind === "code" && cell.contents.language === "python";
  const pythonResult = !blocked && python ? outputState : undefined;
  const pythonOutputs = pythonResult?.pythonOutputs;
  const pythonExports = pythonResult?.exports;
  const hasPythonOutput = pythonOutputs != null && pythonOutputs.length > 0;
  const hasPythonExports = pythonExports != null && pythonExports.length > 0;
  const unknownCancellation =
    output?.type === "error" &&
    output.code === "cancel_unknown" &&
    !dirty &&
    !stale;
  const outputEnabled =
    !("outputResult" in cell.contents) || cell.contents.outputResult !== false;
  const outputError = blocked ? null : (outputState?.error ?? null);
  const queued =
    runState?.status === "queued" || outputState?.status === "queued";
  const runLoading =
    !blocked &&
    (running ||
      runState?.status === "running" ||
      (!outputState?.recoveryRequired &&
        (isRunningStatus(outputState?.status) || queued)));
  const artifactLoading = !blocked && outputState?.artifactLoading === true;
  const hasOutput =
    outputEnabled &&
    (output != null ||
      outputError != null ||
      runLoading ||
      artifactLoading ||
      hasPythonOutput);
  const shownOutput: CellOutput | null =
    outputError != null
      ? { type: "error", message: outputError, detail: null }
      : output;
  const queryError =
    cell.contents.kind === "sql" && !outputState?.artifactError;
  const showQueryFailure =
    queryError &&
    shownOutput?.type === "error" &&
    shownOutput.code !== "interrupted" &&
    shownOutput.code !== "cancel_unknown";
  const canCollapseOutput = !showQueryFailure && (!python || hasPythonOutput);
  const outputCollapsed = savedOutputCollapsed && canCollapseOutput;
  const summary = runLoading
    ? t(queued ? "notebook.runQueued" : "notebook.running")
    : outputError != null
      ? "Output"
      : artifactLoading
        ? t("notebook.loadingResults")
        : formatOutputSummary(
            t,
            output,
            locale,
            outputState?.totalRows,
            outputState?.hasNextPage,
          );
  const ranAt = blocked ? undefined : outputState?.ranAt;
  const lastRun = useLastRunLabel(ranAt);
  const failed =
    runState?.status === "failed" || outputState?.status === "error";
  const hasRun =
    failed ||
    runState?.status === "complete" ||
    outputState?.status === "complete" ||
    ranAt !== undefined ||
    shownOutput !== null ||
    hasPythonOutput ||
    hasPythonExports;
  const staleOutput = hasRun && (dirty || staleAcceptedOutput);
  const staleShownOutput = !blocked && shownOutput !== null && staleOutput;
  const runDisabled = runBusy || running || deleting || unknownCancellation;
  const stop = !blocked && running ? onStop : undefined;
  const usesConnection = cellUsesConnection(cell.contents.kind);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea == null) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(44, textarea.scrollHeight + 10)}px`;
  }, [draftText, proseEditing, sourceCollapsed]);

  const sqlEditor = useRef<EditorView | null>(null);
  const closeSqlCompletion = () => {
    if (sqlEditor.current) closeCompletion(sqlEditor.current);
  };
  const run = (mode?: CellRunMode, options?: CellRunOptions) => {
    closeSqlCompletion();
    onRun(mode, options);
  };
  useEffect(() => {
    if (running && sqlEditor.current) closeCompletion(sqlEditor.current);
  }, [running]);

  const handleRunKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.repeat)
      return;
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      if (sqlEditor.current && completionStatus(sqlEditor.current.state)) {
        closeSqlCompletion();
        return;
      }
      articleRef.current?.focus();
      return;
    }
    if (!runnable) return;
    const mode = getCellRunShortcut(event);
    const mod = event.metaKey || event.ctrlKey;
    const enter = event.key === "Enter";
    if (!mode && !(enter && (mod || event.shiftKey || event.altKey))) return;
    event.preventDefault();
    event.stopPropagation();
    if (runDisabled) return;
    if (mode) {
      run(mode);
      return;
    }
    if (mod) {
      const editor = sqlEditor.current;
      const range = editor?.state.selection.main;
      if (
        range &&
        !range.empty &&
        editor.state.sliceDoc(range.from, range.to).trim()
      ) {
        run("cell-only", {
          selection: { from: range.from, to: range.to },
          bypassCache: event.shiftKey,
        });
      } else if (event.shiftKey) {
        run(undefined, { bypassCache: true });
      } else {
        run();
      }
    } else if (canEdit && onRunAndAdvance) {
      closeSqlCompletion();
      onRunAndAdvance(event.altKey);
    } else {
      run();
    }
  };

  const [fullScreen, setFullScreen] = useState(false);
  const [menuNotice, setMenuNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setFullScreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);
  useEffect(() => {
    if (menuNotice == null) return;
    const timer = window.setTimeout(() => setMenuNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [menuNotice]);
  const copyToClipboard = async (
    text: string,
    notice: string,
    toastMessage?: string,
  ) => {
    setMenuOpen(false);
    // Insecure pages have no clipboard even though the type says there is one.
    const write = (navigator.clipboard as Clipboard | undefined)?.writeText(
      text,
    );
    if (write == null) {
      setMenuNotice(t("notebook.cellActions.copyUnavailable"));
      return false;
    }
    try {
      await write;
    } catch {
      setMenuNotice(t("notebook.cellActions.copyFailed"));
      return false;
    }
    setMenuNotice(notice);
    if (toastMessage) toast.success(toastMessage);
    return true;
  };
  const menuKind = cell.contents.kind;
  const canCopyCell =
    menuKind !== "component-import" && menuKind !== "collapsible";
  const canFullScreen =
    canCopyCell && menuKind !== "input" && menuKind !== "metric";
  const cellClipboardText = () =>
    encodeCellForClipboard(
      editableCellText(cell.contents) == null
        ? cell.contents
        : cellContentsWithText(cell.contents, draftText),
    );
  const pastingRef = useRef(false);
  const pasteFromClipboard = async () => {
    setMenuOpen(false);
    if (onPasteCell == null || pastingRef.current) return;
    pastingRef.current = true;
    try {
      let copied: ReturnType<typeof decodeCellFromClipboard>;
      try {
        copied = decodeCellFromClipboard(await navigator.clipboard.readText());
      } catch {
        setMenuNotice(t("notebook.cellActions.copyUnavailable"));
        return;
      }
      if (copied == null) {
        setMenuNotice(t("notebook.cellActions.pasteEmpty"));
        return;
      }
      await onPasteCell(copied);
    } catch {
      setMenuNotice(t("notebook.cellActions.pasteFailed"));
    } finally {
      pastingRef.current = false;
    }
  };

  const canFormat =
    canEdit && cell.contents.kind === "sql" && onFormatSql != null;
  const canSplitCtes =
    canEdit && cell.contents.kind === "sql" && onSaveContents != null;
  const canConvertToMarkdown =
    cell.contents.kind === "text" && canEdit && onSaveContents != null;
  const hasStructureMenuItems =
    onAddAbove != null ||
    onAddBelow != null ||
    onMoveUp != null ||
    onMoveDown != null ||
    sectionDestinationMenu != null;
  const hasAdditionalMenuOptions =
    canConvertToMarkdown || canSplitCtes || canFormat;
  const cteSplit = canSplitCtes ? splitSqlCtes(draftText) : null;
  const [splittingCtes, setSplittingCtes] = useState(false);
  const splitCtes = async () => {
    if (
      !cteSplit ||
      cell.contents.kind !== "sql" ||
      onSaveContents == null ||
      splittingCtes
    )
      return;
    const [first, ...rest] = cteSplit.ctes;
    if (!first) return;
    setSplittingCtes(true);
    try {
      const priorNames: string[] = [first.name];
      onTextChange(first.sql);
      onSaveContents({
        ...cell.contents,
        source: first.sql,
        resultVariable: first.name,
      });
      let afterCellId = cell.id;
      const baseConnectionId = cell.contents.dataConnectionId;
      const steps: Array<{ name?: string; sql: string }> = [
        ...rest,
        { sql: cteSplit.finalSql },
      ];
      for (const step of steps) {
        const refCte = referencedCteName(step.sql, priorNames);
        const created = (await callAction("add-project-cell", {
          projectId: cell.projectId,
          kind: "sql",
          afterCellId,
          ...(step.name ? { name: step.name } : {}),
          ...(refCte
            ? { dataframe: refCte }
            : baseConnectionId
              ? { dataConnectionId: baseConnectionId }
              : {}),
          source: step.sql,
        })) as { createdCellId?: string } | undefined;
        if (created?.createdCellId) afterCellId = created.createdCellId;
        if (step.name) priorNames.push(step.name);
      }
    } catch {
      setMenuNotice(t("notebook.cellActions.splitCtesFailed"));
    } finally {
      setSplittingCtes(false);
    }
  };
  // A formatter result is applied only to the exact text it was computed from,
  // in the cell it was requested for.
  const draftRef = useRef(draftText);
  draftRef.current = draftText;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const cellKeyRef = useRef(`${cell.projectId}:${cell.id}`);
  cellKeyRef.current = `${cell.projectId}:${cell.id}`;
  const formatSql = async () => {
    setMenuOpen(false);
    if (onFormatSql == null) return;
    const requestedText = draftText;
    const requestedCell = cellKeyRef.current;
    try {
      const formatted = await onFormatSql(requestedText);
      if (!mountedRef.current) return;
      if (
        draftRef.current !== requestedText ||
        cellKeyRef.current !== requestedCell
      ) {
        setMenuNotice(t("notebook.cellActions.formatStale"));
        return;
      }
      if (formatted === requestedText) {
        setMenuNotice(t("notebook.cellActions.sqlAlreadyFormatted"));
        return;
      }
      onTextChange(formatted);
      setMenuNotice(t("notebook.cellActions.sqlFormatted"));
    } catch (formatError) {
      if (!mountedRef.current) return;
      setMenuNotice(
        formatError instanceof Error && formatError.message !== ""
          ? formatError.message
          : t("notebook.cellActions.formatFailed"),
      );
    }
  };

  const handleCellCommand = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.repeat
    )
      return;
    const prefix = commandPrefix.current;
    commandPrefix.current = null;
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      notebookLetter(event) === "V" &&
      onPasteCell &&
      !busy &&
      !saving &&
      !deleting
    ) {
      event.preventDefault();
      void pasteFromClipboard();
      return;
    }
    const copyOrCutCommand = (cut: boolean) => {
      if (
        !canCopyCell ||
        (cut &&
          !(canEdit && !running && !deleteBlocked && !saving && !deleting))
      )
        return false;
      event.preventDefault();
      void copyToClipboard(
        cellClipboardText(),
        t("notebook.cellActions.cellCopied"),
        t("notebook.columnNameCopied"),
      ).then((copied) => {
        if (cut && copied) (onCommandDelete ?? onDelete)();
      });
      return true;
    };
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      ["C", "X"].includes(notebookLetter(event))
    ) {
      copyOrCutCommand(notebookLetter(event) === "X");
      return;
    }
    if (event.key === "Enter" && runnable) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod || event.shiftKey || event.altKey) {
        event.preventDefault();
        if (runDisabled) return;
        if (mod) run(undefined, { bypassCache: event.shiftKey });
        else if (canEdit && onRunAndAdvance) onRunAndAdvance(event.altKey);
        else run();
        return;
      }
    }
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey)
      return;
    if (event.key === "Enter" && proseCell && canEdit && !sourceCollapsed) {
      event.preventDefault();
      setProseEditing(true);
      return;
    }
    const key = notebookLetter(event);
    const chord =
      prefix && Date.now() - prefix.at < 1000 ? prefix.key + key : key;
    const insert = insertCommands.find((command) => command.key === key);
    if (!prefix && (key === "C" || key === "X")) {
      copyOrCutCommand(key === "X");
      return;
    }
    if (
      !prefix &&
      key === "M" &&
      cell.contents.kind === "code" &&
      canEdit &&
      onSaveContents != null &&
      !busy &&
      !saving &&
      !deleting
    ) {
      event.preventDefault();
      const {
        language: _language,
        source: _source,
        resultVariable: _resultVariable,
        outputResult: _outputResult,
        ...rest
      } = cell.contents;
      onSaveContents({
        ...rest,
        kind: "markdown",
        markdown: draftText,
      });
      return;
    }
    if (
      !prefix &&
      key === "Y" &&
      cell.contents.kind === "markdown" &&
      canEdit &&
      onSaveContents != null &&
      !busy &&
      !saving &&
      !deleting
    ) {
      event.preventDefault();
      const { markdown: _markdown, ...rest } = cell.contents;
      onSaveContents({
        ...rest,
        kind: "code",
        language: "python",
        source: draftText,
        resultVariable: null,
        outputResult: true,
      });
      return;
    }
    if (insert && onCommandAdd) {
      event.preventDefault();
      onCommandAdd(insert.kind, false);
    } else if (
      key === notebookCommands.addAbove.key ||
      key === notebookCommands.addBelow.key
    ) {
      const above = key === notebookCommands.addAbove.key;
      const add = above ? onAddAbove : onAddBelow;
      if (!add) return;
      event.preventDefault();
      if (onCommandAdd) onCommandAdd(undefined, above);
      else add();
    } else if (
      chord === notebookCommands.deleteCell.key &&
      canEdit &&
      !running &&
      !deleteBlocked &&
      !saving &&
      !deleting
    ) {
      event.preventDefault();
      (onCommandDelete ?? onDelete)();
    } else if (chord === notebookCommands.fullScreen.key) {
      event.preventDefault();
      if (canFullScreen) setFullScreen((current) => !current);
    } else if (
      chord === notebookCommands.formatSql.key &&
      canFormat &&
      !busy &&
      !saving
    ) {
      event.preventDefault();
      void formatSql();
    } else if (
      key === notebookCommands.deleteCell.key[0] ||
      key === notebookCommands.fullScreen.key[0]
    ) {
      event.preventDefault();
      commandPrefix.current = { key, at: Date.now() };
    }
  };

  const resultVariable =
    shownOutput?.type === "table" &&
    cell.contents.kind === "sql" &&
    cell.contents.resultVariable ? (
      <ResultVariable
        name={cell.contents.resultVariable}
        canRename={canEdit && !busy && !dirty && !saving}
        unavailableVariables={unavailableVariables}
        onRename={(name) => {
          if (cell.contents.kind === "sql")
            onSaveContents?.({ ...cell.contents, resultVariable: name });
        }}
        onAdd={onAddResultCell}
      />
    ) : null;

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    handleRunKeyDown(event);
    if (event.defaultPrevented) return;
    if (event.key === "Tab" && !proseCell) {
      event.preventDefault();
      event.stopPropagation();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = `${draftText.slice(0, start)}  ${draftText.slice(end)}`;
      onTextChange(next);
      requestAnimationFrame(() => {
        textarea.selectionStart = start + 2;
        textarea.selectionEnd = start + 2;
      });
    }
  };

  const applyTextFormatting = (
    action: "bold" | "italic" | "heading" | "list" | "code" | "link",
  ) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? draftText.length;
    const end = textarea.selectionEnd ?? draftText.length;
    const selected = draftText.slice(start, end);
    const before = draftText.slice(0, start);
    const after = draftText.slice(end);
    let next = draftText;
    let nextStart = start;
    let nextEnd = end;

    if (action === "bold") {
      const inner = selected || "bold";
      next = `${before}**${inner}**${after}`;
      nextStart = start + 2;
      nextEnd = nextStart + inner.length;
    } else if (action === "italic") {
      const inner = selected || "italic";
      next = `${before}*${inner}*${after}`;
      nextStart = start + 1;
      nextEnd = nextStart + inner.length;
    } else if (action === "code") {
      if (selected.includes("\n")) {
        next = `${before}\`\`\`\n${selected}\n\`\`\`${after}`;
        nextStart = start + 4;
        nextEnd = nextStart + selected.length;
      } else {
        const inner = selected || "code";
        next = `${before}\`${inner}\`${after}`;
        nextStart = start + 1;
        nextEnd = nextStart + inner.length;
      }
    } else if (action === "link") {
      if (selected) {
        next = `${before}[${selected}](https://)${after}`;
        nextStart = start + selected.length + 3;
        nextEnd = nextStart + "https://".length;
      } else {
        const label = "link";
        next = `${before}[${label}](https://)${after}`;
        nextStart = start + 1;
        nextEnd = nextStart + label.length;
      }
    } else if (action === "heading") {
      const lineStart = draftText.lastIndexOf("\n", start - 1) + 1;
      if (draftText.slice(lineStart).startsWith("## ")) {
        next = `${draftText.slice(0, lineStart)}${draftText.slice(lineStart + 3)}`;
        nextStart = Math.max(lineStart, start - 3);
        nextEnd = Math.max(lineStart, end - 3);
      } else {
        next = `${draftText.slice(0, lineStart)}## ${draftText.slice(lineStart)}`;
        nextStart = start + 3;
        nextEnd = end + 3;
      }
    } else if (action === "list") {
      const lineStart = draftText.lastIndexOf("\n", start - 1) + 1;
      if (selected.includes("\n")) {
        const rawLineEnd = draftText.indexOf("\n", end);
        const lineEnd = rawLineEnd === -1 ? draftText.length : rawLineEnd;
        const lines = draftText.slice(lineStart, lineEnd).split("\n");
        const allBulleted = lines.every((line) => line.startsWith("- "));
        const updated = lines
          .map((line) => (allBulleted ? line.slice(2) : `- ${line}`))
          .join("\n");
        next = `${draftText.slice(0, lineStart)}${updated}${draftText.slice(lineEnd)}`;
        nextStart = lineStart;
        nextEnd = lineStart + updated.length;
      } else if (draftText.slice(lineStart).startsWith("- ")) {
        next = `${draftText.slice(0, lineStart)}${draftText.slice(lineStart + 2)}`;
        nextStart = Math.max(lineStart, start - 2);
        nextEnd = Math.max(lineStart, end - 2);
      } else {
        next = `${draftText.slice(0, lineStart)}- ${draftText.slice(lineStart)}`;
        nextStart = start + 2;
        nextEnd = end + 2;
      }
    }

    onTextChange(next);
    requestAnimationFrame(() => {
      if (document.activeElement !== textarea) textarea.focus();
      textarea.selectionStart = nextStart;
      textarea.selectionEnd = nextEnd;
    });
  };

  const textToolbarItems = [
    {
      action: "bold" as const,
      label: t("notebook.textToolbar.bold", { defaultValue: "Bold" }),
      icon: <IconBold size={14} aria-hidden="true" />,
    },
    {
      action: "italic" as const,
      label: t("notebook.textToolbar.italic", { defaultValue: "Italic" }),
      icon: <IconItalic size={14} aria-hidden="true" />,
    },
    {
      action: "heading" as const,
      label: t("notebook.textToolbar.heading", { defaultValue: "Heading" }),
      icon: <IconHeading size={14} aria-hidden="true" />,
    },
    {
      action: "list" as const,
      label: t("notebook.textToolbar.bulletList", {
        defaultValue: "Bullet list",
      }),
      icon: <IconList size={14} aria-hidden="true" />,
    },
    {
      action: "code" as const,
      label: t("notebook.textToolbar.code", { defaultValue: "Code" }),
      icon: <IconCode size={14} aria-hidden="true" />,
    },
    {
      action: "link" as const,
      label: t("notebook.textToolbar.link", { defaultValue: "Link" }),
      icon: <IconLink size={14} aria-hidden="true" />,
    },
  ];

  const sourceEditor = (
    <textarea
      ref={textareaRef}
      className="nb-cell-source"
      aria-label={editCellLabel}
      autoFocus={proseCell && (justAdded || proseEditing)}
      {...(python ? { placeholder: t("notebook.pythonCellPlaceholder") } : {})}
      spellCheck={false}
      value={draftText}
      onChange={(event) => onTextChange(event.target.value)}
      onKeyDown={handleEditorKeyDown}
      onScroll={(event) => {
        if (pythonPaintRef.current)
          pythonPaintRef.current.scrollLeft = event.currentTarget.scrollLeft;
      }}
      onBlur={() => {
        if (proseCell) {
          setProseEditing(false);
          onSaveDraft();
        }
      }}
    />
  );

  return (
    <article
      className={`nb-cell${fullScreen ? " is-fullscreen" : ""}${selected ? " is-selected" : ""}`}
      ref={articleRef}
      data-notebook-cell={cell.id}
      onKeyDown={handleCellCommand}
      onBlur={() => {
        commandPrefix.current = null;
      }}
      tabIndex={-1}
      aria-keyshortcuts={
        canMoveThroughSections
          ? "Control+ArrowLeft Meta+ArrowLeft Control+ArrowRight Meta+ArrowRight"
          : undefined
      }
      style={
        drop.placement == null && !drag.dragging
          ? undefined
          : {
              ...(drag.dragging ? { opacity: 0.5 } : {}),
              ...(drop.placement == null
                ? {}
                : {
                    boxShadow: `0 ${drop.placement === "before" ? "-" : ""}2px 0 0 currentColor`,
                  }),
            }
      }
      {...drop.dropProps}
    >
      {menuNotice != null ? (
        <div role="status" className="nb-cell-notice">
          {menuNotice}
        </div>
      ) : null}
      {fullScreen ? (
        <button
          type="button"
          className="nb-cell-exit-fullscreen"
          onClick={() => setFullScreen(false)}
        >
          {t("notebook.cellActions.exitFullScreen")}
        </button>
      ) : null}
      <div className="nb-cell-legend">
        {renaming && onSaveContents != null ? (
          <input
            className="nb-cell-title-input"
            type="text"
            value={renameDraft}
            maxLength={200}
            aria-label={t(
              inputContents
                ? "notebook.inputVariableName"
                : "notebook.cellTitleLabel",
            )}
            autoFocus
            onChange={(event) => setRenameDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => {
              setRenaming(false);
              if (renameDraft === (inputContents?.name ?? title)) return;
              const name = cellLabelFromInput(renameDraft);
              if (inputContents) {
                if (name === inputContents.name) return;
                if (name === null || !isSqlInputName(name)) {
                  setInvalidRename(true);
                  return;
                }
                onSaveContents({
                  ...inputContents,
                  name,
                  ...(inputContents.label ===
                  inputNameToLabel(inputContents.name)
                    ? { label: inputNameToLabel(name) }
                    : {}),
                });
              } else {
                const currentLabel = cell.contents.label?.trim() || null;
                if (name === currentLabel) return;
                const nextContents =
                  editable && draftText !== editableCellText(cell.contents)
                    ? cellContentsWithText(cell.contents, draftText)
                    : cell.contents;
                onSaveContents({ ...nextContents, label: name });
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                setRenameDraft(inputContents?.name ?? title);
                setRenaming(false);
              }
            }}
          />
        ) : canEdit && onSaveContents != null ? (
          <button
            type="button"
            className="nb-cell-title"
            title={title}
            aria-label={t("notebook.cellMenu.rename") + ": " + title}
            disabled={busy || saving || deleting}
            onClick={startRename}
          >
            {title}
          </button>
        ) : (
          <span className="nb-cell-title" title={title}>
            {title}
          </span>
        )}
      </div>
      <div className="nb-cell-frame">
        <div className="nb-cell-header" onClick={toggleSourceCollapsed}>
          {(usesConnection || (ranAt && lastRun)) && (
            <div
              className="nb-cell-meta"
              onClick={(event) => event.stopPropagation()}
            >
              {usesConnection && (
                <ConnectionPicker
                  connections={connections}
                  importedConnectionIds={importedConnectionIds}
                  addConnectionHref={addConnectionHref}
                  value={connectionId}
                  loading={connectionsLoading}
                  error={connectionsError}
                  selectionStatus={selectionStatus}
                  pending={connectionPending}
                  disabled={!canEdit}
                  onSelect={onSelectConnection}
                />
              )}
              {ranAt && lastRun ? (
                <time
                  className="nb-cell-last-run"
                  dateTime={ranAt}
                  title={t("notebook.lastRunTooltip", { when: lastRun })}
                >
                  {lastRun}
                </time>
              ) : null}
            </div>
          )}
          {saving ? null : stale ? (
            <span className="nb-cell-status">
              <span className="nb-tag nb-tag-warning">Changed elsewhere</span>
              <button
                type="button"
                className="nb-text-button"
                disabled={busy || saving}
                onClick={(event) => {
                  event.stopPropagation();
                  onDiscard();
                }}
              >
                Discard edits
              </button>
              <button
                type="button"
                className="nb-text-button"
                disabled={busy || saving}
                onClick={(event) => {
                  event.stopPropagation();
                  onOverwrite();
                }}
              >
                Overwrite
              </button>
            </span>
          ) : dirty ? (
            <span className="nb-cell-status">
              <span className="nb-tag" title="Run cell to save edits">
                Unsaved
              </span>
              <button
                type="button"
                className="nb-icon-button"
                aria-label={`Discard edits to ${title}`}
                title="Discard edits"
                disabled={busy || saving}
                onClick={(event) => {
                  event.stopPropagation();
                  onDiscard();
                }}
              >
                <IconArrowBackUp size={14} aria-hidden="true" />
              </button>
            </span>
          ) : null}
        </div>

        {sourceCollapsed ? (
          <CollapsedCellPlaceholder
            label={t("notebook.codeCollapsed")}
            onExpand={toggleSourceCollapsed}
          />
        ) : (
          <div id={bodyId}>
            {isRenderableInput(cell.contents) ? (
              <InputCellControl
                contents={cell.contents}
                projectId={cell.projectId}
                updatedAt={cell.updatedAt}
                dataframes={dataframes}
                value={draftText}
                disabled={!canEdit}
                onChange={onTextChange}
                onCommit={onSaveDraft}
                onChangeContents={canEdit ? onSaveContents : undefined}
              />
            ) : chartContents != null ? (
              usesCompleteChart(
                chartContents.chartSpec,
                chartContents.dataframe,
                dataframes,
              ) ? (
                <CompleteChartEditor
                  context={{
                    projectId: cell.projectId,
                    cellId: cell.id,
                    versionId: cell.versionId,
                  }}
                  dataframe={chartContents.dataframe}
                  spec={chartContents.chartSpec}
                  dataframes={dataframes}
                  disabled={saving || !canEdit}
                  onChange={canEdit ? saveChartSettings : undefined}
                />
              ) : (
                <ChartConfigBody
                  dataframe={chartContents.dataframe}
                  spec={chartContents.chartSpec}
                  dataframes={dataframes}
                  output={output?.type === "chart" ? output : null}
                  disabled={saving}
                  onChange={saveChartSettings}
                />
              )
            ) : cell.contents.kind === "vega-chart" ? (
              cell.contents.spec ? (
                <VegaSpecChart spec={cell.contents.spec} />
              ) : null
            ) : cell.contents.kind === "pivot" ? (
              <PivotCell
                cell={cell}
                contents={cell.contents}
                canEdit={canEdit && !saving}
                sourceResultId={visualizationSourceResultId}
              />
            ) : cell.contents.kind === "metric" &&
              cell.contents.metricConfig ? (
              <MetricCell
                cell={cell}
                contents={cell.contents}
                config={cell.contents.metricConfig}
                canEdit={canEdit && !saving}
                sourceResultId={visualizationSourceResultId}
                namedValues={metricTitleValues}
              />
            ) : cell.contents.kind === "display-table" &&
              cell.contents.tableConfig ? (
              <TableCell
                cell={cell}
                config={cell.contents.tableConfig}
                canEdit={canEdit && !saving}
                sourceResultId={visualizationSourceResultId}
              />
            ) : cell.contents.kind === "dbt-metric" ? (
              <DbtMetricCell
                cell={cell}
                contents={cell.contents}
                canEdit={canEdit && !saving}
                connections={connections}
                onSaveContents={onSaveContents}
                onDuplicateAsSql={canEdit ? onDuplicateMetricAsSql : undefined}
              />
            ) : cell.contents.kind === "component-import" ? (
              <ComponentImportBody
                componentId={cell.contents.componentVersionId}
                title={cell.contents.title}
                onChoose={
                  onSaveContents == null || !canEdit
                    ? undefined
                    : (componentId, name) =>
                        onSaveContents({
                          ...cell.contents,
                          componentVersionId: componentId,
                          title: name,
                        } as Cell["contents"])
                }
              />
            ) : proseCell &&
              (!canEdit ||
                (cell.contents.kind === "markdown" && !proseEditing)) ? (
              <div
                className="nb-md-body"
                data-editable={canEdit}
                onClick={
                  canEdit
                    ? (event) => {
                        if (
                          event.target instanceof Element &&
                          event.target.closest("a, button")
                        )
                          return;
                        setProseEditing(true);
                      }
                    : undefined
                }
              >
                <MarkdownCellView markdown={draftText} />
                {canEdit ? (
                  <button
                    type="button"
                    className="nb-md-edit"
                    aria-label={editCellLabel}
                    onClick={() => setProseEditing(true)}
                  >
                    {t("notebook.markdownCell.edit")}
                  </button>
                ) : null}
              </div>
            ) : cell.contents.kind === "sql" && canEdit ? (
              <>
                {!mounted && <pre className="nb-cell-source">{draftText}</pre>}
                <CodeMirror
                  className="nb-sql-editor"
                  value={draftText}
                  onChange={onTextChange}
                  onBlur={() => onSaveDraft?.()}
                  onCreateEditor={(view) => {
                    sqlEditor.current = view;
                  }}
                  onKeyDownCapture={handleRunKeyDown}
                  extensions={[
                    ...(vim ? [vimExtension()] : []),
                    sql(
                      dataframeSchema ? { schema: dataframeSchema } : undefined,
                    ),
                    EditorView.contentAttributes.of({
                      "aria-label": `Edit ${title}`,
                      spellcheck: "false",
                    }),
                  ]}
                  basicSetup={{ lineNumbers, foldGutter: true }}
                />
                {!draftText && onUseAi && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    {t("notebook.reviewSqlPlaceholder")}{" "}
                    <button
                      type="button"
                      className="nb-inline-link"
                      onClick={onUseAi}
                    >
                      {t("notebook.reviewUseAi")}
                    </button>
                    {"... "}
                    {t("notebook.reviewSqlHelp")}{" "}
                    <button
                      type="button"
                      className="nb-inline-link"
                      onClick={() => onTextChange("SELECT 1 AS result")}
                    >
                      {t("notebook.reviewUseExample")}
                    </button>
                  </div>
                )}
              </>
            ) : editable ? (
              canEdit ? (
                <>
                  {cell.contents.kind === "text" ? (
                    <div
                      role="toolbar"
                      aria-label={t("notebook.textToolbar.label", {
                        defaultValue: "Text formatting",
                      })}
                      className="flex flex-wrap items-center gap-0.5 border-b border-[var(--ws-border)] px-2 py-1"
                    >
                      {textToolbarItems.map((item) => (
                        <button
                          key={item.action}
                          type="button"
                          className="nb-icon-button"
                          aria-label={item.label}
                          title={item.label}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => applyTextFormatting(item.action)}
                        >
                          {item.icon}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="nb-editor-source">
                    {lineNumbers ? (
                      <div className="nb-line-numbers" aria-hidden="true">
                        {draftText.split("\n").map((_, index) => (
                          <div key={index}>{index + 1}</div>
                        ))}
                      </div>
                    ) : null}
                    {python ? (
                      <div className="nb-python-source">
                        <PythonSourceHighlight
                          source={draftText}
                          paintRef={pythonPaintRef}
                        />
                        {sourceEditor}
                      </div>
                    ) : (
                      sourceEditor
                    )}
                  </div>
                </>
              ) : python ? (
                <PythonSourceHighlight source={draftText} />
              ) : (
                <pre className="nb-cell-source is-readonly">{draftText}</pre>
              )
            ) : (
              <pre className="nb-cell-summary">
                {describeCell(t, cell.contents)}
              </pre>
            )}
            {showInputNameError && (
              <div className="nb-banner nb-banner-danger" role="alert">
                <p className="nb-banner-message">
                  {t("notebook.inputNameInvalid")}
                </p>
              </div>
            )}
            {error != null && (
              <div className="nb-banner nb-banner-danger" role="alert">
                <p className="nb-banner-message">{error.message}</p>
                {error.details != null && (
                  <details className="nb-banner-details">
                    <summary>{t("notebook.errorDetails")}</summary>
                    <pre>{error.details}</pre>
                  </details>
                )}
                <div className="nb-banner-actions">
                  {onRetryError ? (
                    <button
                      type="button"
                      className="nb-text-button"
                      disabled={busy || saving}
                      onClick={onRetryError}
                    >
                      Retry
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="nb-text-button"
                    disabled={busy || saving}
                    onClick={onDismissError}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {blocked && (
          <div className="nb-banner nb-run-blocked" role="status">
            <IconAlertTriangle size={14} aria-hidden="true" />
            <p className="nb-banner-message">
              {t("notebook.cancelledUpstream")}
            </p>
          </div>
        )}
        {hasOutput && (
          <section
            className={
              hasPythonOutput
                ? "nb-output-section nb-python-result"
                : "nb-output-section"
            }
          >
            {canCollapseOutput && (
              <Tooltip
                content={outputCollapsed ? expandLabel : collapseLabel}
                delayMs={1000}
                placement="bottom"
                trigger={
                  <button
                    type="button"
                    className={
                      hasPythonOutput
                        ? "nb-icon-button nb-python-result-toggle"
                        : "nb-output-header"
                    }
                    aria-controls={outputCollapsed ? undefined : outputId}
                    aria-expanded={!outputCollapsed}
                    aria-label={outputCollapsed ? expandLabel : collapseLabel}
                    onClick={toggleOutputCollapsed}
                  >
                    {outputCollapsed ? (
                      <IconChevronRight size={14} aria-hidden="true" />
                    ) : (
                      <IconChevronDown size={14} aria-hidden="true" />
                    )}
                    {!hasPythonOutput && (
                      <>
                        <span className="nb-output-title">{summary}</span>
                        {staleShownOutput && (
                          <span className="nb-output-stale">
                            {t("notebook.staleOutput")}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                }
              />
            )}
            {outputCollapsed ? (
              <CollapsedCellPlaceholder
                label={t("notebook.resultCollapsed")}
                onExpand={toggleOutputCollapsed}
              />
            ) : (
              <div id={outputId}>
                {hasPythonOutput ? (
                  <PythonCellOutput
                    projectId={cell.projectId}
                    cellId={cell.id}
                    outputs={pythonOutputs}
                    statusMessage={outputError ?? undefined}
                    canRepair={canEdit}
                    running={runLoading}
                    stale={staleOutput}
                    ranAt={ranAt}
                    onLoadPage={onLoadPythonPage}
                    onSelectLine={(line) => {
                      const source = textareaRef.current;
                      if (!source) return;
                      const lines = draftText.split("\n");
                      const start = lines
                        .slice(0, line - 1)
                        .reduce((count, value) => count + value.length + 1, 0);
                      source.focus();
                      source.setSelectionRange(
                        start,
                        start + (lines[line - 1]?.length ?? 0),
                      );
                    }}
                  />
                ) : artifactLoading && shownOutput === null ? (
                  <div
                    className="space-y-2 p-3"
                    role="status"
                    aria-label={t("notebook.loadingResults")}
                  >
                    <Skeleton className="h-7 w-full" />
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-full" />
                  </div>
                ) : (
                  <CellOutputView
                    output={shownOutput}
                    allowCsvDownload
                    downloadLabel={
                      cell.contents.kind === "sql"
                        ? cell.contents.resultVariable
                        : undefined
                    }
                    queryTableControls={cell.contents.kind === "sql"}
                    resultVariable={resultVariable}
                    onAddChartCell={
                      onAddResultCell &&
                      shownOutput?.type === "table" &&
                      cell.contents.kind === "sql" &&
                      cell.contents.resultVariable
                        ? () =>
                            onAddResultCell(
                              "chart",
                              cell.contents.kind === "sql"
                                ? (cell.contents.resultVariable ?? "")
                                : "",
                            )
                        : undefined
                    }
                    pageStorageKey={
                      outputState?.artifactPage === undefined
                        ? `notebook:result-page:${cell.projectId}:${cell.id}`
                        : undefined
                    }
                    artifactPage={outputState?.artifactPage}
                    onFixWithAgent={onFixWithAgent}
                    queryError={queryError}
                    loading={runLoading}
                    onRetry={
                      outputState?.artifactError
                        ? outputState.artifactRetry
                        : runnable
                          ? () => run()
                          : undefined
                    }
                    hasNextPage={outputState?.hasNextPage}
                    totalRows={outputState?.totalRows ?? null}
                    onLoadRows={
                      outputState?.artifactPage === undefined
                        ? onLoadResultRows
                        : undefined
                    }
                    onLoadPage={onLoadResultPage}
                    queryRequestId={outputState?.pageRequestId}
                  />
                )}
              </div>
            )}
          </section>
        )}
        {outputState?.snippetOutput && !blocked && (
          <section
            aria-label={t("notebook.runSelectionOutput")}
            className="nb-output-section"
          >
            <CellOutputView output={outputState.snippetOutput} />
          </section>
        )}
        {resultVariable && (!hasOutput || outputCollapsed) ? (
          <div className="nb-result-footer">{resultVariable}</div>
        ) : null}
      </div>
      {outputEnabled && hasPythonExports && (
        <PythonCellExports exports={pythonExports} />
      )}
      <div className="nb-cell-gutter">
        {canDrag ? (
          <Tooltip
            content={t("dashboards.panel.drag")}
            delayMs={1000}
            placement="bottom"
            trigger={
              <span
                role="img"
                className="nb-icon-button nb-drag-handle"
                aria-label={t("dashboards.panel.drag")}
                {...drag.gripProps}
              >
                <IconGripVertical size={14} aria-hidden="true" />
              </span>
            }
          />
        ) : null}
        <Tooltip
          content={sourceCollapsed ? expandLabel : collapseLabel}
          delayMs={1000}
          placement="bottom"
          trigger={
            <button
              type="button"
              className="nb-icon-button nb-collapse-button"
              aria-controls={sourceCollapsed ? undefined : bodyId}
              aria-expanded={!sourceCollapsed}
              aria-label={sourceCollapsed ? expandLabel : collapseLabel}
              onClick={toggleSourceCollapsed}
            >
              {sourceCollapsed ? (
                <IconChevronRight size={14} aria-hidden="true" />
              ) : (
                <IconChevronDown size={14} aria-hidden="true" />
              )}
            </button>
          }
        />
      </div>
      <div className="nb-cell-actions">
        {(runnable || stop) && (
          <div className="nb-cell-run-split">
            {stop ? (
              <button
                type="button"
                className="nb-icon-button nb-run-button"
                aria-label={
                  stopping
                    ? t("queryError.cancelling")
                    : t("runsTray.stopRun", { title })
                }
                title={
                  stopping
                    ? t("queryError.cancelling")
                    : t("runsTray.stopRun", { title })
                }
                disabled={stopping || !stopAvailable}
                aria-busy={stopping}
                onClick={stop}
              >
                {stopping ? (
                  <span className="nb-spinner" aria-hidden="true" />
                ) : (
                  <IconPlayerStopFilled size={14} aria-hidden="true" />
                )}
              </button>
            ) : (
              runnable && (
                <CellRunButton
                  title={title}
                  mode={runMode}
                  stale={staleOutput}
                  blocked={blocked}
                  failed={failed}
                  disabledReason={
                    unknownCancellation
                      ? t("queryError.cancelUnknown")
                      : undefined
                  }
                  disabled={runDisabled}
                  busy={saving || runLoading}
                  onRun={() => run()}
                />
              )
            )}
            {runnable && !stop && (
              <CellRunActions
                disabled={runDisabled}
                ranAt={ranAt}
                durationMs={blocked ? null : outputState?.durationMs}
                onRun={run}
              />
            )}
          </div>
        )}
        {canEdit && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="nb-icon-button"
                aria-label={t("notebook.moreCellActions", {
                  title,
                  defaultValue: "More actions for {{title}}",
                })}
                aria-haspopup="menu"
                disabled={running || deleteBlocked || saving || deleting}
                onClick={(event) => {
                  if (event.detail === 0) setMenuOpen((open) => !open);
                }}
              >
                <IconDots size={14} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="nb-popover nb-menu-list"
              sideOffset={4}
              style={{ padding: 0, width: "auto", minWidth: 180 }}
              aria-label={t("notebook.cellMenu.actions", { title })}
              onCloseAutoFocus={(event) => {
                if (skipMenuFocusRestore.current) event.preventDefault();
                skipMenuFocusRestore.current = false;
              }}
            >
              {onAddAbove != null ? (
                <CellMenuItem
                  icon={<IconRowInsertTop size={14} aria-hidden="true" />}
                  shortcut={notebookCommands.addAbove.key}
                  disabled={busy || saving || deleting}
                  onSelect={() => {
                    skipMenuFocusRestore.current = true;
                    onAddAbove();
                  }}
                >
                  {t("notebook.cellMenu.addAbove")}
                </CellMenuItem>
              ) : null}
              {onAddBelow != null ? (
                <CellMenuItem
                  icon={<IconRowInsertBottom size={14} aria-hidden="true" />}
                  shortcut={notebookCommands.addBelow.key}
                  disabled={busy || saving || deleting}
                  onSelect={() => {
                    skipMenuFocusRestore.current = true;
                    onAddBelow();
                  }}
                >
                  {t("notebook.cellMenu.addBelow")}
                </CellMenuItem>
              ) : null}
              {onMoveUp != null ? (
                <CellMenuItem
                  icon={<IconArrowUp size={14} aria-hidden="true" />}
                  shortcut="⌘↑"
                  disabled={busy || saving || deleting}
                  onSelect={onMoveUp}
                >
                  {t("notebook.cellMenu.moveUp")}
                </CellMenuItem>
              ) : null}
              {onMoveDown != null ? (
                <CellMenuItem
                  icon={<IconArrowDown size={14} aria-hidden="true" />}
                  shortcut="⌘↓"
                  disabled={busy || saving || deleting}
                  onSelect={onMoveDown}
                >
                  {t("notebook.cellMenu.moveDown")}
                </CellMenuItem>
              ) : null}
              {sectionDestinationMenu}
              {hasStructureMenuItems ? <CellMenuDivider /> : null}
              {onDuplicateCell != null && canCopyCell ? (
                <CellMenuItem
                  icon={<IconCopy size={14} aria-hidden="true" />}
                  disabled={busy || saving || deleting}
                  onSelect={onDuplicateCell}
                >
                  {t("notebook.cellMenu.duplicateAction")}
                </CellMenuItem>
              ) : null}
              {canCopyCell && onSelectRelated != null ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="nb-menu-item">
                    <IconListTree size={14} aria-hidden="true" />
                    {t("notebook.cellActions.selectCellAnd")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="nb-popover nb-menu-list">
                    {(
                      [
                        ["upstream", "selectUpstream"],
                        ["downstream", "selectDownstream"],
                        ["both", "selectBoth"],
                      ] as const
                    ).map(([relation, key]) => (
                      <CellMenuItem
                        key={relation}
                        onSelect={() => {
                          skipMenuFocusRestore.current = true;
                          onSelectRelated(relation);
                        }}
                      >
                        {t(`notebook.cellActions.${key}`)}
                      </CellMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              {canCopyCell && onNewComponent != null ? (
                <CellMenuItem
                  icon={<IconPuzzle size={14} aria-hidden="true" />}
                  onSelect={onNewComponent}
                >
                  {t("notebook.cellActions.newComponent")}
                </CellMenuItem>
              ) : null}
              {canCopyCell ? (
                <CellMenuItem
                  icon={<IconClipboard size={14} aria-hidden="true" />}
                  onSelect={() =>
                    copyToClipboard(
                      cellClipboardText(),
                      t("notebook.cellActions.cellCopied"),
                    )
                  }
                >
                  {t("notebook.cellActions.copyCell")}
                </CellMenuItem>
              ) : null}
              {canCopyCell ? <CellMenuDivider /> : null}
              {canCopyCell ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="nb-menu-item">
                    <IconLink size={14} aria-hidden="true" />
                    {t("notebook.cellActions.copyLink")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="nb-popover nb-menu-list">
                    {(["notebook", "app"] as const).map((target) => {
                      const enabled = target === "notebook" || hasPublishedApp;
                      return (
                        <CellMenuItem
                          key={target}
                          disabled={!enabled}
                          title={
                            enabled
                              ? undefined
                              : t("notebook.cellActions.copyLinkAppUnavailable")
                          }
                          onSelect={() =>
                            copyToClipboard(
                              cellLinkHref(window.location, {
                                projectId: cell.projectId,
                                cellId: cell.id,
                                target,
                              }),
                              t("notebook.cellActions.linkCopied"),
                            )
                          }
                        >
                          {t(
                            target === "notebook"
                              ? "notebook.cellActions.copyLinkNotebook"
                              : "notebook.cellActions.copyLinkApp",
                          )}
                        </CellMenuItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <CellMenuItem
                  icon={<IconLink size={14} aria-hidden="true" />}
                  onSelect={() =>
                    copyToClipboard(
                      cellLinkHref(window.location, {
                        projectId: cell.projectId,
                        cellId: cell.id,
                        target: "notebook",
                      }),
                      t("notebook.cellActions.linkCopied"),
                    )
                  }
                >
                  {t("notebook.cellActions.copyLink")}
                </CellMenuItem>
              )}
              {canCopyCell && onEmbed != null ? (
                <CellMenuItem
                  icon={<IconCode size={14} aria-hidden="true" />}
                  disabled={!hasPublishedApp}
                  title={
                    hasPublishedApp
                      ? undefined
                      : t("notebook.cellActions.embedUnavailable")
                  }
                  onSelect={onEmbed}
                >
                  {t("notebook.cellActions.embed")}
                </CellMenuItem>
              ) : null}
              {canFullScreen ? (
                <CellMenuItem
                  icon={<IconArrowsMaximize size={14} aria-hidden="true" />}
                  shortcut={notebookCommands.fullScreen.key}
                  onSelect={() => setFullScreen(true)}
                >
                  {t("notebook.cellActions.fullScreen")}
                </CellMenuItem>
              ) : null}
              {hasAdditionalMenuOptions ? <CellMenuDivider /> : null}
              {canConvertToMarkdown ? (
                <CellMenuItem
                  icon={<IconMarkdown size={14} aria-hidden="true" />}
                  disabled={busy || saving || deleting}
                  onSelect={() => {
                    if (cell.contents.kind !== "text") return;
                    const { text: _text, ...rest } = cell.contents;
                    onSaveContents({
                      ...rest,
                      kind: "markdown",
                      markdown: draftText,
                    });
                  }}
                >
                  {t("notebook.cellMenu.convertToMarkdown")}
                </CellMenuItem>
              ) : null}
              {canSplitCtes ? (
                <CellMenuItem
                  icon={<IconCut size={14} aria-hidden="true" />}
                  disabled={
                    !cteSplit || busy || saving || deleting || splittingCtes
                  }
                  onSelect={() => void splitCtes()}
                >
                  {t("notebook.cellActions.splitCtes")}
                </CellMenuItem>
              ) : null}
              {canFormat ? (
                <CellMenuItem
                  icon={<IconCode size={14} aria-hidden="true" />}
                  shortcut={notebookCommands.formatSql.key}
                  disabled={busy || saving || deleting}
                  onSelect={() => void formatSql()}
                >
                  {t("notebook.cellActions.formatSql")}
                </CellMenuItem>
              ) : null}
              {/* The reference separates its destructive item from the rest of
                  the menu with a divider, so a destructive click is never next
                  to an ordinary one. */}
              <CellMenuDivider />
              <CellMenuItem
                className="is-danger"
                icon={<IconTrash size={14} aria-hidden="true" />}
                shortcut={notebookCommands.deleteCell.key.split("").join(" ")}
                disabled={running || deleteBlocked || saving || deleting}
                onSelect={onCommandDelete ?? onDelete}
              >
                {t(notebookCommands.deleteCell.labelKey)}
              </CellMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </article>
  );
}

function CellMenuDivider() {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className="nb-menu-divider"
    />
  );
}

function CellMenuItem({
  icon,
  shortcut,
  className,
  disabled,
  title,
  onSelect,
  children,
}: {
  icon?: React.ReactNode;
  shortcut?: string;
  className?: string;
  disabled?: boolean;
  title?: string | undefined;
  onSelect: () => void;
  children: string;
}) {
  return (
    <DropdownMenuItem
      className={
        className == null ? "nb-menu-item" : `nb-menu-item ${className}`
      }
      {...(shortcut == null
        ? {}
        : {
            "data-shortcut": `ESC then ${shortcut}`,
            "aria-label": children,
          })}
      {...(title == null ? {} : { title })}
      disabled={disabled === true}
      onSelect={onSelect}
    >
      {icon}
      {children}
    </DropdownMenuItem>
  );
}

function ResultVariable({
  name,
  canRename,
  unavailableVariables,
  onRename,
  onAdd,
}: {
  name: string;
  canRename: boolean;
  unavailableVariables: readonly string[];
  onRename: (name: string) => void;
  onAdd: ((kind: "sql" | "chart" | "pivot", name: string) => void) | undefined;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const renameError =
    editing === null || editing === name
      ? null
      : !isSqlInputName(editing)
        ? t("notebook.resultVariableInvalid")
        : unavailableVariables.some(
              (variable) => variable.toLowerCase() === editing.toLowerCase(),
            )
          ? t("notebook.resultVariableTaken")
          : null;
  const renameErrorId = useId();
  return (
    <div className="nb-result-variable">
      {editing === null ? (
        <button
          type="button"
          className="nb-result-variable-name"
          disabled={!canRename}
          onClick={() => setEditing(name)}
          onContextMenu={(event) => {
            if (!onAdd) return;
            event.preventDefault();
            setMenuOpen(true);
          }}
        >
          {name}
        </button>
      ) : (
        <input
          className="nb-result-variable-name"
          value={editing}
          autoFocus
          aria-label={t("notebook.resultVariable")}
          aria-invalid={renameError !== null}
          aria-describedby={renameError === null ? undefined : renameErrorId}
          onBlur={() => setEditing(null)}
          onChange={(event) => setEditing(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setEditing(null);
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (renameError !== null) return;
              if (editing !== name) onRename(editing);
              setEditing(null);
            }
          }}
        />
      )}
      {renameError && (
        <span id={renameErrorId} role="alert">
          {renameError}
        </span>
      )}
      {onAdd && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="nb-result-variable-name"
              aria-label={t("notebook.resultActions", { name })}
            >
              <IconChevronDown size={12} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t("notebook.addResultCell")}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onAdd("sql", name)}>
              {t("notebook.queryWithSql")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd("pivot", name)}>
              {t("pivot.pivotDataframe")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd("chart", name)}>
              {t("notebook.visualizeInChart")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
