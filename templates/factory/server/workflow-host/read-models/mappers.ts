import { z } from "zod";

import {
  WorkflowStoreError,
  type RunCounts,
  type RunError,
} from "../../workflow/adapter.js";
import {
  endOutcomeSchema,
  itemEventKindSchema,
  receiptSchema,
  runTriggerKindSchema,
  stepRecordSchema,
  workflowErrorCodeSchema,
  type EndOutcome,
  type ItemEventKind,
  type Receipt,
  type RunMode,
  type RunStatus,
  type RunTriggerKind,
  type StepRecord,
  type WorkflowErrorCode,
} from "../../workflow/contract.js";
import {
  assembleRunRecord,
  parseStoredJson,
  parseStoredValue,
  readRunCounts,
} from "../../workflow/store-rules.js";
import {
  decodeReceiptKey,
  durationMs,
  type EventRow,
  type ReceiptRow,
  type RunRow,
  type StepRow,
} from "./shared.js";

export interface RunView {
  id: string;
  workflowId: string;
  workflowName: string | null;
  graphVersion: number;
  mode: RunMode;
  status: RunStatus;
  triggerKind: RunTriggerKind;
  /** `schedule`, or the email of whoever started the run. */
  startedBy: string;
  tickKey: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** Named totals: `taken`, `done`, `dismissed`, `needsManual`, `released`, `itemFailures`, `needsCheck`, `modelCalls`. */
  counts: RunCounts;
  error: RunError | null;
  historyRowId: string | null;
}

export interface ReceiptView {
  key: string;
  status: Receipt["status"];
  externalRef: string | null;
  url: string | null;
  summary: string | null;
  at: string;
  itemId: string;
  nodeId: string;
  attempt: number;
}

export function stepOf(row: StepRow): StepRecord {
  const label = `factory_workflow_steps (run "${row.runId}", node "${row.nodeId}")`;
  const json = (raw: string, column: string): unknown =>
    parseStoredJson(raw, z.unknown(), `${label} ${column}`);
  return parseStoredValue(
    {
      runId: row.runId,
      nodeId: row.nodeId,
      status: row.status,
      mode: row.mode,
      startedAt: row.startedAt,
      ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt }),
      ports: json(row.portsJson, "ports_json"),
      ...(row.fieldsJson === null
        ? {}
        : { fields: json(row.fieldsJson, "fields_json") }),
      ...(row.totalAvailable === null
        ? {}
        : { truncated: { totalAvailable: row.totalAvailable } }),
      ...(row.inputTruncated === null
        ? {}
        : { inputTruncated: row.inputTruncated === 1 }),
      ...(row.errorCode === null
        ? {}
        : { error: { code: row.errorCode, message: row.errorMessage } }),
      ...(row.receiptKeysJson === null
        ? {}
        : { receiptKeys: json(row.receiptKeysJson, "receipt_keys_json") }),
      ...(row.agentThreadId === null
        ? {}
        : { agentThreadId: row.agentThreadId }),
    },
    stepRecordSchema,
    label,
  );
}

export function runViewOf(row: RunRow, workflowName: string | null): RunView {
  const record = assembleRunRecord({
    id: row.id,
    workflowId: row.workflowId,
    graphVersion: row.graphVersion,
    mode: row.mode,
    tickKey: row.tickKey,
    triggerKind: row.triggerKind,
    startedBy: row.startedBy,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    counts: readRunCounts(
      row.countsJson,
      `factory_workflow_runs "${row.id}" counts_json`,
    ),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    historyRowId: row.historyRowId,
  });
  return {
    id: record.id,
    workflowId: record.workflowId,
    workflowName,
    graphVersion: record.graphVersion,
    mode: record.mode,
    status: record.status,
    triggerKind: record.triggerKind,
    startedBy: record.startedBy,
    tickKey: record.tickKey,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt ?? null,
    durationMs: durationMs(record.startedAt, record.finishedAt),
    counts: record.counts,
    error: record.error ?? null,
    historyRowId: record.historyRowId ?? null,
  };
}

export function eventKindOf(value: string, label: string): ItemEventKind {
  return parseStoredValue(value, itemEventKindSchema, label);
}

/**
 * The trigger kind a run row stored. A row that never got one is unreadable:
 * it is not "manual" just because nothing says otherwise.
 */
export function triggerKindOfRow(
  row: Pick<RunRow, "id" | "triggerKind">,
): RunTriggerKind {
  return parseStoredValue(
    row.triggerKind,
    runTriggerKindSchema,
    `factory_workflow_runs "${row.id}" trigger_kind`,
  );
}

/** Who started a run, as the row stored it; a row that never recorded one is unreadable. */
export function startedByOfRow(row: Pick<RunRow, "id" | "startedBy">): string {
  return parseStoredValue(
    row.startedBy,
    z.string().min(1),
    `factory_workflow_runs "${row.id}" started_by`,
  );
}

/**
 * How an `ended` event ended the item and why an `error` event failed it, read
 * from the columns the engine wrote. A value outside the contract is
 * `corrupt_record`, never dropped; a column left empty reads as absent.
 */
export function eventDetailOf(row: Pick<EventRow, "id" | "outcome" | "code">): {
  outcome: EndOutcome | null;
  code: WorkflowErrorCode | null;
} {
  const label = `factory_workflow_item_events "${row.id}"`;
  return {
    outcome:
      row.outcome === null
        ? null
        : parseStoredValue(row.outcome, endOutcomeSchema, `${label} outcome`),
    code:
      row.code === null
        ? null
        : parseStoredValue(row.code, workflowErrorCodeSchema, `${label} code`),
  };
}

export function receiptViewOf(row: ReceiptRow): ReceiptView {
  const label = `factory_workflow_receipts "${row.receiptKey}"`;
  const receipt = parseStoredValue(
    {
      key: row.receiptKey,
      status: row.status,
      ...(row.externalRef === null ? {} : { externalRef: row.externalRef }),
      ...(row.url === null ? {} : { url: row.url }),
      ...(row.summary === null ? {} : { summary: row.summary }),
      at: row.recordedAt,
    },
    receiptSchema,
    label,
  );
  const decoded = decodeReceiptKey(receipt.key);
  if (!decoded) {
    throw new WorkflowStoreError(
      "corrupt_record",
      `${label} is not a workflow receipt key.`,
    );
  }
  return {
    key: receipt.key,
    status: receipt.status,
    externalRef: receipt.externalRef ?? null,
    url: receipt.url ?? null,
    summary: receipt.summary ?? null,
    at: receipt.at,
    itemId: decoded.itemId,
    nodeId: decoded.nodeId,
    attempt: decoded.attempt,
  };
}
