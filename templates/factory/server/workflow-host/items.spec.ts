import { createRequire } from "node:module";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

import { triageItems } from "../db/schema.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import {
  hasTriageSourceChanged,
  statusAfterPullRequestPoll,
  statusAfterTriageSourceUpdate,
  triageSourceUpsertGuard,
} from "../triage/review-state.js";
import type { WorkflowScope } from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { NormalizedItem } from "../workflow/items.js";
import { createItemsHost, keepStoredItemIds, queueStatusFor } from "./items.js";
import { mapItems } from "./provider-request.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "factory-1" };
const OWNER = "owner@example.test";
const T0 = "2026-10-18T10:00:00.000Z";
const T1 = "2026-10-18T10:05:00.000Z";

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
  await sharedClient.exec("TRUNCATE factory_items");
  return sharedClient;
}

afterAll(async () => {
  await sharedClient?.close();
  sharedClient = undefined;
});

let client: PGliteClient;
let db: ReturnType<typeof drizzle>;
let clockNow = T1;

beforeEach(async () => {
  client = await emptyClient();
  db = drizzle(client);
  clockNow = T1;
});

function host(scope: WorkflowScope = SCOPE) {
  return createItemsHost({
    scope,
    ownerEmail: OWNER,
    getDatabase: () => db,
    clock: () => new Date(clockNow),
  });
}

async function insertRow(
  id: string,
  overrides: Partial<typeof triageItems.$inferInsert> = {},
) {
  await db.insert(triageItems).values({
    id,
    source: "slack",
    externalId: id,
    title: `Item ${id}`,
    status: "received",
    coverage: "complete",
    dedupeKey: id,
    metadataJson: "{}",
    createdAt: T0,
    updatedAt: T0,
    ownerEmail: OWNER,
    orgId: SCOPE.orgId,
    factoryId: SCOPE.factoryId,
    ...overrides,
  });
}

async function row(id: string) {
  return (
    await db.select().from(triageItems).where(eq(triageItems.id, id)).limit(1)
  )[0];
}

const never = new AbortController().signal;
const request = {
  workflowId: "wf-1",
  runId: "run-1",
};

describe("End outcomes", () => {
  it("done resolves the item", async () => {
    await insertRow("a");

    const result = await host().endItem({
      ...request,
      itemId: "a",
      outcome: "done",
    });

    expect(result).toEqual({
      ok: true,
      itemId: "a",
      status: "resolved",
      previousStatus: "received",
      changed: true,
    });
    expect((await row("a"))?.status).toBe("resolved");
    expect((await row("a"))?.updatedAt).toBe(T1);
  });

  it("dismissed dismisses the item and keeps the reason on it", async () => {
    await insertRow("a");

    await host().endItem({
      ...request,
      itemId: "a",
      outcome: "dismissed",
      reason: "Already fixed in the last release.",
    });

    const stored = await row("a");
    expect(stored?.status).toBe("dismissed");
    expect(JSON.parse(stored?.metadataJson ?? "{}").workflowEnd).toEqual({
      workflowId: "wf-1",
      runId: "run-1",
      status: "dismissed",
      outcome: "dismissed",
      reason: "Already fixed in the last release.",
      at: T1,
    });
  });

  it("needsManual flags the item for a person", async () => {
    await insertRow("a");

    await host().endItem({ ...request, itemId: "a", outcome: "needsManual" });

    expect((await row("a"))?.status).toBe("needs_manual");
  });

  it("writes the status the End node names instead of the outcome's default", async () => {
    await insertRow("a");

    const result = await host().endItem({
      ...request,
      itemId: "a",
      outcome: "done",
      status: "automation_started",
    });

    expect(result).toMatchObject({ ok: true, status: "automation_started" });
    expect((await row("a"))?.status).toBe("automation_started");
  });

  it("released sends an item back to the queue status of its source", async () => {
    await insertRow("slack-item", { status: "needs_manual" });
    await insertRow("pr-item", { source: "github", status: "needs_manual" });

    const slack = await host().endItem({
      ...request,
      itemId: "slack-item",
      outcome: "released",
    });
    const pr = await host().endItem({
      ...request,
      itemId: "pr-item",
      outcome: "released",
    });

    expect(slack).toMatchObject({
      ok: true,
      status: "received",
      changed: true,
    });
    expect(pr).toMatchObject({
      ok: true,
      status: "pr_observed",
      changed: true,
    });
    expect(queueStatusFor("github_issue")).toBe("received");
  });

  it("released leaves an item already in the queue exactly as it was", async () => {
    await insertRow("a");

    const result = await host().endItem({
      ...request,
      itemId: "a",
      outcome: "released",
    });

    expect(result).toMatchObject({ ok: true, changed: false });
    expect((await row("a"))?.updatedAt).toBe(T0);
  });

  it("released cannot reopen an item that already ended", async () => {
    await insertRow("a", { status: "dismissed" });

    const result = await host().endItem({
      ...request,
      itemId: "a",
      outcome: "released",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "item_conflict",
      currentStatus: "dismissed",
    });
    expect((await row("a"))?.status).toBe("dismissed");
  });

  it("a person can close an item the workflow flagged for them", async () => {
    await insertRow("a", { status: "needs_manual" });

    const result = await host().endItem({
      ...request,
      itemId: "a",
      outcome: "done",
    });

    expect(result).toMatchObject({ ok: true, status: "resolved" });
  });

  it("clears a parked pull request's babysit state when it ends, so a poll cannot reopen it", async () => {
    await insertRow("pr", {
      source: "github",
      status: "pr_observed",
      metadataJson: JSON.stringify({ prBabysitState: "stuck", keep: "me" }),
    });

    await host().endItem({
      ...request,
      itemId: "pr",
      outcome: "dismissed",
      reason: "stale",
    });

    const metadata = JSON.parse((await row("pr"))?.metadataJson ?? "{}");
    expect(metadata.prBabysitState).toBeUndefined();
    expect(metadata.keep).toBe("me");
  });
});

describe("idempotency and conflict", () => {
  it("ending an item again with the same outcome changes nothing", async () => {
    await insertRow("a");
    await host().endItem({
      ...request,
      itemId: "a",
      outcome: "dismissed",
      reason: "dup",
    });
    clockNow = "2026-10-18T11:00:00.000Z";

    const again = await host().endItem({
      ...request,
      runId: "run-2",
      itemId: "a",
      outcome: "dismissed",
      reason: "dup",
    });

    expect(again).toMatchObject({ ok: true, changed: false });
    const stored = await row("a");
    expect(stored?.updatedAt).toBe(T1);
    expect(JSON.parse(stored?.metadataJson ?? "{}").workflowEnd.runId).toBe(
      "run-1",
    );
  });

  it.each([
    ["dismissed", "done", "resolved"],
    ["resolved", "dismissed", "dismissed"],
    ["resolved", "needsManual", "needs_manual"],
  ])(
    "a %s item cannot be ended %s: it is a typed conflict and stays as it was",
    async (current, outcome) => {
      await insertRow("a", { status: current });

      const result = await host().endItem({
        ...request,
        itemId: "a",
        outcome: outcome as "done" | "dismissed" | "needsManual",
        ...(outcome === "dismissed" ? { reason: "x" } : {}),
      });

      expect(result).toMatchObject({
        ok: false,
        reason: "item_conflict",
        code: "item_conflict",
        retryable: false,
        currentStatus: current,
      });
      expect((await row("a"))?.status).toBe(current);
      expect((await row("a"))?.updatedAt).toBe(T0);
    },
  );

  it("two Ends racing for one item leave one winner and a typed conflict", async () => {
    await insertRow("a");
    const h = host();

    const [first, second] = await Promise.all([
      h.endItem({ ...request, itemId: "a", outcome: "done" }),
      h.endItem({ ...request, itemId: "a", outcome: "dismissed", reason: "x" }),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const lost = outcomes.find((r) => !r.ok);
    expect(lost).toMatchObject({ ok: false, reason: "item_conflict" });
    const status = (await row("a"))?.status;
    expect(["resolved", "dismissed"]).toContain(status);
  });

  it("two identical Ends racing write once", async () => {
    await insertRow("a");
    const h = host();

    const results = await Promise.all([
      h.endItem({ ...request, itemId: "a", outcome: "done" }),
      h.endItem({ ...request, itemId: "a", outcome: "done" }),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.changed).length).toBe(1);
  });
});

describe("the engine's status writer", () => {
  it("writes the statuses an End maps to", async () => {
    await insertRow("a");
    await insertRow("b");
    await insertRow("c");

    for (const [itemId, status] of [
      ["a", "resolved"],
      ["b", "dismissed"],
      ["c", "needs_manual"],
    ] as const) {
      expect(
        await host().setStatus({
          ...request,
          itemId,
          status,
          reason: "because",
          signal: never,
        }),
      ).toEqual({ ok: true });
    }

    expect((await row("a"))?.status).toBe("resolved");
    expect((await row("b"))?.status).toBe("dismissed");
    expect((await row("c"))?.status).toBe("needs_manual");
  });

  it("answers a conflict with a typed failure the engine records on the item", async () => {
    await insertRow("a", { status: "dismissed" });

    const result = await host().setStatus({
      ...request,
      itemId: "a",
      status: "resolved",
      signal: never,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "item_conflict",
      retryable: false,
    });
    expect(result.ok ? "" : result.message).toContain("already dismissed");
    expect(result.ok ? "" : result.message).not.toContain("item_conflict");
    expect((await row("a"))?.status).toBe("dismissed");
  });

  it("refuses a status that is not an inbox status", async () => {
    await insertRow("a");

    const result = await host().setStatus({
      ...request,
      itemId: "a",
      status: "done-ish",
      signal: never,
    });

    expect(result).toMatchObject({ ok: false, code: "graph_invalid" });
    expect((await row("a"))?.status).toBe("received");
  });

  it("does not write once the run has been stopped", async () => {
    await insertRow("a");
    const stopped = new AbortController();
    stopped.abort();

    const result = await host().setStatus({
      ...request,
      itemId: "a",
      status: "resolved",
      signal: stopped.signal,
    });

    expect(result).toMatchObject({ ok: false, retryable: true });
    expect((await row("a"))?.status).toBe("received");
  });

  it("does not find an item that belongs to another factory or organization", async () => {
    await insertRow("other-factory", { factoryId: "factory-2" });
    await insertRow("other-org", { orgId: "org-2" });

    const first = await host().endItem({
      ...request,
      itemId: "other-factory",
      outcome: "done",
    });
    const second = await host().endItem({
      ...request,
      itemId: "other-org",
      outcome: "done",
    });
    const missing = await host().endItem({
      ...request,
      itemId: "nope",
      outcome: "done",
    });

    for (const result of [first, second, missing]) {
      expect(result).toMatchObject({ ok: false, reason: "item_not_found" });
    }
    expect((await row("other-factory"))?.status).toBe("received");
    expect((await row("other-org"))?.status).toBe("received");
  });

  it("fails an item whose stored metadata cannot be read instead of writing over it", async () => {
    await insertRow("a", { metadataJson: "{not json" });

    const result = await host().endItem({
      ...request,
      itemId: "a",
      outcome: "done",
    });

    expect(result).toMatchObject({ ok: false, reason: "item_unreadable" });
    expect((await row("a"))?.status).toBe("received");
  });
});

/** The write a poller makes for an item it sees again, with the helpers it uses. */
async function pollerUpsert(input: {
  id: string;
  title: string;
  source?: string;
  pullRequest?: { state: "open"; draft: boolean };
  now: string;
}) {
  const existing = (
    await db
      .select()
      .from(triageItems)
      .where(eq(triageItems.id, input.id))
      .limit(1)
  )[0];
  const sourceChanged = hasTriageSourceChanged(existing, {
    title: input.title,
    summary: null,
    sourceUrl: null,
    coverage: "complete",
  });
  const status = input.pullRequest
    ? statusAfterPullRequestPoll({
        existingStatus: existing?.status,
        existingAuthor: undefined,
        nextAuthor: "someone",
        existingBabysitState: undefined,
        babysitReopened: false,
        nextState: input.pullRequest.state,
        nextDraft: input.pullRequest.draft,
        sourceChanged,
      })
    : statusAfterTriageSourceUpdate(
        existing?.status,
        sourceChanged,
        "received",
      );
  await db
    .insert(triageItems)
    .values({
      id: input.id,
      source: input.source ?? "slack",
      externalId: input.id,
      title: input.title,
      status,
      coverage: "complete",
      dedupeKey: input.id,
      metadataJson: "{}",
      createdAt: input.now,
      updatedAt: input.now,
      ownerEmail: OWNER,
      orgId: SCOPE.orgId,
      factoryId: SCOPE.factoryId,
    })
    .onConflictDoUpdate({
      target: triageItems.id,
      set: { title: input.title, status, updatedAt: input.now },
      setWhere: triageSourceUpsertGuard(existing, status, input.now),
    });
}

describe("a later poll", () => {
  it.each(["dismissed", "resolved"] as const)(
    "does not flip a %s item back, even when the provider's copy changed",
    async (outcome) => {
      await insertRow("a");
      await host().endItem({
        ...request,
        itemId: "a",
        outcome: outcome === "dismissed" ? "dismissed" : "done",
        reason: "handled",
      });

      await pollerUpsert({
        id: "a",
        title: "The provider edited this message",
        now: "2026-10-18T12:00:00.000Z",
      });

      const stored = await row("a");
      expect(stored?.status).toBe(outcome);
      expect(stored?.title).toBe("The provider edited this message");
    },
  );

  it("does not reopen a dismissed pull request", async () => {
    await insertRow("pr", { source: "github", status: "pr_observed" });
    await host().endItem({
      ...request,
      itemId: "pr",
      outcome: "dismissed",
      reason: "not ours",
    });

    await pollerUpsert({
      id: "pr",
      source: "github",
      title: "Retitled pull request",
      pullRequest: { state: "open", draft: false },
      now: "2026-10-18T12:00:00.000Z",
    });

    expect((await row("pr"))?.status).toBe("dismissed");
  });

  it("does still refresh an item that is only flagged for a person", async () => {
    await insertRow("a");
    await host().endItem({ ...request, itemId: "a", outcome: "needsManual" });

    await pollerUpsert({
      id: "a",
      title: "New text from the provider",
      now: "2026-10-18T12:00:00.000Z",
    });

    expect((await row("a"))?.status).toBe("received");
  });
});

function leadItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    id: "lead-1",
    externalId: "hubspot-lead-1",
    kind: "lead",
    provider: "hubspot",
    title: "Acme asked for a demo",
    text: "They want SSO.",
    url: "https://app.example.test/leads/1",
    author: "Pat Example",
    occurredAt: "2026-10-18T09:00:00.000Z",
    thread: { ticketId: "t-1" },
    extras: { plan: "team" },
    payload: { stage: "lead", score: 42 },
    ...overrides,
  };
}

describe("upsertItems row states", () => {
  const states = async (
    ids: readonly string[],
    options: { dryRun?: boolean } = {},
  ) => {
    const result = await host().upsertItems({
      items: ids.map((id) => leadItem({ id, externalId: `e-${id}` })),
      ...options,
    });
    if (!result.ok) throw new Error(`expected a result: ${result.message}`);
    return result.states;
  };

  it("says an item is created, then open on the next offer", async () => {
    expect(await states(["a"])).toEqual([{ id: "a", state: "created" }]);
    expect(await states(["a"])).toEqual([{ id: "a", state: "open" }]);
  });

  it.each(["resolved", "dismissed", "needs_manual"])(
    "reports a row that is %s as terminal",
    async (status) => {
      await host().upsertItems({ items: [leadItem({ id: "a" })] });
      await db
        .update(triageItems)
        .set({ status })
        .where(eq(triageItems.id, "a"));

      expect(await states(["a"])).toEqual([{ id: "a", state: "terminal" }]);
    },
  );

  it.each(["automation_started", "failed", "pr_observed"])(
    "reports a row that is %s as open",
    async (status) => {
      await host().upsertItems({ items: [leadItem({ id: "a" })] });
      await db
        .update(triageItems)
        .set({ status })
        .where(eq(triageItems.id, "a"));

      expect(await states(["a"])).toEqual([{ id: "a", state: "open" }]);
    },
  );

  it("reports a released item as open, since release puts it back in its queue", async () => {
    await host().upsertItems({ items: [leadItem({ id: "a" })] });
    await host().endItem({ ...request, itemId: "a", outcome: "released" });

    expect(await states(["a"])).toEqual([{ id: "a", state: "open" }]);
  });

  it("reports an item a person put back in the queue as open", async () => {
    await host().upsertItems({ items: [leadItem({ id: "a" })] });
    await host().endItem({ ...request, itemId: "a", outcome: "needsManual" });
    await db
      .update(triageItems)
      .set({ status: "received" })
      .where(eq(triageItems.id, "a"));

    expect(await states(["a"])).toEqual([{ id: "a", state: "open" }]);
  });

  it("answers one state per item, in the order asked", async () => {
    await host().upsertItems({
      items: [leadItem({ id: "b" }), leadItem({ id: "d" })],
    });
    await host().endItem({ ...request, itemId: "d", outcome: "done" });

    expect(await states(["a", "b", "c", "d"])).toEqual([
      { id: "a", state: "created" },
      { id: "b", state: "open" },
      { id: "c", state: "created" },
      { id: "d", state: "terminal" },
    ]);
  });

  it("keeps a row handed to a person with that person, even when the provider's copy changed", async () => {
    await host().upsertItems({ items: [leadItem({ id: "a" })] });
    await host().endItem({ ...request, itemId: "a", outcome: "needsManual" });

    const result = await host().upsertItems({
      items: [leadItem({ id: "a", title: "Edited at the provider" })],
    });

    expect(result).toMatchObject({
      ok: true,
      states: [{ id: "a", state: "terminal" }],
    });
    const saved = await row("a");
    expect(saved?.status).toBe("needs_manual");
    expect(saved?.title).toBe("Edited at the provider");
  });

  it("fails, and writes nothing, for a row whose status it cannot read", async () => {
    await host().upsertItems({ items: [leadItem({ id: "fine" })] });
    await insertRow("odd", { source: "hubspot", status: "mystery" });

    for (const dryRun of [false, true]) {
      const result = await host().upsertItems({
        items: [
          leadItem({ id: "fine", title: "Changed" }),
          leadItem({ id: "odd", externalId: "e-odd" }),
        ],
        dryRun,
      });

      expect(result).toMatchObject({
        ok: false,
        reason: "item_unreadable",
        code: "item_invalid",
        retryable: false,
      });
      expect(result.ok ? "" : result.message).toContain("mystery");
    }
    expect((await row("fine"))?.title).toBe("Acme asked for a demo");
    expect((await row("odd"))?.status).toBe("mystery");
  });

  describe("in a dry run", () => {
    it("reports the same states and counts, and writes nothing", async () => {
      await host().upsertItems({
        items: [leadItem({ id: "b" }), leadItem({ id: "d" })],
      });
      await host().endItem({ ...request, itemId: "d", outcome: "done" });
      const before = await db.select().from(triageItems);

      const dry = await host().upsertItems({
        items: ["a", "b", "d"].map((id) =>
          leadItem({
            id,
            externalId: `e-${id}`,
            ...(id === "b" ? { title: "Edited" } : {}),
          }),
        ),
        dryRun: true,
      });

      expect(dry).toEqual({
        ok: true,
        inserted: 1,
        updated: 1,
        unchanged: 1,
        skipped: 0,
        states: [
          { id: "a", state: "created" },
          { id: "b", state: "open" },
          { id: "d", state: "terminal" },
        ],
      });
      expect(await db.select().from(triageItems)).toEqual(before);
      expect(await row("a")).toBeUndefined();
    });

    it("still refuses an item the real write would refuse", async () => {
      const result = await host().upsertItems({
        items: [leadItem({ payload: { blob: "x".repeat(20_000) } })],
        dryRun: true,
      });

      expect(result).toMatchObject({ ok: false, reason: "output_over_cap" });
    });
  });
});

describe("upsertItems", () => {
  it("stores provider items as inbox rows an End can move", async () => {
    const stored = await host().upsertItems({ items: [leadItem()] });

    expect(stored).toEqual({
      ok: true,
      inserted: 1,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      states: [{ id: "lead-1", state: "created" }],
    });
    const saved = await row("lead-1");
    expect(saved).toMatchObject({
      source: "hubspot",
      externalId: "hubspot-lead-1",
      status: "received",
      orgId: "org-1",
      factoryId: "factory-1",
      ownerEmail: OWNER,
      sourceUrl: "https://app.example.test/leads/1",
      summary: "They want SSO.",
    });
    expect(JSON.parse(saved?.payloadJson ?? "{}")).toEqual({
      stage: "lead",
      score: 42,
    });
    expect(
      await host().endItem({ ...request, itemId: "lead-1", outcome: "done" }),
    ).toMatchObject({ ok: true, status: "resolved" });
  });

  it("counts an unchanged re-observation and an edited one apart", async () => {
    await host().upsertItems({ items: [leadItem()] });

    const same = await host().upsertItems({ items: [leadItem()] });
    const edited = await host().upsertItems({
      items: [leadItem({ title: "Acme asked for a demo (updated)" })],
    });

    expect(same).toMatchObject({ ok: true, unchanged: 1, updated: 0 });
    expect(edited).toMatchObject({ ok: true, unchanged: 0, updated: 1 });
  });

  it("does not reopen a dismissed item when the provider shows it again", async () => {
    await host().upsertItems({ items: [leadItem()] });
    await host().endItem({
      ...request,
      itemId: "lead-1",
      outcome: "dismissed",
      reason: "spam",
    });

    await host().upsertItems({
      items: [leadItem({ title: "Acme asked for a demo again" })],
    });

    const saved = await row("lead-1");
    expect(saved?.status).toBe("dismissed");
    expect(saved?.title).toBe("Acme asked for a demo again");
  });

  it("refuses a payload over the cap and writes nothing, rather than cutting it", async () => {
    const result = await host().upsertItems({
      items: [
        leadItem({ id: "ok-item", externalId: "ok" }),
        leadItem({ payload: { blob: "x".repeat(20_000) } }),
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "output_over_cap",
      code: "output_over_cap",
    });
    expect(await row("ok-item")).toBeUndefined();
    expect(await row("lead-1")).toBeUndefined();
  });

  it("keeps a large body out of the row: a handle is stored, a body is refused", async () => {
    const withHandle = await host().upsertItems({
      items: [leadItem({ textRef: "blob://transcripts/1" })],
    });
    const withBody = await host().upsertItems({
      items: [
        leadItem({ id: "lead-2", externalId: "l2", text: "x".repeat(5_000) }),
      ],
    });
    const asDataUrl = await host().upsertItems({
      items: [
        leadItem({
          id: "lead-3",
          externalId: "l3",
          textRef: "data:text/plain;base64,AAAA",
        }),
      ],
    });

    expect(withHandle).toMatchObject({ ok: true });
    expect((await row("lead-1"))?.textRef).toBe("blob://transcripts/1");
    expect(withBody).toMatchObject({ ok: false, reason: "output_over_cap" });
    expect(asDataUrl).toMatchObject({ ok: false });
    expect(await row("lead-2")).toBeUndefined();
    expect(await row("lead-3")).toBeUndefined();
  });

  it("will not write over a row that belongs to another factory", async () => {
    await insertRow("lead-1", { factoryId: "factory-2", title: "Theirs" });

    const result = await host().upsertItems({ items: [leadItem()] });

    expect(result).toMatchObject({
      ok: false,
      reason: "item_conflict",
      code: "item_conflict",
    });
    const theirs = await row("lead-1");
    expect(theirs).toMatchObject({ title: "Theirs", factoryId: "factory-2" });
  });

  it("gives one provider record its own item in each factory and organization, and one item within each", async () => {
    const leads = OPERATION_CATALOG.get("hubspot.newLeads");
    if (!leads) throw new Error("hubspot.newLeads is not in the catalog");
    const body = {
      results: [
        {
          id: "9003",
          createdAt: T0,
          properties: { email: "ada@example.test" },
        },
      ],
    };
    const otherFactory = { ...SCOPE, factoryId: "factory-2" };
    const otherOrg = { ...SCOPE, orgId: "org-2" };
    const ingest = async (scope: WorkflowScope) => {
      const items = await keepStoredItemIds(
        db,
        scope,
        leads.id,
        mapItems(leads, body, scope).items,
      );
      return { items, stored: await host(scope).upsertItems({ items }) };
    };
    // Before ids carried a scope, factory-1 stored the record under this id.
    const legacyId = "hubspot.newLeads:9003";
    await insertRow(legacyId, { source: "hubspot", externalId: "9003" });

    const first = await ingest(SCOPE);
    const second = await ingest(otherFactory);
    const third = await ingest(otherOrg);

    expect([first, second, third].map((entry) => entry.stored.ok)).toEqual([
      true,
      true,
      true,
    ]);
    expect(first.items[0].id).toBe(legacyId);
    const ids = [first, second, third].map((entry) => entry.items[0].id);
    expect(new Set(ids).size).toBe(3);
    expect(await db.select().from(triageItems)).toHaveLength(3);
    expect(await ingest(otherFactory)).toMatchObject({
      stored: { ok: true, inserted: 0, unchanged: 1 },
    });
    expect(await db.select().from(triageItems)).toHaveLength(3);

    // An id minted by hand that another factory holds is still refused.
    const clash = await host(otherFactory).upsertItems({
      items: [first.items[0]],
    });
    expect(clash).toMatchObject({ ok: false, reason: "item_conflict" });
  });

  it("rejects a batch that repeats an id, or that is too large", async () => {
    const repeated = await host().upsertItems({
      items: [leadItem(), leadItem()],
    });
    const tooMany = await host().upsertItems({
      items: Array.from({ length: 101 }, (_, index) =>
        leadItem({ id: `l-${index}`, externalId: `e-${index}` }),
      ),
    });

    expect(repeated).toMatchObject({ ok: false, reason: "item_invalid" });
    expect(tooMany).toMatchObject({ ok: false, reason: "output_over_cap" });
  });
});
