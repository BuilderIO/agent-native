import type { WorkflowScope } from "../workflow/adapter.js";
import { assertScope } from "../workflow/store-rules.js";
import {
  activityNeedsYou,
  activityRuns,
  type ActivityNeedsYouEntry,
  type ActivityQuery,
  type ActivityRunEntry,
} from "./read-models/activity.js";
import {
  listItems,
  type ItemListQuery,
  type ItemRow,
} from "./read-models/items.js";
import {
  getItemJourney,
  type ItemJourney,
  type JourneyQuery,
} from "./read-models/journey.js";
import { namesOf } from "./read-models/lookups.js";
import type { RunView } from "./read-models/mappers.js";
import {
  getNodeAudit,
  type NodeAudit,
  type NodeAuditQuery,
} from "./read-models/node-audit.js";
import {
  listParked,
  type ParkedList,
  type ParkedListQuery,
} from "./read-models/parked.js";
import {
  getRun,
  listRuns,
  type RunDetail,
  type RunListQuery,
} from "./read-models/runs.js";
import type { ReadDatabase, ReadPage } from "./read-models/shared.js";

export {
  READ_LIMITS,
  WORKFLOW_READ_ERROR_CODES,
  WorkflowReadError,
  clipText,
  decodeActivityCursor,
  decodeReceiptKey,
  durationMs,
  encodeActivityCursor,
  percentile,
  type ActivityPosition,
  type ReadPage,
  type WorkflowReadErrorCode,
} from "./read-models/shared.js";
export type {
  ActivityNeedsYouEntry,
  ActivityQuery,
  ActivityRunEntry,
} from "./read-models/activity.js";
export type {
  ItemJourney,
  JourneyEvent,
  JourneyStep,
  PathNode,
} from "./read-models/journey.js";
export type {
  ItemFilters,
  ItemLastEvent,
  ItemLease,
  ItemParking,
  ItemRow,
  NeedsYouReason,
} from "./read-models/items.js";
export type { ReceiptView, RunView } from "./read-models/mappers.js";
export type {
  NodeAudit,
  NodeAuditInput,
  NodeAuditOutput,
  NodeAuditStep,
  SampledItem,
} from "./read-models/node-audit.js";
export type {
  ParkedByNode,
  ParkedList,
  ParkedRow,
} from "./read-models/parked.js";
export type { RunDetail, StepPortView, StepView } from "./read-models/runs.js";

export interface WorkflowReadModels {
  listRuns(
    scope: WorkflowScope,
    input: RunListQuery,
  ): Promise<ReadPage<RunView>>;
  getRun(scope: WorkflowScope, runId: string): Promise<RunDetail | null>;
  listItems(
    scope: WorkflowScope,
    input: ItemListQuery,
  ): Promise<ReadPage<ItemRow>>;
  getItemJourney(
    scope: WorkflowScope,
    input: JourneyQuery,
  ): Promise<ItemJourney>;
  listParked(scope: WorkflowScope, input: ParkedListQuery): Promise<ParkedList>;
  getNodeAudit(scope: WorkflowScope, input: NodeAuditQuery): Promise<NodeAudit>;
  /** The workflows of this scope among `ids`, by id. An id not in the result is not in this factory. */
  workflowNames(
    scope: WorkflowScope,
    ids: readonly string[],
  ): Promise<Map<string, string>>;
  activityRuns(
    scope: WorkflowScope,
    query: ActivityQuery,
  ): Promise<ActivityRunEntry[]>;
  activityNeedsYou(
    scope: WorkflowScope,
    query: ActivityQuery,
  ): Promise<ActivityNeedsYouEntry[]>;
}

interface WorkflowReadModelsOptions {
  /** Called on every read, so a reset connection is never held. */
  getDatabase: () => ReadDatabase;
  clock?: () => Date;
}

/**
 * Read models for the Factory page: what the canvas, the Items tab, the item
 * journey, the node audit, and the Activity feed show. Every query takes the
 * org and factory first, selects the columns it shows (never a context or a
 * graph unless it reads one), and is bounded by a limit or by a key. A stored
 * JSON column that does not parse is `corrupt_record` naming the table and the
 * row, never `{}`. Nothing here writes.
 */
export function createWorkflowReadModels(
  options: WorkflowReadModelsOptions,
): WorkflowReadModels {
  const { getDatabase } = options;
  const clock = options.clock ?? (() => new Date());

  const models: WorkflowReadModels = {
    listRuns: (scope, input) => listRuns(getDatabase, scope, input),
    getRun: (scope, runId) => getRun(getDatabase, scope, runId),
    listItems: (scope, input) => listItems(getDatabase, clock, scope, input),
    getItemJourney: (scope, input) =>
      getItemJourney(getDatabase, clock, scope, input),
    listParked: (scope, input) => listParked(getDatabase, clock, scope, input),
    getNodeAudit: (scope, input) => getNodeAudit(getDatabase, scope, input),

    async workflowNames(scope, ids) {
      assertScope(scope);
      return namesOf(getDatabase(), scope, ids);
    },

    activityRuns: (scope, query) => activityRuns(getDatabase, scope, query),
    activityNeedsYou: (scope, query) =>
      activityNeedsYou(getDatabase, scope, query),
  };

  return models;
}
