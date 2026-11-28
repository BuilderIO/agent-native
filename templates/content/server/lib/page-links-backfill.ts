import { randomUUID } from "node:crypto";

import { getSetting, mutateSetting } from "@agent-native/core/settings";
import { asc, eq, gt, like, or, sql } from "drizzle-orm";

import { lockDocumentRows } from "../../actions/_row-lock-order.js";
import { PAGE_LINK_MARKERS } from "../../shared/page-links-in-body.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";
import { pageLinkTargets, writePageLinks } from "./page-links.js";

export const PAGE_LINKS_BACKFILL_SWEEP_ID = "content-page-links-backfill";

export const PAGE_LINKS_BACKFILL_STATE_KEY = "content-page-links-backfill-v1";

const SCAN_BATCH = 100;

const DEADLINE_MARGIN_MS = 10_000;

type BackfillState = {
  version: 1;
  after: string | null;
  doneAt: string | null;
  run: { id: string; leaseUntil: string } | null;
};

export type PageLinksBackfillReport =
  | { status: "done" }
  | { status: "busy"; leaseUntil: string }
  | {
      status: "ran";
      scanned: number;
      indexed: number;
      failed: number;
      finished: boolean;
      stoppedEarly: "deadline" | "aborted" | "lease_lost" | null;
    };

class BackfillLeaseLost extends Error {}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseState(value: Record<string, unknown> | null): BackfillState {
  const run =
    value?.run && typeof value.run === "object"
      ? (value.run as Record<string, unknown>)
      : null;
  const runId = text(run?.id);
  const leaseUntil = text(run?.leaseUntil);
  return {
    version: 1,
    after: text(value?.after),
    doneAt: text(value?.doneAt),
    run: runId && leaseUntil ? { id: runId, leaseUntil } : null,
  };
}

export async function nextPageLinksBackfillDueAt(): Promise<number | null> {
  const state = parseState(await getSetting(PAGE_LINKS_BACKFILL_STATE_KEY));
  if (state.doneAt) return null;
  const now = Date.now();
  const leaseEnds = state.run ? Date.parse(state.run.leaseUntil) : now;
  return Number.isFinite(leaseEnds) && leaseEnds > now ? leaseEnds : now;
}

function mayHoldPageLinksSql() {
  return or(
    ...PAGE_LINK_MARKERS.map((marker) =>
      like(schema.documents.content, `%${marker}%`),
    ),
  );
}

async function indexPage(documentId: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const db = tx as unknown as ReturnType<typeof getDb>;
    const [locked] = await lockDocumentRows(db, [documentId]);
    if (!locked) return false;
    // guard:allow-unscoped — the backfill indexes each page's own links; it reads one body under that page's row lock and stores ids only.
    const page = firstRow(
      await db
        .select({ content: schema.documents.content })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1),
    );
    if (!page) return false;
    await writePageLinks(
      db,
      documentId,
      await pageLinkTargets(db, documentId, page.content),
    );
    return true;
  });
}

export async function runPageLinksBackfillSweep(context: {
  deadlineAt: number;
  signal?: AbortSignal | undefined;
  now?: number;
}): Promise<PageLinksBackfillReport> {
  const now = context.now ?? Date.now();
  const runId = randomUUID();
  const lease = {
    id: runId,
    leaseUntil: new Date(context.deadlineAt).toISOString(),
  };
  type Claim =
    | { status: "done" }
    | { status: "busy"; leaseUntil: string }
    | { status: "claimed"; after: string | null };
  let claim = undefined as Claim | undefined;
  await mutateSetting(PAGE_LINKS_BACKFILL_STATE_KEY, (current) => {
    const state = parseState(current);
    if (state.doneAt) {
      claim = { status: "done" };
      return state;
    }
    if (state.run && Date.parse(state.run.leaseUntil) > now) {
      claim = { status: "busy", leaseUntil: state.run.leaseUntil };
      return state;
    }
    claim = { status: "claimed", after: state.after };
    return { ...state, run: lease } satisfies BackfillState;
  });
  if (!claim)
    throw new Error("The page-links backfill's claim recorded no answer.");
  if (claim.status !== "claimed") return claim;
  const save = (next: Omit<BackfillState, "version">) =>
    mutateSetting(PAGE_LINKS_BACKFILL_STATE_KEY, (current) => {
      if (parseState(current).run?.id !== runId) throw new BackfillLeaseLost();
      return { version: 1, ...next } satisfies BackfillState;
    });

  let after = claim.after;
  let scanned = 0;
  let indexed = 0;
  let failed = 0;
  let finished = false;
  let stoppedEarly: "deadline" | "aborted" | "lease_lost" | null = null;
  while (!finished) {
    if (context.signal?.aborted) {
      stoppedEarly = "aborted";
      break;
    }
    if (Date.now() >= context.deadlineAt - DEADLINE_MARGIN_MS) {
      stoppedEarly = "deadline";
      break;
    }
    // guard:allow-unscoped — the backfill walks every page in id order and reads ids and a yes-or-no only.
    const pages = await getDb()
      .select({
        id: schema.documents.id,
        mayHold:
          sql<number>`CASE WHEN ${mayHoldPageLinksSql()} THEN 1 ELSE 0 END`.as(
            "may_hold",
          ),
      })
      .from(schema.documents)
      .where(after === null ? undefined : gt(schema.documents.id, after))
      .orderBy(asc(schema.documents.id))
      .limit(SCAN_BATCH);
    for (const page of pages) {
      scanned += 1;
      if (Number(page.mayHold) !== 1) continue;
      try {
        if (await indexPage(page.id)) indexed += 1;
      } catch (error) {
        failed += 1;
        console.warn(
          `[${PAGE_LINKS_BACKFILL_SWEEP_ID}] page ${page.id} failed:`,
          error,
        );
      }
    }
    finished = pages.length < SCAN_BATCH;
    after = finished ? null : (firstRow(pages.slice(-1))?.id ?? after);
    try {
      await save({
        after,
        doneAt: finished ? new Date().toISOString() : null,
        run: finished ? null : lease,
      });
    } catch (error) {
      if (!(error instanceof BackfillLeaseLost)) throw error;
      stoppedEarly = "lease_lost";
      break;
    }
  }
  if (!finished && stoppedEarly !== "lease_lost") {
    try {
      await save({ after, doneAt: null, run: null });
    } catch (error) {
      if (!(error instanceof BackfillLeaseLost)) throw error;
      stoppedEarly = "lease_lost";
    }
  }
  const report = {
    status: "ran",
    scanned,
    indexed,
    failed,
    finished,
    stoppedEarly,
  } satisfies PageLinksBackfillReport;
  console.info(`[${PAGE_LINKS_BACKFILL_SWEEP_ID}] ${JSON.stringify(report)}`);
  return report;
}
