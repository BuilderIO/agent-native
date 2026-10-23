import type { ActionRunContext } from "@agent-native/core/action";
import {
  LiveCopyError,
  type LiveCopyErrorCode,
} from "@agent-native/core/collab";
import { getDbExec } from "@agent-native/core/db";
import { hasActiveFeatureFlagRollout } from "@agent-native/core/feature-flags";
import { getSetting, putSetting } from "@agent-native/core/settings";
import { asc, eq, gt, sql } from "drizzle-orm";

import { LIVE_BODY_BACKFILL_FLAG } from "../../shared/feature-flags.js";
import { getDb, schema } from "../db/index.js";
import {
  liveBodyBackfillFlagsOn,
  liveBodyWriterGateForRow,
  liveBodyWriterPageColumns,
  type LiveBodyLegacyReason,
  type LiveBodyWriterPageRow,
} from "../lib/live-body-writer.js";
import {
  liveBodySwitchBlockers,
  liveBodySwitchEligibleSql,
  type LiveBodySwitchBlocker,
} from "./eligibility.js";
import { LiveBodyConversionError } from "./persist.js";
import { switchPageToLiveCopy } from "./switch.js";

// Stored-form backfill (lane L6b): pages whose owner has the backfill flag on,
// with both of the writer's, are switched to their live copy without a manual
// switch. An editor's first open switches its page before the editor binds,
// and a recurring sweep switches idle pages. Each switch is
// `switchPageToLiveCopy`'s conversion: History checkpoint, body revision,
// pending suggestions and comment quotes re-baselined, live copy seeded or
// matched. Neither path runs at cold start.

export type LiveBodyBackfillOutcome =
  | { status: "converted" }
  /** Already takes body writes through its live copy. */
  | { status: "current" }
  | { status: "skipped"; reason: "no_page" | "trashed" | "flag_off" }
  | {
      status: "skipped";
      reason: "ineligible";
      blockers: LiveBodySwitchBlocker[];
    }
  /** Not switched this time; a later open or pass tries again. */
  | {
      status: "deferred";
      reason: "live_edits" | "rebaseline_blocked" | "base_changed";
    }
  | {
      status: "deferred";
      reason: "live_copy_refused";
      code: LiveCopyErrorCode;
      detail?: string;
    }
  /** Switched, but the gate no longer puts it on its live copy. */
  | { status: "deferred"; reason: "gate_moved"; gate: LiveBodyLegacyReason };

type BackfillPageRow = LiveBodyWriterPageRow & { trashedAt: string | null };

type FlagsOn = (
  page: Pick<LiveBodyWriterPageRow, "ownerEmail" | "orgId">,
) => Promise<boolean>;

// What a page's live copy can't do with its body or state. Anything else
// core raises is a bug in the binding, and is thrown.
const DEFERRED_LIVE_COPY_CODES: ReadonlySet<LiveCopyErrorCode> = new Set([
  "build_refused",
  "build_failed",
  "derive_refused",
  "derive_failed",
  "malformed_state",
  "unsupported_content",
  "state_too_large",
  "version_conflict",
]);

async function readPage(
  documentId: string,
): Promise<BackfillPageRow | undefined> {
  // guard:allow-unscoped — the editor's open checked access, and the sweep acts for each page's owner; this reads only write-path columns.
  const [page] = await getDb()
    .select({
      ...liveBodyWriterPageColumns(),
      trashedAt: schema.documents.trashedAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  return page;
}

function conversionRefusal(error: unknown): LiveBodyBackfillOutcome {
  if (error instanceof LiveBodyConversionError) {
    switch (error.code) {
      case "flag_off":
        return { status: "skipped", reason: "flag_off" };
      case "ineligible":
        if (!error.blockers) throw error;
        return {
          status: "skipped",
          reason: "ineligible",
          blockers: error.blockers,
        };
      case "live_edits":
      case "rebaseline_blocked":
      case "base_changed":
        return { status: "deferred", reason: error.code };
    }
  }
  if (
    error instanceof LiveCopyError &&
    DEFERRED_LIVE_COPY_CODES.has(error.code)
  ) {
    return {
      status: "deferred",
      reason: "live_copy_refused",
      code: error.code,
      ...(error.reason ? { detail: error.reason } : {}),
    };
  }
  throw error;
}

/**
 * Switches page `documentId` to its live copy when its owner has the backfill
 * flags on and every writer that reaches it can write through the copy. A
 * live copy holding text the stored body lacks defers the page instead of
 * losing that text. The caller checks access first.
 */
export async function convertPageToLiveCopyIfDue(
  documentId: string,
  options: { ctx?: ActionRunContext; flagsOn?: FlagsOn } = {},
): Promise<LiveBodyBackfillOutcome> {
  // An editor opens a page through here, so while no one has the flag on,
  // that costs one settings read rather than the page's own flag reads.
  if (!(await hasActiveFeatureFlagRollout(LIVE_BODY_BACKFILL_FLAG.key))) {
    return { status: "skipped", reason: "flag_off" };
  }
  const page = await readPage(documentId);
  if (!page) return { status: "skipped", reason: "no_page" };
  if (page.trashedAt) return { status: "skipped", reason: "trashed" };
  if (!(await (options.flagsOn ?? liveBodyBackfillFlagsOn)(page))) {
    return { status: "skipped", reason: "flag_off" };
  }
  if ((await liveBodyWriterGateForRow(page)).writePath === "live_copy") {
    return { status: "current" };
  }
  // Before the switch, which refuses a page some source owns with that
  // source's own error.
  const blockers = await liveBodySwitchBlockers(getDbExec(), documentId);
  if (blockers === undefined) return { status: "skipped", reason: "no_page" };
  if (blockers.length > 0) {
    return { status: "skipped", reason: "ineligible", blockers };
  }
  let gate;
  try {
    gate = await switchPageToLiveCopy(documentId, {
      ctx: options.ctx,
      keepLiveEdits: true,
    });
  } catch (error) {
    return conversionRefusal(error);
  }
  return gate.writePath === "live_copy"
    ? { status: "converted" }
    : { status: "deferred", reason: "gate_moved", gate: gate.reason };
}

export const LIVE_BODY_BACKFILL_SWEEP_ID = "content-live-body-backfill";

const SWEEP_STATE_KEY = "content-live-body-backfill-sweep";
// Pages read per sweep, in id order. The sweep reads no more than this, so a
// pass over a large table takes many sweeps rather than one long query.
const SCAN_BATCH = 200;
const CONVERSIONS_PER_SWEEP = 25;
// A page saved this recently may still have a tab's save in flight.
const IDLE_MS = 10 * 60_000;
// After a full pass, the sweep rests this long before starting another.
const PASS_REST_MS = 60 * 60_000;
// Leaves room for one conversion's worker deadline before the sweep's own.
const DEADLINE_MARGIN_MS = 15_000;

interface SweepState {
  version: 1;
  /** The last page id the pass reached; null at the start of a pass. */
  after: string | null;
  passCompletedAt: string | null;
}

function parseSweepState(value: Record<string, unknown> | null): SweepState {
  if (value === null) return { version: 1, after: null, passCompletedAt: null };
  const { version, after, passCompletedAt } = value;
  if (
    version !== 1 ||
    (after !== null && typeof after !== "string") ||
    (passCompletedAt !== null &&
      (typeof passCompletedAt !== "string" ||
        Number.isNaN(Date.parse(passCompletedAt))))
  ) {
    throw new Error(
      `The live-body backfill's sweep state is unreadable: ${JSON.stringify(value)}.`,
    );
  }
  return { version: 1, after, passCompletedAt };
}

export type LiveBodyBackfillSweepReport =
  /** No organization or user has the backfill flag on. */
  | { status: "off" }
  | { status: "resting"; passCompletedAt: string }
  | {
      status: "ran";
      scanned: number;
      /** Pages the sweep read but didn't try: switched, in Trash, ineligible, recently saved. */
      passedOver: number;
      outcomes: Record<string, number>;
      failed: Array<{ documentId: string; error: string }>;
      after: string | null;
      passComplete: boolean;
      stoppedEarly: "deadline" | "aborted" | "conversions" | null;
    };

function outcomeKey(outcome: LiveBodyBackfillOutcome): string {
  if (outcome.status === "converted" || outcome.status === "current")
    return outcome.status;
  if (outcome.status === "deferred" && outcome.reason === "live_copy_refused")
    return `deferred:live_copy_refused:${outcome.code}`;
  return `${outcome.status}:${outcome.reason}`;
}

/**
 * One sweep of the backfill: reads the next pages in id order and switches
 * the idle, eligible ones whose owner has the backfill flags on. Resumes where
 * the last sweep stopped, and rests after a full pass. A page that throws is
 * listed in `failed` and logged, and the sweep goes on to the next.
 */
export async function runLiveBodyBackfillSweep(context: {
  deadlineAt: number;
  signal?: AbortSignal;
  now?: number;
}): Promise<LiveBodyBackfillSweepReport> {
  if (!(await hasActiveFeatureFlagRollout(LIVE_BODY_BACKFILL_FLAG.key))) {
    return { status: "off" };
  }
  const now = context.now ?? Date.now();
  const state = parseSweepState(await getSetting(SWEEP_STATE_KEY));
  if (
    state.after === null &&
    state.passCompletedAt !== null &&
    now - Date.parse(state.passCompletedAt) < PASS_REST_MS
  ) {
    return { status: "resting", passCompletedAt: state.passCompletedAt };
  }

  // guard:allow-unscoped — the sweep acts for each page's owner, gated by that owner's flags; it reads write-path columns only.
  const pages = await getDb()
    .select({
      ...liveBodyWriterPageColumns(),
      trashedAt: schema.documents.trashedAt,
      updatedAt: schema.documents.updatedAt,
      eligible:
        sql<number>`CASE WHEN ${liveBodySwitchEligibleSql()} THEN 1 ELSE 0 END`.as(
          "eligible",
        ),
    })
    .from(schema.documents)
    .where(
      state.after === null ? undefined : gt(schema.documents.id, state.after),
    )
    .orderBy(asc(schema.documents.id))
    .limit(SCAN_BATCH);

  const flagsByScope = new Map<string, Promise<boolean>>();
  const flagsOn: FlagsOn = (page) => {
    const scope = JSON.stringify([page.ownerEmail, page.orgId]);
    let on = flagsByScope.get(scope);
    if (!on) {
      on = liveBodyBackfillFlagsOn(page);
      flagsByScope.set(scope, on);
    }
    return on;
  };
  const idleBefore = now - IDLE_MS;
  const outcomes: Record<string, number> = {};
  const failed: Array<{ documentId: string; error: string }> = [];
  let passedOver = 0;
  let conversions = 0;
  let reached: string | null = state.after;
  let stoppedEarly: "deadline" | "aborted" | "conversions" | null = null;

  for (const page of pages) {
    if (context.signal?.aborted) {
      stoppedEarly = "aborted";
      break;
    }
    if (Date.now() >= context.deadlineAt - DEADLINE_MARGIN_MS) {
      stoppedEarly = "deadline";
      break;
    }
    if (conversions >= CONVERSIONS_PER_SWEEP) {
      stoppedEarly = "conversions";
      break;
    }
    reached = page.id;
    const eligible = Number(page.eligible);
    if (eligible !== 0 && eligible !== 1) {
      throw new Error(
        `Page ${page.id}'s eligibility check answered ${String(page.eligible)}.`,
      );
    }
    const updatedAt = Date.parse(page.updatedAt);
    if (
      page.trashedAt ||
      eligible === 0 ||
      (page.liveBodySwitchedAt &&
        page.collabBodyRevision === page.bodyRevision) ||
      !(updatedAt < idleBefore)
    ) {
      passedOver += 1;
      continue;
    }
    try {
      if (!(await flagsOn(page))) {
        outcomes["skipped:flag_off"] = (outcomes["skipped:flag_off"] ?? 0) + 1;
        continue;
      }
      const outcome = await convertPageToLiveCopyIfDue(page.id, { flagsOn });
      const key = outcomeKey(outcome);
      outcomes[key] = (outcomes[key] ?? 0) + 1;
      if (outcome.status === "converted") conversions += 1;
    } catch (error) {
      failed.push({
        documentId: page.id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(
        `[${LIVE_BODY_BACKFILL_SWEEP_ID}] page ${page.id} failed:`,
        error,
      );
    }
  }

  const passComplete = stoppedEarly === null && pages.length < SCAN_BATCH;
  await putSetting(SWEEP_STATE_KEY, {
    version: 1,
    after: passComplete ? null : reached,
    passCompletedAt: passComplete
      ? new Date(now).toISOString()
      : state.passCompletedAt,
  } satisfies SweepState);
  const report: LiveBodyBackfillSweepReport = {
    status: "ran",
    scanned: pages.length,
    passedOver,
    outcomes,
    failed,
    after: passComplete ? null : reached,
    passComplete,
    stoppedEarly,
  };
  console.info(`[${LIVE_BODY_BACKFILL_SWEEP_ID}] ${JSON.stringify(report)}`);
  return report;
}
