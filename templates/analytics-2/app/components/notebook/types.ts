import type { ReactNode } from "react";

import type { CellKind, ParameterInputType } from "@/lib/model/cell-types";
import type {
  CellContents,
  CellOutput,
  ProjectDocument,
  RunStatus,
} from "@/lib/model/contracts";

import type { ResultField } from "../../../shared/notebook-result-contract";
import type { VisualizationPageInput } from "../../../shared/visualization-contracts";
import type {
  NotebookRunController,
  PythonExport,
  PythonOutput,
} from "./useNotebookRun";

type TableOutput = Extract<CellOutput, { type: "table" }>;
export type NotebookTableOutput = Omit<TableOutput, "columns"> & {
  columns: (TableOutput["columns"][number] & {
    schemaType?: ResultField["type"];
  })[];
};

/** A connection the editor may select for a SQL cell. */
export interface NotebookConnection {
  id: string;
  name: string;
  isDefault?: boolean;
  /** Provider/type label shown under the name in the picker. */
  type?: string;
  description?: string | null;
}

/**
 * The latest supplied run for a cell, keyed by cell id.
 *
 * `status` is optional so a caller that only has a finished output can pass
 * `{ output }`; the editor treats that as complete.
 */
export interface NotebookCellOutputState {
  status?: RunStatus;
  recoveryRequired?: boolean;
  output?: CellOutput | null;
  /** Run-level error text, shown in the output area with Retry. */
  error?: string | null;
  durationMs?: number | null;
  ranAt?: string;
  /** Persisted query state for result pagination. */
  hasNextPage?: boolean;
  totalRows?: string | null;
  pageRequestId?: string;
  artifactPage?: number;
  artifactLoading?: boolean;
  artifactError?: boolean;
  artifactRetry?: () => void;
  snippetOutput?: CellOutput | null;
  resultFields?: readonly ResultField[];
  pythonOutputs?: readonly PythonOutput[];
  exports?: readonly PythonExport[];
}

export type LoadResultPage = (
  offset: number,
  requestId: string,
) => Promise<Extract<CellOutput, { type: "table" }>["rows"]>;

export type LoadResultRows = (
  requiredRowCount: number,
) => Promise<number | null>;

export type LoadPythonPage = (
  resultId: string,
  rowOffset: number,
) => ReturnType<LoadResultPage>;

export type NotebookOutputs = Readonly<
  Record<string, NotebookCellOutputState | undefined>
>;

export type VisualizationViewScope = Pick<
  VisualizationPageInput,
  "releaseId" | "sessionId" | "previewId"
>;

/** An error raised by one of the injected action callbacks. */
export interface NotebookActionError {
  message: string;
  details?: string | null;
}

export type NotebookProjectView =
  | "agent"
  | "notebook"
  | "app"
  | "source"
  | "graph"
  | "run-stats";

/** Extra choices a new cell needs beyond its kind. */
export type AddCellOptions = {
  inputType?: ParameterInputType;
  name?: string;
  beforeCellId?: string;
  parentSectionId?: string | null;
  dataframe?: string;
  componentVersionId?: string;
  /** SQL cells only: the initial query and the connection it runs on. */
  source?: string;
  dataConnectionId?: string;
};

export type SectionConfig = Extract<
  import("../../../shared/notebook-operations").NotebookSectionChange,
  { type: "set-section" }
>["config"];

export type SectionChange =
  | { type: "group-section"; cellId: string; cellIds: string[] }
  | {
      type: "move-to-section";
      cellId: string;
      cellIds: string[];
      parentSectionId: string | null;
      beforeCellId?: string;
    }
  | { type: "remove-section"; cellId: string; mode: "eject" | "delete" }
  | { type: "set-section"; cellId: string; config: SectionConfig };

export type NotebookToolRailItem =
  | "data-browser"
  | "toc"
  | "find"
  | "help"
  | "variables"
  | "components"
  | "environment"
  | "collections"
  | "files"
  | "schedules"
  | "history";

export interface NotebookRecentDataset {
  id: string;
  name: string;
}

/** Source empty-project data and actions. Missing data stays empty, never faked. */
export interface NotebookEmptyState {
  connectionName?: string;
  recentDatasets?: readonly NotebookRecentDataset[];
  favoriteDatasets?: readonly NotebookRecentDataset[];
  onSelectConnection?: () => Promise<void> | void;
  onOpenDataset?: (id: string) => Promise<void> | void;
  onBrowseAllData?: () => Promise<void> | void;
  onSearchData?: () => Promise<void> | void;
  onUploadCsv?: () => Promise<void> | void;
  onAskDataQuestion?: (question: string) => Promise<void> | void;
  onAddDescription?: () => Promise<void> | void;
  onAddStatus?: () => Promise<void> | void;
  onAddCategories?: () => Promise<void> | void;
}

export interface ProjectEditorProps {
  isVersionPreview?: boolean;
  appLayout?: ReturnType<typeof import("./useAppLayout").useAppLayout>;
  recoveryNotice?: ReactNode;
  onPreviewVersion?: (
    version: import("@/lib/model/project-version-contracts").ProjectVersion,
    observedHead: import("../../../shared/notebook-snapshot-contract").DraftHead,
  ) => Promise<void>;
  focusTitle?: boolean | undefined;
  untitledOrdinal?: number | null | undefined;
  project: ProjectDocument;
  connections: readonly NotebookConnection[];
  addConnectionHref?: string | undefined;

  onRename: (title: string) => Promise<void>;
  onSaveCell: (
    cellId: string,
    contents: CellContents,
    expectedUpdatedAt?: string,
    inputOptionsResultId?: string,
    suppressReactiveRun?: boolean,
  ) => Promise<string | void>;
  review?: import("./useNotebookReview").NotebookReview | undefined;
  onLeaveReview?: (() => void) | undefined;
  onSelectCell?:
    | ((
        selection: import("../agent/WorkspaceAgent").NotebookCellSelection,
      ) => void)
    | undefined;
  onFixWithAgent?: ((cellId: string, attemptId: string) => void) | undefined;
  onUseAi?:
    | ((
        cell: import("../agent/WorkspaceAgent").NotebookCellSelection,
        connection?: string,
      ) => void)
    | undefined;
  /** Saves the project's own description, shown under its title. */
  onSaveDescription?: (description: string) => Promise<void>;
  /** Clears every saved cell output; the cells and sources stay. */
  onClearOutputs?: () => Promise<void>;
  /** Copies the project and opens the copy, as the options menu's Duplicate. */
  onDuplicate?: () => Promise<void>;
  onAddCell: (
    kind: CellKind,
    afterCellId?: string,
    options?: AddCellOptions,
  ) => Promise<string>;
  onQueryTable?: (
    table: import("@/lib/model/data-table-contracts").GetDataTableDetailsInput,
  ) => Promise<string | undefined>;
  onDeleteCell: (cellId: string) => Promise<void>;
  /** Copies a cell directly after itself; absent when the caller cannot. */
  onDuplicateCell?: (cellId: string) => Promise<void>;
  /** Pastes a copied cell's contents after the given cell. */
  onPasteCell?: (
    afterCellId: string,
    contents: Omit<CellContents, "id" | "order">,
  ) => Promise<void>;
  /** Saves the given cells as a named component; rejects with a readable reason. */
  onCreateComponent?: (
    name: string,
    cellIds: readonly string[],
  ) => Promise<{ omittedOutputs?: number } | void>;
  /** Moves a cell one place up or down; absent when the caller cannot. */
  onMoveCell?: (cellId: string, direction: "up" | "down") => Promise<void>;
  /** Moves a cell directly before or after another, in one write; absent when the caller cannot. */
  onMoveCellTo?: (
    cellId: string,
    target: { cellId: string; placement: "before" | "after" },
  ) => Promise<void>;
  onSectionChange?: ((change: SectionChange) => Promise<void>) | undefined;
  onUndoCellEdit?: (redo: boolean) => Promise<void>;
  execution?: Omit<
    NotebookRunController,
    | "refresh"
    | "refreshSnapshot"
    | "observeAdmission"
    | "snippetAttempt"
    | "clearSelection"
    | "session"
    | "restarting"
    | "restart"
    | "browser"
  > &
    Partial<
      Pick<
        NotebookRunController,
        "session" | "restarting" | "restart" | "observeAdmission" | "browser"
      >
    >;
  onRunCell?: (cellId: string) => Promise<boolean | void>;
  onSelectConnection: (
    cellId: string,
    connectionId: string | null,
  ) => Promise<string | void>;
  linkedConnectionIds?: readonly string[] | undefined;
  onImportConnection?: (connectionId: string) => Promise<void>;

  /** Latest supplied run/output per cell id. Missing means no output yet. */
  outputs?: NotebookOutputs;
  /** Notebook document load in progress. */
  loading?: boolean;
  /** Notebook document load failure. */
  error?: string | null;
  onRetryLoad?: () => Promise<void>;
  connectionsLoading?: boolean;
  connectionsError?: string | null;
  selectedConnectionStates?: Readonly<
    Record<string, "missing" | "unavailable">
  >;
  /** Editing, adding, deleting and connection changes are off when false. */
  canEdit?: boolean;
  capabilities?: readonly import("../../../shared/capabilities").CapabilityDecision[];

  /** Project view tab. Defaults to notebook; Agent/App need parent callbacks. */
  view?: NotebookProjectView;
  onSelectView?: (view: NotebookProjectView) => Promise<void> | void;
  onShare?: () => Promise<void> | void;
  /** The Share panel, rendered by the route that owns the share state. */
  sharePanel?: ReactNode | undefined;
  onPublished?: (
    release: Awaited<
      ReturnType<typeof import("../../../actions/publish-project").default.run>
    >,
  ) => void;
  publishPending?: boolean;
  onPublishingChange?: (projectId: string, pending: boolean) => void;
  onOpenComments?: () => Promise<void> | void;
  onOpenToolRailItem?: (item: NotebookToolRailItem) => Promise<void> | void;

  /** Persistent right agent pane; the real composer is parent-owned. */
  agentOpen?: boolean;
  onToggleAgent?: () => Promise<void> | void;
  agentPane?: ReactNode;
  agentComposer?: ReactNode;
  onSubmitAgentPrompt?: (prompt: string) => Promise<void> | void;
  onLearnMoreAgent?: () => Promise<void> | void;
  onAddAgentContext?: () => Promise<void> | void;

  /** Empty-project prompt, datasets and actions; supplied by the parent. */
  emptyState?: NotebookEmptyState;
  /** Kinds the parent action can create; others stay visibly disabled. */
  supportedAddKinds?: readonly CellKind[];
  /** Optional: move the project to trash through the parent action. */
  onTrash?: (() => Promise<void>) | undefined;
  onFavorite?: ((favorited: boolean) => Promise<boolean>) | undefined;
  onExportYaml?: (() => Promise<void>) | undefined;
  onAddToCollection?: (() => void) | undefined;
  onArchive?: (() => Promise<void>) | undefined;
  onNewProject?: (() => Promise<void>) | undefined;
  /** Fetch more persisted result rows so page `requiredRowCount/50` exists. */
  onLoadResultRows?:
    | ((
        cellId: string,
        ...args: Parameters<LoadResultRows>
      ) => ReturnType<LoadResultRows>)
    | undefined;
  onLoadResultPage?:
    | ((
        cellId: string,
        ...args: Parameters<LoadResultPage>
      ) => ReturnType<LoadResultPage>)
    | undefined;
  onLoadPythonPage?: LoadPythonPage | undefined;
}
