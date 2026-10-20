import {
  WorkflowError,
  type WorkflowErrorCode,
  type WorkflowNodeOfKind,
} from "../../contract.js";
import { evaluatePath, validatePath } from "../../expressions.js";
import { buildScope } from "../bindings.js";
import { stableHash } from "../bounds.js";
import { failItem } from "../item-failure.js";
import { collectMembers, memberView } from "../members.js";
import type {
  FlowItem,
  ItemFailure,
  NodeCall,
  NodeExecutorFor,
} from "../types.js";

type Read = { ok: true; value: unknown } | { ok: false; failure: ItemFailure };

/** One item a combine could not read, kept until the combine knows whether it may go on without it. */
interface Problem {
  item: FlowItem;
  failure: ItemFailure;
}

/** Reads a path for one item; with no value there, says why and leaves the choice to the caller. */
async function readFor(
  call: Pick<NodeCall, "ctx" | "node" | "step">,
  item: FlowItem,
  path: string,
): Promise<Read> {
  const { ctx } = call;
  const check = validatePath(path);
  if (!check.ok) {
    return {
      ok: false,
      failure: { code: "expression_failed", message: check.error.message },
    };
  }
  const counters = await ctx.runtime.countersOf(item.id);
  const found = evaluatePath(
    check.path,
    buildScope(ctx, item, counters, call.node.id),
  );
  if (!found.found) {
    return {
      ok: false,
      failure: {
        code: "expression_failed",
        message: `"${path}" has no value here.`,
      },
    };
  }
  return { ok: true, value: found.value };
}

/**
 * A combine that adds items up (a list, a count, totals) cannot drop the ones it
 * could not read: its answer would be smaller than the truth and read as a
 * quiet day. So it fails as a whole, with each unreadable item on record.
 */
function failCombine(
  call: Pick<NodeCall, "ctx" | "node">,
  problems: readonly Problem[],
  total: number,
): never {
  const [first] = problems;
  for (const { item, failure } of problems) {
    call.ctx.runtime.record({
      itemId: item.id,
      nodeId: call.node.id,
      kind: "error",
      code: failure.code,
      summary: `${failure.code}: ${failure.message}`,
    });
  }
  const code: WorkflowErrorCode = first.failure.code;
  throw new WorkflowError(
    code,
    `"${call.node.name}" could not read ${problems.length} of ${total} items, so it combined none of them: ${first.failure.message} (first: ${first.item.id}).`,
    { unreadable: problems.length, total },
  );
}

function groupKey(value: unknown): string | null {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : null;
}

/**
 * Groups items by a path. An item that cannot be read for it fails, one by one,
 * when the groups are used for routing (`problems` is null); when they feed
 * totals, it is added to `problems` and the caller fails the whole combine.
 */
async function groupItems(
  call: NodeCall<WorkflowNodeOfKind<"combine">>,
  path: string,
  problems: Problem[] | null,
): Promise<Map<string, FlowItem[]>> {
  const groups = new Map<string, FlowItem[]>();
  const unreadable = async (item: FlowItem, failure: ItemFailure) => {
    if (problems === null) await failItem(call, item, failure);
    else problems.push({ item, failure });
  };
  for (const item of call.input) {
    const read = await readFor(call, item, path);
    if (!read.ok) {
      await unreadable(item, read.failure);
      continue;
    }
    const key = groupKey(read.value);
    if (key === null) {
      await unreadable(item, {
        code: "expression_failed",
        message: `"${path}" must be text, a number, or true/false to group on.`,
      });
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function bucketOf(instant: unknown, bucket: "day" | "week"): string | null {
  if (typeof instant !== "string") return null;
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  if (bucket === "week") {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  }
  return date.toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

type CombinedIdentity = {
  nodeId: string;
  memberIds: readonly string[];
} & (
  | {
      kind: "list" | "count";
      /** What a list or count over no items is about: the start of the window it reports on. */
      windowStart: string;
    }
  | { kind: "summary"; key: string }
);

/**
 * The id of a list, count or summary. It comes from what the item is built
 * from, never from the run, so the same items coming round again (a run that
 * stopped after the write, or the same window read twice) find the write's
 * receipt done and do not send it twice, while any other set of items is a new
 * item whose write is its own. Order does not matter. A summary is also told
 * apart by its group's key. A list or count over nothing has no members to
 * name it, so its window does, or each quiet day would read as the quiet day
 * before.
 */
export function combinedItemId(identity: CombinedIdentity): string {
  const members = [...identity.memberIds].sort();
  const basis =
    "key" in identity
      ? { key: identity.key, members }
      : members.length === 0
        ? { since: identity.windowStart }
        : { members };
  return `${identity.kind}:${identity.nodeId}:${stableHash(JSON.stringify(basis))}`;
}

/**
 * A group is one standing item per key, the same on every tick whoever its
 * members are: what is counted on it (`nudges`, `rounds`) stays counted. Not
 * built from its members, whose ids change as a task goes round (a group of
 * groups would never be the same item twice).
 */
export function groupItemId(nodeId: string, key: string): string {
  return `group:${nodeId}:${stableHash(key)}`;
}

/**
 * What tells one set of members of a group from another, for its writes: the
 * rows of the same service on another day are a digest to send, while the same
 * rows again are not. A member that is itself a group, a list or a summary
 * stands for what it was built from, not for its own id, which stays the same
 * while its rows change. Order does not matter.
 */
function groupReceiptSalt(members: readonly FlowItem[]): string {
  const identities = members.flatMap((member): readonly string[] => {
    if (member.receiptSalt !== undefined) return [member.receiptSalt];
    return member.members !== undefined && member.members.length > 0
      ? member.members
      : [member.id];
  });
  return stableHash(JSON.stringify([...identities].sort()));
}

function aggregate(
  values: readonly number[],
  agg: "sum" | "count" | "avg",
): number {
  if (agg === "count") return values.length;
  const total = values.reduce((sum, value) => sum + value, 0);
  return agg === "sum" ? total : total / values.length;
}

/**
 * Many items into one item holding a list or a count, one item per group, or
 * one item per group with totals and a comparison to a baseline. A list or a
 * count over nothing is still one item with `count: 0`, so "nothing happened"
 * can be reported; follow it with a Filter on `count` to stay quiet. A list or
 * count also carries `truncated` and `totalAvailable`, which say when its
 * source had more than it took. A group has no item when it has no members,
 * so grouping nothing gives nothing.
 *
 * A list, count or totals that cannot read one of its items fails the step: an
 * answer built from some of the items would read as a smaller truth. Grouping
 * for routing fails the unreadable item alone.
 *
 * A comparison needs the days before the latest one and the latest being the
 * day the run is about. A bucket that is still going on (the run's own day)
 * never counts. With no earlier bucket, an average of zero, or a latest bucket
 * older than expected, the item says `baselineMissing: true` and why, and
 * carries no comparison: it is never compared as though it were the day.
 */
export const executeCombine: NodeExecutorFor<"combine"> = async (call) => {
  const { ctx, node, input } = call;
  const settings = node.settings;

  if (settings.mode === "list" || settings.mode === "count") {
    const entries: unknown[] = [];
    const used: FlowItem[] = [];
    const problems: Problem[] = [];
    for (const item of input) {
      if (settings.mode === "list" && settings.field !== undefined) {
        const read = await readFor(call, item, settings.field);
        if (!read.ok) {
          problems.push({ item, failure: read.failure });
          continue;
        }
        entries.push(read.value);
      } else {
        entries.push(memberView(item));
      }
      used.push(item);
    }
    if (problems.length > 0) failCombine(call, problems, input.length);
    const cut = used.find((item) => item.cut)?.cut;
    const counted = {
      count: entries.length,
      truncated: cut !== undefined,
      totalAvailable: cut ? cut.totalAvailable : entries.length,
    };
    ctx.runtime.fold(used, node.id);
    const combined: FlowItem = {
      id: combinedItemId({
        kind: settings.mode,
        nodeId: node.id,
        memberIds: used.map((item) => item.id),
        windowStart: ctx.window.start,
      }),
      data: settings.mode === "list" ? { items: entries, ...counted } : counted,
      nodes: {},
      inbox: false,
      members: collectMembers(used),
    };
    for (const item of used) {
      ctx.runtime.record({
        itemId: item.id,
        nodeId: node.id,
        kind: "output",
        summary: `combined into ${combined.id}`,
      });
    }
    ctx.runtime.record({
      itemId: combined.id,
      nodeId: node.id,
      kind: "output",
      port: "out",
      summary: `combined ${used.length} item${used.length === 1 ? "" : "s"}`,
    });
    return { itemsByPort: { out: [combined] } };
  }

  if (settings.mode === "groupBy") {
    const groups = await groupItems(call, settings.key ?? "", null);
    const out: FlowItem[] = [];
    for (const [key, members] of groups) {
      const id = groupItemId(node.id, key);
      const [first] = members;
      out.push({
        id,
        data: {
          ...first.data,
          id,
          key,
          count: members.length,
          reports: members.map(memberView),
        },
        nodes: first.nodes,
        inbox: false,
        members: collectMembers(members),
        receiptSalt: groupReceiptSalt(members),
      });
      ctx.runtime.fold(members, node.id);
      for (const member of members) {
        ctx.runtime.record({
          itemId: member.id,
          nodeId: node.id,
          kind: "output",
          summary: `grouped under ${key} as ${id}`,
        });
      }
    }
    return { itemsByPort: { out } };
  }

  const summary = settings.summarize;
  if (summary === undefined) {
    throw new Error("A summarize combine has no summarize settings.");
  }
  const problems: Problem[] = [];
  const groups = await groupItems(call, summary.group, problems);
  const baseline = summary.baseline;
  const runEnd = Date.parse(ctx.window.end);
  // The bucket the run is in has only part of its data, and the one before it is the day being summarized.
  const currentBucket = baseline
    ? bucketOf(ctx.window.end, baseline.bucket)
    : null;
  const expectedLatest = baseline
    ? bucketOf(
        new Date(
          runEnd - (baseline.bucket === "week" ? 7 : 1) * DAY_MS,
        ).toISOString(),
        baseline.bucket,
      )
    : null;
  const amounts = new Map<
    string,
    { buckets: Map<string, number[]>; all: number[] }
  >();
  for (const [key, members] of groups) {
    const buckets = new Map<string, number[]>();
    const all: number[] = [];
    for (const member of members) {
      let amount = 1;
      if (summary.agg !== "count") {
        const read = await readFor(call, member, summary.value);
        if (!read.ok) {
          problems.push({ item: member, failure: read.failure });
          continue;
        }
        if (typeof read.value !== "number" || !Number.isFinite(read.value)) {
          problems.push({
            item: member,
            failure: {
              code: "expression_failed",
              message: `"${summary.value}" must be a number to ${summary.agg}.`,
            },
          });
          continue;
        }
        amount = read.value;
      }
      all.push(amount);
      if (baseline) {
        const label = bucketOf(member.data.occurredAt, baseline.bucket);
        if (label === null) {
          problems.push({
            item: member,
            failure: {
              code: "item_invalid",
              message:
                "An item needs a valid occurredAt to fall in a baseline bucket.",
            },
          });
          continue;
        }
        buckets.set(label, [...(buckets.get(label) ?? []), amount]);
      }
    }
    amounts.set(key, { buckets, all });
  }
  if (problems.length > 0) failCombine(call, problems, input.length);

  const out: FlowItem[] = [];
  for (const [key, members] of groups) {
    const { buckets, all } = amounts.get(key) ?? {
      buckets: new Map(),
      all: [],
    };
    if (all.length === 0) continue;

    const data: Record<string, unknown> = {
      key,
      count: all.length,
      total: aggregate(all, summary.agg),
    };
    if (baseline) {
      const labels = [...buckets.keys()]
        .filter((label) => currentBucket === null || label < currentBucket)
        .sort();
      const latestLabel = labels[labels.length - 1];
      const prior = labels
        .slice(0, -1)
        .slice(-baseline.window)
        .map((label) => aggregate(buckets.get(label) ?? [], summary.agg));
      const baselineAverage =
        prior.length === 0
          ? 0
          : prior.reduce((sum, value) => sum + value, 0) / prior.length;
      let missing: string | undefined;
      if (latestLabel === undefined) {
        missing = "there is no finished bucket to compare";
      } else if (expectedLatest !== null && latestLabel < expectedLatest) {
        missing = `the latest data is ${latestLabel}, not ${expectedLatest}`;
      } else if (prior.length === 0) {
        missing = "there is no earlier bucket to compare with";
      } else if (
        summary.compare === "latestVsAverage" &&
        baselineAverage === 0
      ) {
        missing = "the baseline average is zero";
      }
      if (missing !== undefined) {
        data.baselineMissing = true;
        data.baselineMissingReason = `No baseline for ${key}: ${missing}.`;
        if (latestLabel !== undefined) data.latestBucket = latestLabel;
      } else {
        const latest = aggregate(buckets.get(latestLabel) ?? [], summary.agg);
        data.baselineMissing = false;
        data.latest = latest;
        data.latestBucket = latestLabel;
        data.baselineAverage = baselineAverage;
        data.baselineBuckets = prior.length;
        if (summary.compare === "latestVsAverage") {
          data.increaseAmount = latest - baselineAverage;
          data.increasePercent =
            ((latest - baselineAverage) / baselineAverage) * 100;
        }
      }
    }
    const id = combinedItemId({
      kind: "summary",
      nodeId: node.id,
      memberIds: members.map((member) => member.id),
      key,
    });
    out.push({
      id,
      data: { id, ...data },
      nodes: {},
      inbox: false,
      members: collectMembers(members),
    });
    ctx.runtime.fold(members, node.id);
    ctx.runtime.record({
      itemId: id,
      nodeId: node.id,
      kind: "output",
      port: "out",
      summary: `summarized ${key}: ${JSON.stringify(data)}`,
    });
  }
  return { itemsByPort: { out } };
};
