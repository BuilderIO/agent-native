import { randomUUID } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import {
  LiveCopyError,
  type LiveCopyErrorCode,
} from "@agent-native/core/collab";
import { getDbExec } from "@agent-native/core/db";
import { hasActiveFeatureFlagRollout } from "@agent-native/core/feature-flags";
import { recordChange } from "@agent-native/core/server";
import { mutateSetting } from "@agent-native/core/settings";
import { asc, eq, gt, inArray, sql } from "drizzle-orm";

import { LIVE_BODY_BACKFILL_FLAG } from "../../shared/feature-flags.js";
import { getDb, schema } from "../db/index.js";
import { documentChangeResource } from "../lib/document-change-resource.js";
import {
  isLinkedToLocalFile,
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
// switch. An editor that has loaded a page it can edit asks for it through
// `convert-page-to-live-copy-if-due`, and a recurring sweep switches idle
// pages. Each switch is
// `switchPageToLiveCopy`'s conversion: History checkpoint, body revision,
// pending suggestions and comment quotes re-baselined, live copy seeded or
// matched. Neither path runs at cold start.

export type LiveBodyBackfillOutcome =
  | { status: "converted" }
  /** Already takes body writes through its live copy. */
  | { status: "current" }
  | {
      status: "skipped";
      reason: "no_page" | "trashed" | "flag_off" | "local_file" | "opted_out";
    }
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

type BackfillPageRow = LiveBodyWriterPageRow & {
  trashedAt: string | null;
  liveBodyOptedOutAt: string | null;
};

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
  // guard:allow-unscoped — convert-page-to-live-copy-if-due checks editor access, and the sweep acts for each page's owner; this reads only write-path columns.
  const [page] = await getDb()
    .select({
      ...liveBodyWriterPageColumns(),
      trashedAt: schema.documents.trashedAt,
      liveBodyOptedOutAt: schema.documents.liveBodyOptedOutAt,
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
      case "local_file":
      case "opted_out":
        return { status: "skipped", reason: error.code };
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
  // While no one has the flag on, a call costs one settings read rather than
  // the page's own flag reads.
  if (!(await hasActiveFeatureFlagRollout(LIVE_BODY_BACKFILL_FLAG.key))) {
    return { status: "skipped", reason: "flag_off" };
  }
  const page = await readPage(documentId);
  if (!page) return { status: "skipped", reason: "no_page" };
  if (page.trashedAt) return { status: "skipped", reason: "trashed" };
  if (page.liveBodyOptedOutAt) {
    return { status: "skipped", reason: "opted_out" };
  }
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
      unlessOptedOut: true,
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
// Pages tried per sweep. Each try writes the sweep state before and after it.
const ATTEMPTS_PER_SWEEP = 25;
// A page saved this recently may still have a tab's save in flight.
const IDLE_MS = 10 * 60_000;
// After a full pass, the sweep rests this long before starting another.
const PASS_REST_MS = 60 * 60_000;
// Leaves room for one conversion's worker deadline before the sweep's own.
const DEADLINE_MARGIN_MS = 15_000;
// A held page waits this long for its next try, twice as long after each
// failure, up to HOLD_MAX_MS.
const HOLD_BASE_MS = 60 * 60_000;
const HOLD_MAX_MS = 24 * 60 * 60_000;
// More held pages than this is a bug to fix. The sweep goes past a page that
// fails beyond it without holding it, and counts it in `overHoldLimit`.
const HELD_LIMIT = 100;
const HELD_ERROR_LENGTH = 500;

type HeldPage = {
  reason:
    | "failed"
    /** The sweep trying it stopped before it finished: killed or out of time. */
    | "interrupted";
  error: string | null;
  attempts: number;
  retryAfter: string;
};

type SweepState = {
  version: 2;
  /** The last page id the pass finished; null at the start of a pass. */
  after: string | null;
  passCompletedAt: string | null;
  /** The sweep running now. Another sweep waits until its lease ends. */
  run: { id: string; leaseUntil: string } | null;
  /** The page that sweep is trying. Still set once its lease ends, that sweep died on it. */
  inFlight: { documentId: string; startedAt: string } | null;
  /** Pages the sweep passes over until their `retryAfter`. */
  held: Record<string, HeldPage>;
  /**
   * Pages this pass went past after a failure without holding them, because
   * HELD_LIMIT pages were held already. Kept until the next pass starts.
   */
  overHoldLimit: OverHoldLimit | null;
};

type OverHoldLimit = {
  pages: number;
  lastDocumentId: string;
  lastError: string;
};

class SweepStateUnreadable extends Error {
  constructor(value: unknown) {
    super(
      `The live-body backfill's sweep state is unreadable: ${JSON.stringify(value)}.`,
    );
  }
}

/** Another sweep took the pass over once this one's lease ended. */
class SweepLeaseLost extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function parseHeldPage(value: unknown): HeldPage | undefined {
  if (!isRecord(value)) return undefined;
  const { reason, error, attempts, retryAfter } = value;
  if (
    (reason !== "failed" && reason !== "interrupted") ||
    (error !== null && typeof error !== "string") ||
    typeof attempts !== "number" ||
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    !isTime(retryAfter)
  ) {
    return undefined;
  }
  return { reason, error, attempts, retryAfter };
}

function parseOverHoldLimit(value: unknown): OverHoldLimit | undefined {
  if (!isRecord(value)) return undefined;
  const { pages, lastDocumentId, lastError } = value;
  if (
    typeof pages !== "number" ||
    !Number.isSafeInteger(pages) ||
    pages < 1 ||
    typeof lastDocumentId !== "string" ||
    typeof lastError !== "string"
  ) {
    return undefined;
  }
  return { pages, lastDocumentId, lastError };
}

function parseSweepState(value: Record<string, unknown> | null): SweepState {
  if (value === null) {
    return {
      version: 2,
      after: null,
      passCompletedAt: null,
      run: null,
      inFlight: null,
      held: {},
      overHoldLimit: null,
    };
  }
  const { version, after, passCompletedAt, run, inFlight, held } = value;
  // State saved before this count existed went past no page.
  const overHoldLimit =
    value.overHoldLimit === undefined || value.overHoldLimit === null
      ? null
      : parseOverHoldLimit(value.overHoldLimit);
  if (
    version !== 2 ||
    (after !== null && typeof after !== "string") ||
    (passCompletedAt !== null && !isTime(passCompletedAt)) ||
    (run !== null &&
      !(
        isRecord(run) &&
        typeof run.id === "string" &&
        isTime(run.leaseUntil)
      )) ||
    (inFlight !== null &&
      !(
        isRecord(inFlight) &&
        typeof inFlight.documentId === "string" &&
        isTime(inFlight.startedAt)
      )) ||
    !isRecord(held) ||
    overHoldLimit === undefined
  ) {
    throw new SweepStateUnreadable(value);
  }
  const heldPages: Record<string, HeldPage> = {};
  for (const [documentId, entry] of Object.entries(held)) {
    const heldPage = parseHeldPage(entry);
    if (!heldPage) throw new SweepStateUnreadable(value);
    heldPages[documentId] = heldPage;
  }
  return {
    version: 2,
    after,
    passCompletedAt,
    run:
      run === null
        ? null
        : { id: run.id as string, leaseUntil: run.leaseUntil as string },
    inFlight:
      inFlight === null
        ? null
        : {
            documentId: inFlight.documentId as string,
            startedAt: inFlight.startedAt as string,
          },
    held: heldPages,
    overHoldLimit,
  };
}

function holdPage(
  previous: HeldPage | undefined,
  reason: HeldPage["reason"],
  error: string | null,
  now: number,
): HeldPage {
  const attempts = (previous?.attempts ?? 0) + 1;
  const wait = Math.min(HOLD_BASE_MS * 2 ** (attempts - 1), HOLD_MAX_MS);
  return {
    reason,
    error,
    attempts,
    retryAfter: new Date(now + wait).toISOString(),
  };
}

// A held page that was deleted would keep its place for good.
async function dropDeletedPages(held: Record<string, HeldPage>) {
  const ids = Object.keys(held);
  if (ids.length === 0) return;
  // guard:allow-unscoped — reads only which held page ids still exist.
  const rows = await getDb()
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(inArray(schema.documents.id, ids));
  const existing = new Set(rows.map((row) => row.id));
  for (const id of ids) {
    if (!existing.has(id)) delete held[id];
  }
}

export type LiveBodyBackfillSweepReport =
  /** No organization or user has the backfill flag on. */
  | { status: "off" }
  | { status: "resting"; passCompletedAt: string }
  /** Another sweep holds the pass until its lease ends. */
  | { status: "busy"; leaseUntil: string }
  | {
      status: "ran";
      scanned: number;
      /** Pages the sweep read but didn't try: switched, sent back to legacy, in Trash, ineligible, linked to a local file, recently saved. */
      passedOver: number;
      /** Pages passed over because they're held until a later try. */
      held: number;
      /** The page the last sweep died on, held from now on. */
      interrupted: string | null;
      outcomes: Record<string, number>;
      failed: Array<{ documentId: string; error: string }>;
      after: string | null;
      passComplete: boolean;
      /** This pass's count so far of pages it went past without holding them. */
      overHoldLimit: OverHoldLimit | null;
      stoppedEarly: "deadline" | "aborted" | "attempts" | "lease_lost" | null;
    };

type SweepStop = Extract<
  LiveBodyBackfillSweepReport,
  { status: "ran" }
>["stoppedEarly"];

/**
 * Sends the change event a body save sends, for the page and each collection
 * that lists it, so open pages and collection views read it again. The sweep
 * runs outside any action, so nothing else sends one.
 */
async function announceConversion(page: { id: string; ownerEmail: string }) {
  // guard:allow-unscoped — lists the collections of a page the sweep just switched for its owner.
  const collections = await getDb()
    .select({ documentId: schema.contentDatabases.documentId })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(eq(schema.contentDatabaseItems.documentId, page.id));
  for (const documentId of new Set([
    page.id,
    ...collections.map((row) => row.documentId),
  ])) {
    recordChange({
      source: "action",
      type: "change",
      key: "convert-page-to-live-copy-if-due",
      owner: page.ownerEmail,
      ...documentChangeResource(documentId),
    });
  }
}

function outcomeKey(outcome: LiveBodyBackfillOutcome): string {
  if (outcome.status === "converted" || outcome.status === "current")
    return outcome.status;
  if (outcome.status === "deferred" && outcome.reason === "live_copy_refused")
    return `deferred:live_copy_refused:${outcome.code}`;
  return `${outcome.status}:${outcome.reason}`;
}

/**
 * One sweep of the backfill: reads the next pages in id order and switches
 * the idle, eligible ones whose owner has the backfill flags on. Resumes after
 * the last page a sweep finished, and rests after a full pass. Before each
 * try it records the page it is about to try, so a sweep that dies there
 * leaves that page for the next sweep to hold. A page that throws is listed
 * in `failed`, logged and held, and the sweep goes on to the next; once
 * HELD_LIMIT pages are held, it is counted as `hold_limit` instead of held.
 */
export async function runLiveBodyBackfillSweep(context: {
  deadlineAt: number;
  signal?: AbortSignal;
  now?: number;
  convert?: typeof convertPageToLiveCopyIfDue;
}): Promise<LiveBodyBackfillSweepReport> {
  if (!(await hasActiveFeatureFlagRollout(LIVE_BODY_BACKFILL_FLAG.key))) {
    return { status: "off" };
  }
  const now = context.now ?? Date.now();
  const runId = randomUUID();
  type Claim =
    | { status: "busy"; leaseUntil: string }
    | { status: "resting"; passCompletedAt: string }
    | { status: "claimed"; state: SweepState; interrupted: string | null };
  let claim = undefined as Claim | undefined;
  // Core starts the sweep on every site tick without waiting for the last
  // one, so two sweeps can overlap; the lease keeps them off one pass.
  await mutateSetting(SWEEP_STATE_KEY, (current) => {
    const state = parseSweepState(current);
    if (state.run && Date.parse(state.run.leaseUntil) > now) {
      claim = { status: "busy", leaseUntil: state.run.leaseUntil };
      return state;
    }
    if (
      state.after === null &&
      state.inFlight === null &&
      state.passCompletedAt !== null &&
      now - Date.parse(state.passCompletedAt) < PASS_REST_MS
    ) {
      claim = { status: "resting", passCompletedAt: state.passCompletedAt };
      return state;
    }
    const held = { ...state.held };
    const interrupted = state.inFlight?.documentId ?? null;
    if (interrupted !== null) {
      held[interrupted] = holdPage(held[interrupted], "interrupted", null, now);
    }
    const claimed: SweepState = {
      ...state,
      overHoldLimit:
        state.after === null && state.inFlight === null
          ? null
          : state.overHoldLimit,
      run: {
        id: runId,
        leaseUntil: new Date(context.deadlineAt).toISOString(),
      },
      inFlight: null,
      held,
    };
    claim = { status: "claimed", state: claimed, interrupted };
    return claimed;
  });
  if (!claim) throw new Error("The backfill sweep's claim recorded no answer.");
  if (claim.status !== "claimed") return claim;
  const { state, interrupted } = claim;
  const held = { ...state.held };
  let overHoldLimit = state.overHoldLimit;
  const save = (next: Omit<SweepState, "version" | "held" | "overHoldLimit">) =>
    mutateSetting(SWEEP_STATE_KEY, (current) => {
      if (parseSweepState(current).run?.id !== runId) {
        throw new SweepLeaseLost();
      }
      return {
        version: 2,
        ...next,
        held: { ...held },
        overHoldLimit,
      } satisfies SweepState;
    });

  // guard:allow-unscoped — the sweep acts for each page's owner, gated by that owner's flags; it reads write-path columns only.
  const pages = await getDb()
    .select({
      ...liveBodyWriterPageColumns(),
      trashedAt: schema.documents.trashedAt,
      liveBodyOptedOutAt: schema.documents.liveBodyOptedOutAt,
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
  const convert = context.convert ?? convertPageToLiveCopyIfDue;
  const idleBefore = now - IDLE_MS;
  const outcomes: Record<string, number> = {};
  const failed: Array<{ documentId: string; error: string }> = [];
  let passedOver = 0;
  let heldOver = 0;
  let attempts = 0;
  let reached: string | null = state.after;
  let stoppedEarly: SweepStop = null;
  // Saves the last page reached and the one being tried. False when another
  // sweep took the lease, which stops this one.
  const saveProgress = async (inFlight: SweepState["inFlight"]) => {
    try {
      await save({
        after: reached,
        passCompletedAt: state.passCompletedAt,
        run: state.run,
        inFlight,
      });
      return true;
    } catch (error) {
      if (!(error instanceof SweepLeaseLost)) throw error;
      return false;
    }
  };
  // Lists and holds a page that threw. Once HELD_LIMIT pages are held, it
  // counts the page instead, so the pass still goes past it.
  const recordFailure = (documentId: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    failed.push({ documentId, error: message });
    console.error(
      `[${LIVE_BODY_BACKFILL_SWEEP_ID}] page ${documentId} failed:`,
      error,
    );
    if (!held[documentId] && Object.keys(held).length >= HELD_LIMIT) {
      outcomes.hold_limit = (outcomes.hold_limit ?? 0) + 1;
      overHoldLimit = {
        pages: (overHoldLimit?.pages ?? 0) + 1,
        lastDocumentId: documentId,
        lastError: message.slice(0, HELD_ERROR_LENGTH),
      };
      console.error(
        `[${LIVE_BODY_BACKFILL_SWEEP_ID}] ${HELD_LIMIT} pages are held already, so page ${documentId} is passed without being held; this pass has passed ${overHoldLimit.pages} that way.`,
      );
      return;
    }
    held[documentId] = holdPage(
      held[documentId],
      "failed",
      message.slice(0, HELD_ERROR_LENGTH),
      now,
    );
  };

  for (const page of pages) {
    if (context.signal?.aborted) {
      stoppedEarly = "aborted";
      break;
    }
    if (Date.now() >= context.deadlineAt - DEADLINE_MARGIN_MS) {
      stoppedEarly = "deadline";
      break;
    }
    if (attempts >= ATTEMPTS_PER_SWEEP) {
      stoppedEarly = "attempts";
      break;
    }
    const eligible = Number(page.eligible);
    if (eligible !== 0 && eligible !== 1) {
      throw new Error(
        `Page ${page.id}'s eligibility check answered ${String(page.eligible)}.`,
      );
    }
    if (
      page.trashedAt ||
      page.liveBodyOptedOutAt ||
      eligible === 0 ||
      isLinkedToLocalFile(page) ||
      (page.liveBodySwitchedAt && page.collabBodyRevision === page.bodyRevision)
    ) {
      // Nothing is left to try on it, so nothing is left to hold.
      delete held[page.id];
      passedOver += 1;
      reached = page.id;
      continue;
    }
    if (!(Date.parse(page.updatedAt) < idleBefore)) {
      passedOver += 1;
      reached = page.id;
      continue;
    }
    const heldPage = held[page.id];
    if (heldPage && Date.parse(heldPage.retryAfter) > now) {
      heldOver += 1;
      reached = page.id;
      continue;
    }
    let pageFlagsOn: boolean;
    try {
      pageFlagsOn = await flagsOn(page);
    } catch (error) {
      recordFailure(page.id, error);
      reached = page.id;
      continue;
    }
    if (!pageFlagsOn) {
      outcomes["skipped:flag_off"] = (outcomes["skipped:flag_off"] ?? 0) + 1;
      reached = page.id;
      continue;
    }
    attempts += 1;
    if (
      !(await saveProgress({
        documentId: page.id,
        startedAt: new Date().toISOString(),
      }))
    ) {
      stoppedEarly = "lease_lost";
      break;
    }
    let converted = false;
    try {
      const outcome = await convert(page.id, { flagsOn });
      const key = outcomeKey(outcome);
      outcomes[key] = (outcomes[key] ?? 0) + 1;
      delete held[page.id];
      converted = outcome.status === "converted";
    } catch (error) {
      recordFailure(page.id, error);
    }
    if (converted) {
      try {
        await announceConversion(page);
      } catch (error) {
        // The switch committed, so the page isn't held; its open views stay
        // stale until they read it again.
        outcomes.change_event_failed = (outcomes.change_event_failed ?? 0) + 1;
        console.error(
          `[${LIVE_BODY_BACKFILL_SWEEP_ID}] page ${page.id} switched, but its change event failed:`,
          error,
        );
      }
    }
    reached = page.id;
    // Before the pages after it, so a sweep that dies among them doesn't
    // hold this one as interrupted.
    if (!(await saveProgress(null))) {
      stoppedEarly = "lease_lost";
      break;
    }
  }

  let passComplete = stoppedEarly === null && pages.length < SCAN_BATCH;
  if (stoppedEarly !== "lease_lost") {
    if (passComplete) await dropDeletedPages(held);
    try {
      await save({
        after: passComplete ? null : reached,
        passCompletedAt: passComplete
          ? new Date(now).toISOString()
          : state.passCompletedAt,
        run: null,
        inFlight: null,
      });
    } catch (error) {
      if (!(error instanceof SweepLeaseLost)) throw error;
      stoppedEarly = "lease_lost";
      passComplete = false;
    }
  }
  const report: LiveBodyBackfillSweepReport = {
    status: "ran",
    scanned: pages.length,
    passedOver,
    held: heldOver,
    interrupted,
    outcomes,
    failed,
    after: passComplete ? null : reached,
    passComplete,
    overHoldLimit,
    stoppedEarly,
  };
  console.info(`[${LIVE_BODY_BACKFILL_SWEEP_ID}] ${JSON.stringify(report)}`);
  return report;
}
