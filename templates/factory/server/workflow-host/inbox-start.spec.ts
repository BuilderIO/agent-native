import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

import { triageItems } from "../db/schema.js";
import { previewRowOf } from "../lib/factory-poll-start.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import type { InboxRequest, WorkflowScope } from "../workflow/adapter.js";
import { decodeStart, encodeStart } from "./inbox-start.js";
import {
  createInboxHost,
  type GuardedActionCall,
  type GuardedActionCaller,
  type GuardedActionResult,
} from "./inbox.js";

// Where an inbox source starts, as the host reads it: the saved position and
// the instant the source started, what the poller is asked for in each mode, and
// which rows the source may offer.

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

/** The entry at `index`, or a loud failure: a test reads what it expects to be there. */
function nth<T>(list: readonly T[], index: number): T {
  const found = list.find((_, at) => at === index);
  if (found === undefined) throw new Error(`There is no entry ${index}.`);
  return found;
}

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "factory-1" };
const OWNER = "owner@example.test";
const WORKFLOW = "wf-1";
const STARTED = "2026-10-18T10:00:00.000Z";
const BEFORE = "2026-10-18T09:00:00.000Z";
const AFTER = "2026-10-18T10:05:00.000Z";
const NOW = "2026-10-18T10:10:00.000Z";

let sharedClient: PGliteClient | undefined;

async function emptyClient(): Promise<PGliteClient> {
  if (!sharedClient) {
    sharedClient = await PGlite.create("memory://");
    for (const migration of factoryMigrations) {
      if (typeof migration.sql === "string") {
        await sharedClient.exec(migration.sql);
      }
    }
  }
  await sharedClient.exec(
    "TRUNCATE factory_items, factory_workflow_item_state",
  );
  return sharedClient;
}

afterAll(async () => {
  await sharedClient?.close();
  sharedClient = undefined;
});

let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  db = drizzle(await emptyClient());
});

async function insertRow(id: string, createdAt: string, channelId = "C1") {
  await db.insert(triageItems).values({
    id,
    source: "slack",
    externalId: id,
    title: `Item ${id}`,
    status: "received",
    coverage: "complete",
    channelId,
    threadTs: "1760781600.000100",
    dedupeKey: id,
    metadataJson: JSON.stringify({
      messageTs: "1760781600.000100",
      authorId: "U111",
    }),
    createdAt,
    updatedAt: createdAt,
    ownerEmail: OWNER,
    orgId: SCOPE.orgId,
    factoryId: SCOPE.factoryId,
  });
}

/** A poller that records what it was asked and answers from a script. */
function poller(
  respond: (call: GuardedActionCall) => Record<string, unknown>,
): GuardedActionCaller & { calls: GuardedActionCall[] } {
  const calls: GuardedActionCall[] = [];
  const caller = (async (
    call: GuardedActionCall,
  ): Promise<GuardedActionResult> => {
    calls.push(call);
    const answer = respond(call);
    // The real poll action says how many own posts it left out whenever it was asked to.
    return {
      status: "completed",
      output: JSON.stringify(
        call.input.skipOwnPosts === true && !("skippedOwn" in answer)
          ? { ...answer, skippedOwn: 0 }
          : answer,
      ),
    };
  }) as GuardedActionCaller & { calls: GuardedActionCall[] };
  caller.calls = calls;
  return caller;
}

const host = (callAction: GuardedActionCaller) =>
  createInboxHost({
    scope: SCOPE,
    workflowId: WORKFLOW,
    getDatabase: () => db,
    callAction,
    clock: () => new Date(NOW),
  });

const slackRequest = (
  extra: Partial<InboxRequest> = {},
  scopes: string[] = ["C1"],
): InboxRequest => ({
  settings: {
    source: "inbox-poll",
    poller: "slack",
    takeLimit: 5,
    filter: { scopes },
  },
  mode: "live",
  signal: new AbortController().signal,
  ...extra,
});

const saved = (position = "1760000000.000100", scope = "C1") =>
  encodeStart({ scope, position, since: STARTED });

/** The row a Slack poll would have stored, as a preview carries it. */
const sampleRow = (id: string, ts: string) =>
  previewRowOf({
    id,
    source: "slack",
    externalId: `C1:${ts}`,
    title: `Sample ${id}`,
    summary: `message ${ts}`,
    channelId: "C1",
    threadTs: ts,
    dedupeKey: id,
    metadataJson: JSON.stringify({ messageTs: ts, authorId: "U1" }),
    ownerEmail: OWNER,
    orgId: SCOPE.orgId,
    factoryId: SCOPE.factoryId,
    createdAt: NOW,
    updatedAt: NOW,
    coverage: "complete",
  });

describe("a source's first live read", () => {
  it("asks the poller for the newest position only, offers nothing, and answers with the position and the instant it started", async () => {
    await insertRow("old-1", BEFORE);
    await insertRow("old-2", BEFORE);
    const caller = poller(() => ({
      ok: true,
      observed: 0,
      primed: true,
      position: "1760000200.000100",
    }));

    const taken = await host(caller).take(
      slackRequest({ start: { kind: "prime" } }),
    );

    expect(nth(caller.calls, 0).input).toEqual({
      factoryId: "factory-1",
      channelId: "C1",
      skipOwnPosts: true,
      prime: true,
    });
    if (!taken.ok) throw new Error(taken.message);
    expect(taken).toMatchObject({ items: [], primed: true });
    const decoded = decodeStart(taken.position ?? "");
    if (!decoded.ok) throw new Error(decoded.message);
    expect(decoded.start).toEqual({
      v: 1,
      scope: "C1",
      position: "1760000200.000100",
      since: NOW,
    });
  });

  it("fails, and does not start from a guess, when the poller does not say where the source stands", async () => {
    const caller = poller(() => ({ ok: true, observed: 0 }));

    const taken = await host(caller).take(
      slackRequest({ start: { kind: "prime" } }),
    );

    expect(taken).toMatchObject({
      ok: false,
      code: "provider_error",
      retryable: true,
    });
    if (taken.ok) throw new Error("expected a failure");
    expect(taken.message).toContain("position_missing");
  });

  it("starts over when the source now reads another place than the position was saved for", async () => {
    const caller = poller(() => ({
      ok: true,
      observed: 0,
      primed: true,
      position: "1760000300.000100",
    }));

    const taken = await host(caller).take(
      slackRequest(
        { start: { kind: "from", position: saved("1760000000.000100", "C1") } },
        ["C2"],
      ),
    );

    expect(nth(caller.calls, 0).input).toMatchObject({
      channelId: "C2",
      prime: true,
    });
    expect(nth(caller.calls, 0).input).not.toHaveProperty("after");
    expect(taken).toMatchObject({ ok: true, items: [], primed: true });
  });
});

describe("a source that has a position", () => {
  it("goes on after it, offers only rows stored after it started, and answers with where the read left off", async () => {
    // What a dry run under the old code left behind, and what the channel held.
    for (let n = 0; n < 25; n += 1) await insertRow(`old-${n}`, BEFORE);
    await insertRow("new-1", AFTER);
    const caller = poller(() => ({
      ok: true,
      observed: 1,
      position: "1760000500.000100",
    }));

    const taken = await host(caller).take(
      slackRequest({ start: { kind: "from", position: saved() } }),
    );

    expect(nth(caller.calls, 0).input).toEqual({
      factoryId: "factory-1",
      channelId: "C1",
      skipOwnPosts: true,
      after: "1760000000.000100",
    });
    if (!taken.ok) throw new Error(taken.message);
    expect(taken.items.map((item) => item.id)).toEqual(["new-1"]);
    expect(taken.totalAvailable).toBe(1);
    const decoded = decodeStart(taken.position ?? "");
    if (!decoded.ok) throw new Error(decoded.message);
    expect(decoded.start).toMatchObject({
      scope: "C1",
      position: "1760000500.000100",
      since: STARTED,
    });
  });

  it("fails when the poller does not say where the read left off, instead of keeping an old position as if it had", async () => {
    const caller = poller(() => ({ ok: true, observed: 0 }));

    const taken = await host(caller).take(
      slackRequest({ start: { kind: "from", position: saved() } }),
    );

    expect(taken).toMatchObject({ ok: false, code: "provider_error" });
  });

  it("refuses a saved position it cannot read, and does not start over from now", async () => {
    const caller = poller(() => ({ ok: true, observed: 0, primed: true }));

    const taken = await host(caller).take(
      slackRequest({ start: { kind: "from", position: "{not json" } }),
    );

    expect(caller.calls).toEqual([]);
    expect(taken).toMatchObject({
      ok: false,
      code: "engine_error",
      retryable: false,
    });
    if (taken.ok) throw new Error("expected a failure");
    expect(taken.message).toContain("position_unreadable");
  });
});

describe("a source that keeps no position", () => {
  it("polls with the arguments it always had and offers every row of the queue", async () => {
    await insertRow("old-1", BEFORE);
    const caller = poller(() => ({ ok: true, observed: 1 }));

    const taken = await host(caller).take(slackRequest());

    expect(nth(caller.calls, 0).input).toEqual({
      factoryId: "factory-1",
      channelId: "C1",
      skipOwnPosts: true,
    });
    if (!taken.ok) throw new Error(taken.message);
    expect(taken.items.map((item) => item.id)).toEqual(["old-1"]);
    expect(taken).not.toHaveProperty("position");
  });
});

describe("a dry or test read", () => {
  it("asks for a preview, shows the sample newest first with the rows after the start, and reports a sample", async () => {
    await insertRow("old-1", BEFORE);
    await insertRow("queued-1", AFTER);
    const caller = poller(() => ({
      ok: true,
      observed: 2,
      preview: true,
      previewRows: [
        sampleRow("s-old", "1760000100.000100"),
        sampleRow("s-new", "1760000200.000100"),
      ],
      previewTotal: 2,
    }));

    const taken = await host(caller).take(
      slackRequest({
        mode: "dry",
        start: { kind: "from", position: saved() },
      }),
    );

    expect(nth(caller.calls, 0).input).toEqual({
      factoryId: "factory-1",
      channelId: "C1",
      skipOwnPosts: true,
      after: "1760000000.000100",
      preview: true,
    });
    if (!taken.ok) throw new Error(taken.message);
    expect(taken.sample).toBe(true);
    expect(taken).not.toHaveProperty("position");
    expect(taken.items.map((item) => item.id)).toEqual([
      "s-new",
      "s-old",
      "queued-1",
    ]);
    // Nothing was stored: the two sample rows are not in the inbox.
    expect(await db.select().from(triageItems)).toHaveLength(2);
  });

  it("shows only the sample for a source with no position yet, which a live read would start from now", async () => {
    await insertRow("old-1", BEFORE);
    const caller = poller(() => ({
      ok: true,
      observed: 1,
      preview: true,
      previewRows: [sampleRow("s-1", "1760000100.000100")],
      previewTotal: 1,
    }));

    const taken = await host(caller).take(
      slackRequest({ mode: "test", start: { kind: "prime" } }),
    );

    expect(nth(caller.calls, 0).input).toEqual({
      factoryId: "factory-1",
      channelId: "C1",
      skipOwnPosts: true,
      prime: true,
      preview: true,
    });
    if (!taken.ok) throw new Error(taken.message);
    expect(taken.items.map((item) => item.id)).toEqual(["s-1"]);
    expect(taken.sample).toBe(true);
  });

  it("previews the old read for a workflow that was already running, and offers its whole queue", async () => {
    await insertRow("old-1", BEFORE);
    const caller = poller(() => ({
      ok: true,
      observed: 0,
      preview: true,
      previewRows: [],
      previewTotal: 0,
    }));

    const taken = await host(caller).take(slackRequest({ mode: "dry" }));

    expect(nth(caller.calls, 0).input).toEqual({
      factoryId: "factory-1",
      channelId: "C1",
      skipOwnPosts: true,
      preview: true,
    });
    if (!taken.ok) throw new Error(taken.message);
    expect(taken.items.map((item) => item.id)).toEqual(["old-1"]);
  });

  it("fails when the poller's preview is not rows it could have stored", async () => {
    const caller = poller(() => ({
      ok: true,
      observed: 1,
      preview: true,
      previewRows: [{ id: "x" }],
    }));

    const taken = await host(caller).take(
      slackRequest({ mode: "dry", start: { kind: "prime" } }),
    );

    expect(taken).toMatchObject({ ok: false, code: "provider_error" });
  });
});
