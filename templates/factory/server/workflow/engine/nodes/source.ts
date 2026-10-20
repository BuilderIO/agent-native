import type { OperationResult } from "../../adapter.js";
import { WorkflowError, type WorkflowNodeOfKind } from "../../contract.js";
import {
  boundItem,
  capInlineItems,
  normalizedItemSchema,
  type NormalizedItem,
} from "../../items.js";
import { buildScope, resolveBindings } from "../bindings.js";
import { fitText, isRecord } from "../bounds.js";
import { isSafelyRetryable, retrying } from "../call.js";
import { takeWithinCap } from "../cap.js";
import type {
  FlowItem,
  NodeCall,
  NodeExecutorFor,
  NodeOutcome,
} from "../types.js";

type SourceNode = WorkflowNodeOfKind<"source">;
type SourceSettings = SourceNode["settings"];

interface Fetched {
  items: readonly unknown[];
  totalAvailable?: number;
  cursor?: string;
  /** Rows the provider sent that the host could not turn into items. */
  skippedRows?: number;
}

/**
 * How many rows the host left out of a provider's page. A response that says
 * nothing about it left none out; one that says it in a form that is not a
 * count is not read as zero.
 */
function skippedRowsOf(output: unknown, operationId: string): number {
  if (!isRecord(output) || output.skippedRows === undefined) return 0;
  const count = output.skippedRows;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw new WorkflowError(
      "engine_error",
      `${operationId} reported "skippedRows" as ${JSON.stringify(count)}, which is not a count of rows.`,
    );
  }
  return count;
}

function takeBound(settings: SourceSettings): number {
  return settings.source === "inbox-poll" || settings.source === "status"
    ? settings.takeLimit
    : settings.maxItems;
}

/**
 * A provider query that remembers its items in the inbox. Its items carry a row
 * of their own, written here, because nothing else will: the pollers write
 * theirs, and a window or a `none` query keeps its items inline.
 */
function storesRows(settings: SourceSettings): boolean {
  return settings.source === "provider-query" && settings.memory === "inbox";
}

function isInboxBacked(settings: SourceSettings): boolean {
  return (
    settings.source === "inbox-poll" ||
    settings.source === "status" ||
    (settings.source === "provider-query" && settings.memory === "inbox")
  );
}

async function fetchFromInbox(
  call: NodeCall<SourceNode>,
  settings: Extract<SourceSettings, { source: "inbox-poll" | "status" }>,
): Promise<Fetched> {
  const { ctx } = call;
  const result = await retrying(
    ctx,
    () =>
      ctx.host.inbox.take({
        settings,
        mode: ctx.mode,
        signal: ctx.signal,
      }),
    (taken) => !taken.ok && taken.retryable,
  );
  if (!result.ok) throw new WorkflowError(result.code, result.message);
  return {
    items: result.items,
    ...(result.totalAvailable === undefined
      ? {}
      : { totalAvailable: result.totalAvailable }),
  };
}

async function fetchFromOperation(
  call: NodeCall<SourceNode>,
  settings: Extract<SourceSettings, { source: "provider-query" | "window" }>,
  limit: number,
): Promise<Fetched> {
  const { ctx, node } = call;
  const def = ctx.host.catalog.get(settings.operation);
  if (!def) {
    throw new WorkflowError(
      "graph_invalid",
      `Operation "${settings.operation}" is not in the catalog.`,
    );
  }
  const resolved = resolveBindings(
    settings.args,
    def,
    buildScope(ctx, undefined),
  );
  if (!resolved.ok) {
    throw new WorkflowError(resolved.failure.code, resolved.failure.message);
  }
  if (resolved.aiBindings.length > 0) {
    throw new WorkflowError(
      "graph_invalid",
      "A source cannot have model-written arguments: it runs before any item exists.",
    );
  }
  const fields = resolved.fields;
  if (settings.source === "window") {
    if (!def.window) {
      throw new WorkflowError(
        "graph_invalid",
        `${def.id} cannot read a window.`,
      );
    }
    fields[def.window.fromParam] = ctx.window.start;
    fields[def.window.toParam] = ctx.window.end;
  }
  if (def.cursor) {
    const stored = await ctx.host.store.getSourceCursor(ctx.scope, {
      workflowId: ctx.workflowId,
      nodeId: node.id,
    });
    if (stored) fields[def.cursor.param] = stored.value;
  }

  const result: OperationResult = await retrying(
    ctx,
    () =>
      ctx.host.operations.execute({
        operation: def,
        fields,
        credentialSlot: def.credential.provider,
        mode: ctx.mode,
        signal: ctx.signal,
        limit,
      }),
    isSafelyRetryable,
  );
  if (!result.ok) throw new WorkflowError(result.code, result.message);
  if (result.items === undefined) {
    throw new WorkflowError(
      "item_invalid",
      `${def.id} returned no list of items. A source with nothing new returns an empty list.`,
    );
  }
  return {
    items: result.items,
    ...(result.totalAvailable === undefined
      ? {}
      : { totalAvailable: result.totalAvailable }),
    ...(result.cursor === undefined ? {} : { cursor: result.cursor }),
    skippedRows: skippedRowsOf(result.output, def.id),
  };
}

/**
 * Gives the items a row before anything downstream runs, so an End has one to
 * move, and finds out which of them were already handled: a row that ended
 * (`resolved`, `dismissed`, `needs_manual`) is not taken again, because the
 * provider offering the same record on a later tick is not new work. A row
 * that was released, or that a person put back, is open and is taken.
 *
 * The write is idempotent on the item id and all or nothing, so a failure
 * leaves no half-stored list and fails the step. A dry or test run stores
 * nothing and reads the same states. A writer that does not say where an item
 * stands fails the step: it is never read as new.
 */
async function storeRows(
  call: NodeCall<SourceNode>,
  items: readonly NormalizedItem[],
): Promise<ReadonlySet<string>> {
  const { ctx, node, step } = call;
  const live = ctx.runtime.live;
  if (!live) step.field("rowsHeld", "not a live run");
  if (items.length === 0) {
    step.field("alreadyHandled", 0);
    return new Set();
  }
  const stored = await retrying(
    ctx,
    () =>
      ctx.host.items.upsertItems({
        items,
        ...(live ? {} : { dryRun: true }),
      }),
    (result) => !result.ok && result.retryable,
  );
  if (!stored.ok) {
    throw new WorkflowError(
      stored.code,
      `Could not store the items "${node.name}" took: ${stored.message}`,
    );
  }
  const stateOf = new Map(
    stored.states.map((entry) => [entry.id, entry.state]),
  );
  const unknown = items.find((item) => !stateOf.has(item.id));
  if (unknown) {
    throw new WorkflowError(
      "engine_error",
      `The item store did not say where "${unknown.id}" stands, so it cannot be told from a new item.`,
    );
  }
  const handled = new Set(
    items
      .filter((item) => stateOf.get(item.id) === "terminal")
      .map((item) => item.id),
  );
  step.field("alreadyHandled", handled.size);
  if (live) {
    step.field("rows", {
      inserted: stored.inserted,
      updated: stored.updated,
      unchanged: stored.unchanged,
      skipped: stored.skipped,
    });
  }
  return handled;
}

/**
 * The rows this source's operation brought in earlier that are back in the
 * queue (a person sent them back, or a run died holding them). Its provider
 * has moved past them and will not offer them again, so a source that keeps
 * its items in the inbox asks for them itself.
 */
async function fetchRequeued(
  call: NodeCall<SourceNode>,
  settings: Extract<SourceSettings, { source: "provider-query" }>,
  limit: number,
): Promise<NormalizedItem[]> {
  const { ctx } = call;
  const result = await retrying(
    ctx,
    () =>
      ctx.host.inbox.takeRequeued({
        operationId: settings.operation,
        limit,
        mode: ctx.mode,
        signal: ctx.signal,
      }),
    (taken) => !taken.ok && taken.retryable,
  );
  if (!result.ok) throw new WorkflowError(result.code, result.message);
  return parseItems(result.items);
}

function parseItems(raw: readonly unknown[]): NormalizedItem[] {
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const parsed = normalizedItemSchema.safeParse(entry);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new WorkflowError(
        "item_invalid",
        `Item ${index} is not a valid item: ${issue.path.join(".") || "(root)"}: ${issue.message}.`,
      );
    }
    if (seen.has(parsed.data.id)) {
      throw new WorkflowError(
        "item_invalid",
        `Item ${index} repeats the id "${parsed.data.id}".`,
      );
    }
    seen.add(parsed.data.id);
    return boundItem(parsed.data);
  });
}

/**
 * Starts a list. It takes at most its bound, says when there was more
 * (`truncated` and the total on its step), and takes the items under a lease so
 * an overlapping tick cannot also take them. The cursor it hands back is saved
 * only when the whole run completes (a pause or a failure after this step would
 * otherwise strand what it took), and not at all when the engine had to drop
 * items the cursor already covers: they would never be offered again. Items
 * the inbox says were already handled are left out on purpose and do not hold
 * the cursor back.
 */
export const executeSource: NodeExecutorFor<"source"> = async (call) => {
  const { ctx, node, input, step } = call;
  const settings = node.settings;
  if (input.length > 0) {
    throw new WorkflowError(
      "graph_invalid",
      `A source starts a list and takes no input, but ${input.length} item${input.length === 1 ? "" : "s"} reached "${node.name}".`,
    );
  }
  const bound = takeBound(settings);
  const fetched =
    settings.source === "inbox-poll" || settings.source === "status"
      ? await fetchFromInbox(call, settings)
      : await fetchFromOperation(call, settings, bound);

  const offered = parseItems(fetched.items);
  // Rows put back in the queue come first; one the provider offers again is the same row.
  const requeued =
    settings.source === "provider-query" && storesRows(settings)
      ? await fetchRequeued(call, settings, bound)
      : [];
  const requeuedIds = new Set(requeued.map((item) => item.id));
  const fresh = offered.filter((item) => !requeuedIds.has(item.id));
  const items = [...requeued, ...fresh];
  const inbox = isInboxBacked(settings);
  const counted = capInlineItems(items, bound);
  const { taken, oversized } = takeWithinCap(
    counted.items.map(
      (item): FlowItem => ({
        id: item.id,
        data: { ...item },
        nodes: {},
        inbox,
      }),
    ),
    bound,
  );
  if (oversized) {
    throw new WorkflowError(
      "output_over_cap",
      `Item "${counted.items[0].id}" alone is larger than one step can hold, so it can never be taken.`,
    );
  }
  const droppedByEngine = taken.length < items.length;
  const totalAvailable = Math.max(
    items.length,
    (fetched.totalAvailable ?? 0) +
      requeued.length -
      (offered.length - fresh.length),
  );
  const cut =
    totalAvailable > taken.length
      ? { taken: taken.length, totalAvailable }
      : undefined;
  if (cut) {
    step.truncated(totalAvailable);
    step.field(
      "cutBy",
      items.length > bound ? "count" : droppedByEngine ? "bytes" : "provider",
    );
  }
  // `taken` is the leading run of what was offered, and the rows put back are already rows: only what the provider sent is stored.
  const takenIds = new Set(taken.map((item) => item.id));
  const handled = storesRows(settings)
    ? await storeRows(
        call,
        counted.items.filter(
          (item) => takenIds.has(item.id) && !requeuedIds.has(item.id),
        ),
      )
    : new Set<string>();
  const open = taken.filter((item) => !handled.has(item.id));
  const { won, skipped } = await ctx.runtime.lease(
    cut ? open.map((item) => ({ ...item, cut })) : open,
  );

  step.field("source", settings.source);
  if (requeued.length > 0) {
    step.field(
      "requeued",
      taken.filter((item) => requeuedIds.has(item.id)).length,
    );
  }
  if (fetched.skippedRows !== undefined && fetched.skippedRows > 0) {
    // Rows the provider had and the list lacks: a short list must not read as "nothing else".
    step.field("skippedRows", fetched.skippedRows);
    step.itemNeedsCheck({
      code: "partial_read",
      message: `${fetched.skippedRows} row${fetched.skippedRows === 1 ? " was" : "s were"} left out of what the provider sent for want of a readable title or time.`,
    });
    ctx.runtime.skippedRows += fetched.skippedRows;
  }
  // The poller behind an inbox poll writes its rows in every mode, a dry run
  // included, so the audit can say the run ingested even though it changed no item.
  if (settings.source === "inbox-poll") step.field("ingested", true);
  step.field("taken", won.length);
  if (skipped.length > 0) step.field("heldByAnotherRun", skipped.length);
  for (const item of won) {
    ctx.runtime.record({
      itemId: item.id,
      nodeId: node.id,
      kind: "taken",
      port: "out",
      summary: `taken from ${settings.source}: ${String(item.data.title)}`,
    });
  }

  let commit: NodeOutcome["commit"];
  if (fetched.cursor !== undefined) {
    if (droppedByEngine) {
      step.field("cursorHeld", "items past the bound were not taken");
      if (ctx.runtime.live) ctx.runtime.cursorsHeld.push(node.id);
    } else if (ctx.runtime.live) {
      const value = fetched.cursor;
      step.field("cursorAfter", fitText(value, 200));
      commit = () =>
        ctx.host.store.setSourceCursor(ctx.scope, {
          workflowId: ctx.workflowId,
          nodeId: node.id,
          value,
          ownerEmail: ctx.ownerEmail,
        });
    } else {
      step.field("cursorHeld", "not a live run");
    }
  }
  return { itemsByPort: { out: won }, ...(commit ? { commit } : {}) };
};
