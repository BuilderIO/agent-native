import { WORKFLOW_STORE_LIMITS } from "../adapter.js";
import type { RunMode, StepRecord, StepStatus } from "../contract.js";
import { MAX_INLINE_ITEMS, jsonByteLength } from "../items.js";
import { fitText } from "./bounds.js";
import type { ItemFailure, PortItems, StopReason } from "./types.js";

const PROBLEM_BYTES = 500;

interface StepBase {
  runId: string;
  nodeId: string;
  mode: RunMode;
  startedAt: string;
}

/**
 * Gathers what one node did to its batch and turns it into the one step row
 * the store keeps for `(run, node)`. A node's status is the worst thing that
 * happened to any of its items, so a half-failed step never reads as clean.
 */
export class StepBuilder {
  private readonly fields: Record<string, unknown> = {};
  private readonly problems = new Map<string, number>();
  private ports: PortItems = {};
  private readonly summaryPorts: Record<string, readonly { id: string }[]> = {};
  private failedItems = 0;
  private checkItems = 0;
  private firstFailure: ItemFailure | undefined;
  private truncatedTotal: number | undefined;
  private inputCut = false;
  private readonly receiptKeys: string[] = [];
  private threadId: string | undefined;

  constructor(private readonly base: StepBase) {}

  field(key: string, value: unknown): void {
    this.fields[key] = value;
  }

  fieldValue(key: string): unknown {
    return this.fields[key];
  }

  /**
   * Notes something that went wrong beside the step's own work and did not
   * change its result (a thread that could not be saved). The first message is
   * kept under `key`, and `<key>Turns` says how many turns had one.
   */
  problem(key: string, message: string): void {
    const seen = (this.problems.get(key) ?? 0) + 1;
    this.problems.set(key, seen);
    if (seen === 1) this.fields[key] = fitText(message, PROBLEM_BYTES);
    else this.fields[`${key}Turns`] = seen;
  }

  setPorts(itemsByPort: PortItems): void {
    this.ports = itemsByPort;
  }

  /**
   * A count that is not an output: items a Wait parked leave the run through no
   * port, but the canvas still shows how many stopped there. It is recorded
   * beside the ports and never delivered anywhere.
   */
  summaryPort(name: string, items: readonly { id: string }[]): void {
    this.summaryPorts[name] = items;
  }

  itemFailed(failure: ItemFailure): void {
    this.failedItems += 1;
    this.firstFailure ??= failure;
  }

  itemNeedsCheck(failure: ItemFailure): void {
    this.checkItems += 1;
    this.firstFailure ??= failure;
  }

  truncated(totalAvailable: number): void {
    this.truncatedTotal = totalAvailable;
  }

  inputTruncated(): void {
    this.inputCut = true;
  }

  receipt(key: string): void {
    this.receiptKeys.push(key);
  }

  thread(id: string): void {
    this.threadId ??= id;
  }

  /** Items this step failed or flagged, for run totals. */
  get counts(): { failed: number; needsCheck: number } {
    return { failed: this.failedItems, needsCheck: this.checkItems };
  }

  finish(args: {
    finishedAt: string;
    /** The step as a whole failed; no output is trusted. */
    failure?: ItemFailure;
    stop?: StopReason;
  }): StepRecord {
    const error = args.failure ?? args.stop ?? this.firstFailure;
    let status: StepStatus = "succeeded";
    if (args.failure || args.stop) status = "failed";
    else if (this.checkItems > 0) status = "needs_check";
    else if (this.failedItems > 0) status = "failed";

    const ports: StepRecord["ports"] = {};
    for (const [port, items] of Object.entries({
      ...this.ports,
      ...this.summaryPorts,
    })) {
      ports[port] = {
        count: items.length,
        itemIds: items.slice(0, MAX_INLINE_ITEMS).map((item) => item.id),
      };
    }
    const fields = boundStepFields(this.fields);
    return {
      runId: this.base.runId,
      nodeId: this.base.nodeId,
      status,
      mode: this.base.mode,
      startedAt: this.base.startedAt,
      finishedAt: args.finishedAt,
      ports,
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
      ...(this.truncatedTotal === undefined
        ? {}
        : { truncated: { totalAvailable: this.truncatedTotal } }),
      ...(this.inputCut ? { inputTruncated: true } : {}),
      ...(error === undefined
        ? {}
        : {
            error: { code: error.code, message: error.message.slice(0, 1000) },
          }),
      ...(this.receiptKeys.length > 0 ? { receiptKeys: this.receiptKeys } : {}),
      ...(this.threadId === undefined ? {} : { agentThreadId: this.threadId }),
    };
  }
}

/** Drops the newest fields that do not fit, and names them, so the store never has to refuse a step. */
export function boundStepFields(
  all: Record<string, unknown>,
): Record<string, unknown> {
  const fields = { ...all };
  const dropped: string[] = [];
  const keys = Object.keys(fields);
  while (
    jsonByteLength({
      ...fields,
      ...(dropped.length > 0 ? { fieldsCut: dropped } : {}),
    }) > WORKFLOW_STORE_LIMITS.stepFieldsBytes &&
    keys.length > 0
  ) {
    const key = keys.pop();
    if (key === undefined) break;
    delete fields[key];
    dropped.push(key);
  }
  return dropped.length > 0 ? { ...fields, fieldsCut: dropped } : fields;
}
