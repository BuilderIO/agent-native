import { createRequire } from "node:module";

import type { ActionEntry } from "@agent-native/core/server";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

import { factoryWorkflowItemState, triageItems } from "../db/schema.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import type { InboxRequest, WorkflowScope } from "../workflow/adapter.js";
import type { NormalizedItem } from "../workflow/items.js";
import {
  INBOX_POLLER_ACTIONS,
  createGuardedActionCaller,
  createInboxHost,
  rowToNormalizedItem,
  type GuardedActionCall,
  type GuardedActionCaller,
  type GuardedActionResult,
} from "./inbox.js";
import { createItemsHost } from "./items.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "factory-1" };
const OWNER = "owner@example.test";
const WORKFLOW = "wf-1";
const NOW = "2026-10-18T10:00:00.000Z";
const EARLIER = "2026-10-18T09:00:00.000Z";

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

let client: PGliteClient;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  client = await emptyClient();
  db = drizzle(client);
});

type RowInput = Partial<typeof triageItems.$inferInsert> & { id: string };

async function insertRow(input: RowInput) {
  await db.insert(triageItems).values({
    source: "slack",
    externalId: input.id,
    title: `Item ${input.id}`,
    status: "received",
    coverage: "complete",
    dedupeKey: input.id,
    metadataJson: "{}",
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ownerEmail: OWNER,
    orgId: SCOPE.orgId,
    factoryId: SCOPE.factoryId,
    ...input,
  });
}

async function holdItem(
  itemId: string,
  state: { parkedAtNode?: string; leaseUntil?: string; leasedBy?: string },
) {
  await db.insert(factoryWorkflowItemState).values({
    workflowId: WORKFLOW,
    itemId,
    orgId: SCOPE.orgId,
    factoryId: SCOPE.factoryId,
    graphVersion: 1,
    parkedAtNode: state.parkedAtNode ?? null,
    leasedBy: state.leasedBy ?? null,
    leaseUntil: state.leaseUntil ?? null,
    createdAt: EARLIER,
    updatedAt: EARLIER,
  });
}

interface Calls {
  calls: GuardedActionCall[];
}

/** A caller that records what it was asked and answers from a script. */
function scriptedCaller(
  respond: (
    call: GuardedActionCall,
  ) => GuardedActionResult | Promise<GuardedActionResult>,
): GuardedActionCaller & Calls {
  const calls: GuardedActionCall[] = [];
  const caller = (async (call: GuardedActionCall) => {
    calls.push(call);
    return respond(call);
  }) as GuardedActionCaller & Calls;
  caller.calls = calls;
  return caller;
}

const completed = (result: unknown): GuardedActionResult => ({
  status: "completed",
  output: JSON.stringify(result),
});

function inbox(callAction: GuardedActionCaller) {
  return createInboxHost({
    scope: SCOPE,
    workflowId: WORKFLOW,
    getDatabase: () => db,
    callAction,
    clock: () => new Date(NOW),
  });
}

type PollSettings = Extract<InboxRequest["settings"], { source: "inbox-poll" }>;

function pollRequest(
  settings: Partial<PollSettings> & Pick<PollSettings, "poller">,
  signal: AbortSignal = new AbortController().signal,
): InboxRequest {
  return {
    settings: { source: "inbox-poll", takeLimit: 5, ...settings },
    mode: "live",
    signal,
  };
}

function statusRequest(status: string, takeLimit = 5): InboxRequest {
  return {
    settings: { source: "status", status, takeLimit },
    mode: "live",
    signal: new AbortController().signal,
  };
}

const slackMeta = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    messageTs: "1760781600.000100",
    author: "Pat",
    authorId: "U111",
    ...extra,
  });

describe("an inbox poll", () => {
  it("runs the slack poller through the guard, then reads the queue back as items", async () => {
    await insertRow({
      id: "m1",
      title: "Checkout fails",
      summary: "It errors on the pay button.",
      sourceUrl: "https://slack.example.test/p1",
      channelId: "C1",
      threadTs: "1760781600.000100",
      metadataJson: slackMeta(),
      updatedAt: NOW,
    });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 1 }));

    const taken = await inbox(caller).take(pollRequest({ poller: "slack" }));

    expect(caller.calls).toHaveLength(1);
    expect(caller.calls[0]).toMatchObject({
      name: "poll-slack-channel",
      input: { factoryId: "factory-1" },
    });
    expect(taken).toMatchObject({ ok: true, totalAvailable: 1 });
    if (!taken.ok) throw new Error("expected items");
    expect(taken.items).toHaveLength(1);
    expect(taken.items[0]).toMatchObject({
      id: "m1",
      externalId: "m1",
      kind: "message",
      provider: "slack",
      title: "Checkout fails",
      text: "It errors on the pay button.",
      url: "https://slack.example.test/p1",
      author: "Pat",
      occurredAt: "2025-10-18T10:00:00.000Z",
      thread: { channelId: "C1", threadTs: "1760781600.000100" },
      extras: { status: "received", coverage: "complete" },
    });
  });

  it("takes only as many items as the source asks for and reports how many there were", async () => {
    for (let index = 0; index < 5; index += 1) {
      await insertRow({
        id: `m${index}`,
        metadataJson: slackMeta(),
        updatedAt: `2026-10-18T09:0${index}:00.000Z`,
      });
    }
    const caller = scriptedCaller(() => completed({ ok: true, observed: 5 }));

    const taken = await inbox(caller).take(
      pollRequest({ poller: "slack", takeLimit: 2 }),
    );

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items.map((item) => item.id)).toEqual(["m4", "m3"]);
    expect(taken.totalAvailable).toBe(5);
  });

  it("never reads the queue through list-triage-items, whatever the poller", async () => {
    await insertRow({ id: "s1", source: "sentry", metadataJson: "{}" });
    await insertRow({
      id: "g1",
      source: "github",
      status: "pr_observed",
      repository: "acme/app",
      pullRequestNumber: 7,
    });
    const caller = scriptedCaller((call) =>
      completed(
        call.name === "poll-github-sources"
          ? { ok: true, issues: 0, pullRequests: 1 }
          : { ok: true, observed: 1 },
      ),
    );
    const host = inbox(caller);

    await host.take(pollRequest({ poller: "slack" }));
    await host.take(pollRequest({ poller: "github" }));
    await host.take(pollRequest({ poller: "sentry" }));
    await host.take(statusRequest("received"));

    expect(caller.calls.map((call) => call.name)).toEqual([
      "poll-slack-channel",
      "poll-github-sources",
      "poll-sentry-errors",
    ]);
    expect(Object.values(INBOX_POLLER_ACTIONS)).not.toContain(
      "list-triage-items",
    );
  });

  it("reads each poller's own rows as the right kind of item", async () => {
    await insertRow({
      id: "pr",
      source: "github",
      status: "pr_observed",
      repository: "acme/app",
      pullRequestNumber: 7,
      headSha: "abc123",
      sourceUrl: "https://github.example.test/acme/app/pull/7",
    });
    await insertRow({
      id: "issue",
      source: "github_issue",
      repository: "acme/app",
      pullRequestNumber: 8,
    });
    await insertRow({ id: "merged-pr", source: "github", status: "merged" });
    await insertRow({
      id: "err",
      source: "sentry",
      metadataJson: JSON.stringify({ culprit: "pay()", level: "error" }),
    });
    const github = scriptedCaller(() =>
      completed({ ok: true, issues: 1, pullRequests: 1 }),
    );
    const sentry = scriptedCaller(() => completed({ ok: true, observed: 1 }));

    const prs = await inbox(github).take(pollRequest({ poller: "github" }));
    const errors = await inbox(sentry).take(pollRequest({ poller: "sentry" }));

    if (!prs.ok || !errors.ok) throw new Error("expected items");
    expect(
      prs.items.map((item) => [item.id, item.kind, item.provider]),
    ).toEqual(
      expect.arrayContaining([
        ["pr", "pull_request", "github"],
        ["issue", "issue", "github"],
      ]),
    );
    expect(prs.items.map((item) => item.id)).not.toContain("merged-pr");
    expect(prs.items.find((item) => item.id === "pr")).toMatchObject({
      thread: { repo: "acme/app", number: 7 },
      extras: { headSha: "abc123" },
    });
    expect(errors.items).toHaveLength(1);
    expect(errors.items[0]).toMatchObject({
      kind: "error",
      payload: { culprit: "pay()", level: "error" },
    });
  });

  it("offers only items still waiting, never one that ended", async () => {
    await insertRow({ id: "open" });
    await insertRow({ id: "done", status: "resolved" });
    await insertRow({ id: "no", status: "dismissed" });
    await insertRow({ id: "manual", status: "needs_manual" });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 4 }));

    const taken = await inbox(caller).take(pollRequest({ poller: "slack" }));

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items.map((item) => item.id)).toEqual(["open"]);
    expect(taken.totalAvailable).toBe(1);
  });

  it("does not offer items another factory or organization owns", async () => {
    await insertRow({ id: "mine" });
    await insertRow({ id: "other-factory", factoryId: "factory-2" });
    await insertRow({ id: "other-org", orgId: "org-2" });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 1 }));

    const taken = await inbox(caller).take(pollRequest({ poller: "slack" }));

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items.map((item) => item.id)).toEqual(["mine"]);
    expect(taken.totalAvailable).toBe(1);
  });
});

describe("items the workflow already holds", () => {
  it("leaves out an item parked at a Wait and an item another run has leased", async () => {
    await insertRow({ id: "free", updatedAt: "2026-10-18T09:01:00.000Z" });
    await insertRow({ id: "parked", updatedAt: "2026-10-18T09:02:00.000Z" });
    await insertRow({ id: "leased", updatedAt: "2026-10-18T09:03:00.000Z" });
    await holdItem("parked", { parkedAtNode: "wait" });
    await holdItem("leased", {
      leasedBy: "other-tick",
      leaseUntil: "2026-10-18T10:10:00.000Z",
    });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 3 }));

    const taken = await inbox(caller).take(
      pollRequest({ poller: "slack", takeLimit: 1 }),
    );

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items.map((item) => item.id)).toEqual(["free"]);
    expect(taken.totalAvailable).toBe(1);
  });

  it("offers an item again once its lease has run out", async () => {
    await insertRow({ id: "stale" });
    await holdItem("stale", {
      leasedBy: "dead-tick",
      leaseUntil: "2026-10-18T09:30:00.000Z",
    });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 1 }));

    const taken = await inbox(caller).take(pollRequest({ poller: "slack" }));

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items.map((item) => item.id)).toEqual(["stale"]);
  });

  it("ignores what a different workflow holds", async () => {
    await insertRow({ id: "a" });
    await db.insert(factoryWorkflowItemState).values({
      workflowId: "another-workflow",
      itemId: "a",
      orgId: SCOPE.orgId,
      factoryId: SCOPE.factoryId,
      graphVersion: 1,
      parkedAtNode: "wait",
      createdAt: EARLIER,
      updatedAt: EARLIER,
    });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 1 }));

    const taken = await inbox(caller).take(pollRequest({ poller: "slack" }));

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items).toHaveLength(1);
  });
});

describe("rows put back in the queue under a source whose provider has moved on", () => {
  const OP = "test.items";
  const queued = (name: string) => `${OP}:${name}`;
  const putBack = (limit = 10, operationId = OP) =>
    inbox(scriptedCaller(() => completed({}))).takeRequeued({
      operationId,
      limit,
      mode: "live",
      signal: new AbortController().signal,
    });

  it("reads the rows its operation brought in that this workflow took before and nothing holds, newest first", async () => {
    await insertRow({
      id: queued("old"),
      updatedAt: "2026-10-18T09:01:00.000Z",
    });
    await insertRow({
      id: queued("new"),
      updatedAt: "2026-10-18T09:05:00.000Z",
    });
    await holdItem(queued("old"), {});
    await holdItem(queued("new"), {});

    const taken = await putBack();

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items.map((item) => item.id)).toEqual([
      queued("new"),
      queued("old"),
    ]);
    expect(taken.totalAvailable).toBe(2);
  });

  it("leaves out a row this workflow never took, another operation's rows, and rows not in their queue status", async () => {
    await insertRow({ id: queued("never-taken") });
    await insertRow({ id: "other.operation:a" });
    await holdItem("other.operation:a", {});
    await insertRow({ id: queued("with-a-person"), status: "needs_manual" });
    await holdItem(queued("with-a-person"), {});
    await insertRow({ id: queued("done"), status: "resolved" });
    await holdItem(queued("done"), {});
    await insertRow({
      id: queued("github"),
      source: "github",
      status: "received",
    });
    await holdItem(queued("github"), {});

    const taken = await putBack();

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items).toEqual([]);
  });

  it("takes a pull request at its own queue status", async () => {
    await insertRow({
      id: queued("pr"),
      source: "github",
      status: "pr_observed",
      pullRequestNumber: 7,
      repository: "acme/app",
    });
    await holdItem(queued("pr"), {});

    const taken = await putBack();

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items.map((item) => item.id)).toEqual([queued("pr")]);
  });

  it("leaves out a row that is parked at a Wait or that another run has leased", async () => {
    await insertRow({ id: queued("free") });
    await holdItem(queued("free"), {});
    await insertRow({ id: queued("parked") });
    await holdItem(queued("parked"), { parkedAtNode: "wait" });
    await insertRow({ id: queued("leased") });
    await holdItem(queued("leased"), {
      leasedBy: "other-tick",
      leaseUntil: "2026-10-18T10:10:00.000Z",
    });
    await insertRow({ id: queued("stale") });
    await holdItem(queued("stale"), {
      leasedBy: "dead-tick",
      leaseUntil: "2026-10-18T09:30:00.000Z",
    });

    const taken = await putBack();

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items.map((item) => item.id).sort()).toEqual([
      queued("free"),
      queued("stale"),
    ]);
  });

  it("is scoped to its own workflow's state, and to its own factory", async () => {
    await insertRow({ id: queued("theirs") });
    await db.insert(factoryWorkflowItemState).values({
      workflowId: "another-workflow",
      itemId: queued("theirs"),
      orgId: SCOPE.orgId,
      factoryId: SCOPE.factoryId,
      graphVersion: 1,
      createdAt: EARLIER,
      updatedAt: EARLIER,
    });
    await insertRow({ id: queued("elsewhere"), factoryId: "factory-2" });
    await holdItem(queued("elsewhere"), {});

    const taken = await putBack();

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items).toEqual([]);
  });

  it("bounds the take and says how many there were", async () => {
    for (let index = 0; index < 4; index += 1) {
      await insertRow({
        id: queued(`r${index}`),
        updatedAt: `2026-10-18T09:0${index}:00.000Z`,
      });
      await holdItem(queued(`r${index}`), {});
    }

    const taken = await putBack(3);

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items).toHaveLength(3);
    expect(taken.totalAvailable).toBe(4);
  });

  it("fails on a row that cannot be read, instead of leaving it out", async () => {
    await insertRow({ id: queued("broken"), metadataJson: "{not json" });
    await holdItem(queued("broken"), {});

    const taken = await putBack();

    expect(taken).toMatchObject({ ok: false, code: "item_invalid" });
  });
});

describe("a poller that does not deliver", () => {
  async function seededTake(response: GuardedActionResult) {
    await insertRow({ id: "waiting", title: "A real item in the queue" });
    const caller = scriptedCaller(() => response);
    return {
      caller,
      taken: await inbox(caller).take(pollRequest({ poller: "slack" })),
    };
  }

  it("is a typed failure, not an empty list, even when the queue holds items", async () => {
    const { taken } = await seededTake({
      status: "failed",
      output: "Slack responded 502",
    });

    expect(taken).toMatchObject({
      ok: false,
      reason: "poller_failed",
      code: "provider_error",
      retryable: true,
    });
    expect(taken.ok ? "" : taken.message).toContain("Slack responded 502");
  });

  it("says a missing credential is missing, and does not call it retryable", async () => {
    const { taken } = await seededTake({
      status: "failed",
      output: "No Slack token is configured for this workspace.",
    });

    expect(taken).toMatchObject({
      ok: false,
      reason: "poller_failed",
      code: "credential_missing",
      retryable: false,
    });
    expect(taken.ok ? "" : taken.message).toContain(
      "request-workflow-connection",
    );
  });

  it("says a refusal by the workflow gate is a refusal", async () => {
    const { taken } = await seededTake({
      status: "failed",
      output:
        "x is a workflow job and its saved graph does not name poll-slack-channel.",
      errorCode: "workflow_action_not_allowed",
    });

    expect(taken).toMatchObject({
      ok: false,
      code: "operation_not_allowed",
      retryable: false,
    });
  });

  it("does not treat a request for approval as a result", async () => {
    const { taken } = await seededTake({
      status: "approval_required",
      output: "Awaiting human approval",
    });

    expect(taken).toMatchObject({
      ok: false,
      code: "operation_not_allowed",
      retryable: false,
    });
  });

  it.each([
    ["is not JSON", "<html>bad gateway</html>"],
    ["is not an object", "[1,2,3]"],
    ["does not report success", JSON.stringify({ ok: false, error: "nope" })],
    ["does not say how many it observed", JSON.stringify({ ok: true })],
  ])("fails when its result %s", async (_name, output) => {
    const { taken } = await seededTake({ status: "completed", output });

    expect(taken).toMatchObject({ ok: false, reason: "poller_failed" });
  });

  it("is a typed partial_read when it says it observed more than the inbox holds", async () => {
    await insertRow({ id: "a" });
    await insertRow({ id: "b" });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 5 }));

    const taken = await inbox(caller).take(pollRequest({ poller: "slack" }));

    expect(taken).toMatchObject({
      ok: false,
      reason: "partial_read",
      code: "partial_read",
      retryable: true,
    });
    expect(taken.ok ? "" : taken.message).toContain("5 observed");
    expect(taken.ok ? "" : taken.message).not.toContain("partial_read");
  });

  it("counts a github poll's issues and pull requests together", async () => {
    await insertRow({ id: "pr", source: "github", status: "pr_observed" });
    const short = scriptedCaller(() =>
      completed({ ok: true, issues: 2, pullRequests: 1 }),
    );
    const enough = scriptedCaller(() =>
      completed({ ok: true, issues: 0, pullRequests: 1 }),
    );

    const failing = await inbox(short).take(pollRequest({ poller: "github" }));
    const passing = await inbox(enough).take(pollRequest({ poller: "github" }));

    expect(failing).toMatchObject({ ok: false, reason: "partial_read" });
    expect(passing).toMatchObject({ ok: true });
  });

  it("does not count rows another factory owns toward what it observed", async () => {
    await insertRow({ id: "elsewhere", factoryId: "factory-2" });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 1 }));

    const taken = await inbox(caller).take(pollRequest({ poller: "slack" }));

    expect(taken).toMatchObject({ ok: false, reason: "partial_read" });
  });

  it("accepts a poll that observed nothing new and reads whatever is queued", async () => {
    await insertRow({ id: "older" });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 0 }));

    const taken = await inbox(caller).take(pollRequest({ poller: "slack" }));

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items.map((item) => item.id)).toEqual(["older"]);
  });

  it("does not poll once the run has been stopped", async () => {
    const stopped = new AbortController();
    stopped.abort();
    const caller = scriptedCaller(() => completed({ ok: true, observed: 0 }));

    const taken = await inbox(caller).take(
      pollRequest({ poller: "slack" }, stopped.signal),
    );

    expect(taken).toMatchObject({
      ok: false,
      reason: "aborted",
      retryable: true,
    });
    expect(caller.calls).toEqual([]);
  });
});

describe("source filters", () => {
  const polled = () =>
    scriptedCaller((call) =>
      completed(
        call.name === "poll-github-sources"
          ? { ok: true, issues: 0, pullRequests: 0 }
          : { ok: true, observed: 0 },
      ),
    );

  async function ids(
    settings: Partial<PollSettings> & Pick<PollSettings, "poller">,
  ) {
    const taken = await inbox(polled()).take(pollRequest(settings));
    if (!taken.ok) throw new Error(`expected items: ${taken.message}`);
    return taken.items.map((item) => item.id).sort();
  }

  it("keeps to the listed channel, repository, or project", async () => {
    await insertRow({ id: "c1", channelId: "C1" });
    await insertRow({ id: "c2", channelId: "C2" });
    await insertRow({
      id: "r1",
      source: "github",
      status: "pr_observed",
      repository: "Acme/App",
    });
    await insertRow({
      id: "r2",
      source: "github",
      status: "pr_observed",
      repository: "acme/other",
    });
    await insertRow({
      id: "s1",
      source: "sentry",
      metadataJson: JSON.stringify({
        sentryOrgSlug: "acme",
        projectSlug: "web",
      }),
    });
    await insertRow({
      id: "s2",
      source: "sentry",
      metadataJson: JSON.stringify({
        sentryOrgSlug: "acme",
        projectSlug: "api",
      }),
    });

    expect(await ids({ poller: "slack", filter: { scopes: ["C1"] } })).toEqual([
      "c1",
    ]);
    expect(
      await ids({ poller: "github", filter: { scopes: ["acme/app"] } }),
    ).toEqual(["r1"]);
    expect(
      await ids({ poller: "sentry", filter: { scopes: ["acme/web"] } }),
    ).toEqual(["s1"]);
  });

  it("includes or excludes authors the way the pollers do", async () => {
    await insertRow({
      id: "pat",
      metadataJson: slackMeta({ authorId: "U111" }),
    });
    await insertRow({
      id: "lee",
      metadataJson: slackMeta({ authorId: "U222" }),
    });
    await insertRow({ id: "nobody", metadataJson: "{}" });

    expect(
      await ids({ poller: "slack", filter: { authors: ["u111"] } }),
    ).toEqual(["pat"]);
    expect(
      await ids({ poller: "slack", filter: { excludeAuthors: ["U111"] } }),
    ).toEqual(["lee", "nobody"]);
  });

  describe("a claim reaction", () => {
    const reacted = (...names: string[]) =>
      slackMeta({ personReactions: names, personReactors: ["UPERSON"] });

    it("takes a message nobody reacted to", async () => {
      await insertRow({ id: "free", metadataJson: reacted() });

      expect(
        await ids({ poller: "slack", filter: { claimReaction: "eyes" } }),
      ).toEqual(["free"]);
    });

    it("skips a message a person reacted to with the node's reaction, however it is written", async () => {
      await insertRow({ id: "free", metadataJson: reacted() });
      await insertRow({ id: "claimed", metadataJson: reacted("eyes") });

      for (const claimReaction of ["eyes", ":eyes:", "Eyes"]) {
        expect(
          await ids({ poller: "slack", filter: { claimReaction } }),
        ).toEqual(["free"]);
      }
      // Without the setting nothing is skipped: the reaction is the node's to choose.
      expect(await ids({ poller: "slack" })).toEqual(["claimed", "free"]);
    });

    it("takes a message a person reacted to with some other reaction", async () => {
      await insertRow({
        id: "other",
        metadataJson: reacted("tada", "white_check_mark"),
      });
      await insertRow({
        id: "also-claimed",
        metadataJson: reacted("tada", "eyes"),
      });

      expect(
        await ids({ poller: "slack", filter: { claimReaction: "eyes" } }),
      ).toEqual(["other"]);
    });

    it("does not count a reaction only a bot added, which the poller leaves out of the list", async () => {
      // The poller wrote `personReactions: []` because the one reactor was a bot.
      await insertRow({ id: "bot-only", metadataJson: reacted() });

      expect(
        await ids({ poller: "slack", filter: { claimReaction: "eyes" } }),
      ).toEqual(["bot-only"]);
    });

    it("counts a reaction the poller could not attribute, because a person may have added it", async () => {
      await insertRow({
        id: "unverified",
        metadataJson: slackMeta({
          personReactions: ["eyes"],
          personReactors: [],
          unverifiedReactors: ["UUNKNOWN"],
        }),
      });

      expect(
        await ids({ poller: "slack", filter: { claimReaction: "eyes" } }),
      ).toEqual([]);
    });

    it("takes a row the poller never read reactions for, since nothing says a person claimed it", async () => {
      await insertRow({ id: "never-read", metadataJson: "{}" });
      await insertRow({
        id: "bot-dispatched",
        metadataJson: JSON.stringify({ slackReactionName: "eyes" }),
      });

      expect(
        await ids({ poller: "slack", filter: { claimReaction: "eyes" } }),
      ).toEqual(["bot-dispatched", "never-read"]);
    });

    it("does not read a reaction named for another message in the same list", async () => {
      await insertRow({ id: "a", metadataJson: reacted("eyes") });
      await insertRow({ id: "b", metadataJson: reacted() });
      await insertRow({ id: "c", metadataJson: reacted("eyes_on_it") });

      expect(
        await ids({ poller: "slack", filter: { claimReaction: "eyes" } }),
      ).toEqual(["b", "c"]);
    });
  });

  it("refuses filters the pollers cannot honour instead of ignoring them", async () => {
    const caller = polled();
    const host = inbox(caller);

    const two = await host.take(
      pollRequest({ poller: "slack", filter: { scopes: ["C1", "C2"] } }),
    );
    const both = await host.take(
      pollRequest({
        poller: "slack",
        filter: { authors: ["U1"], excludeAuthors: ["U2"] },
      }),
    );
    const sentryAuthor = await host.take(
      pollRequest({ poller: "sentry", filter: { authors: ["U1"] } }),
    );
    const badReaction = await host.take(
      pollRequest({
        poller: "slack",
        filter: { claimReaction: "Not A Reaction!" },
      }),
    );

    for (const result of [two, both, sentryAuthor, badReaction]) {
      expect(result).toMatchObject({
        ok: false,
        reason: "filter_invalid",
        code: "graph_invalid",
        retryable: false,
      });
    }
    expect(caller.calls).toEqual([]);
  });

  it("names the channel to the slack poller so a drifted job file is refused, not obeyed", async () => {
    const caller = scriptedCaller(() => completed({ ok: true, observed: 0 }));

    await inbox(caller).take(
      pollRequest({ poller: "slack", filter: { scopes: ["C9"] } }),
    );

    expect(caller.calls[0].input).toEqual({
      factoryId: "factory-1",
      channelId: "C9",
    });
  });
});

describe("a status source", () => {
  it("reads the items in a status without polling anything", async () => {
    await insertRow({
      id: "started-1",
      status: "automation_started",
      updatedAt: NOW,
    });
    await insertRow({
      id: "started-2",
      source: "github",
      status: "automation_started",
    });
    await insertRow({ id: "queued" });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 0 }));

    const taken = await inbox(caller).take(statusRequest("automation_started"));

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items.map((item) => item.id)).toEqual([
      "started-1",
      "started-2",
    ]);
    expect(taken.totalAvailable).toBe(2);
    expect(caller.calls).toEqual([]);
  });

  it("bounds the take and says how many there were", async () => {
    for (let index = 0; index < 4; index += 1) {
      await insertRow({
        id: `a${index}`,
        status: "automation_started",
        updatedAt: `2026-10-18T09:0${index}:00.000Z`,
      });
    }

    const taken = await inbox(scriptedCaller(() => completed({}))).take(
      statusRequest("automation_started", 3),
    );

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items).toHaveLength(3);
    expect(taken.totalAvailable).toBe(4);
  });

  it("refuses a status that does not exist", async () => {
    const taken = await inbox(scriptedCaller(() => completed({}))).take(
      statusRequest("started-ish"),
    );

    expect(taken).toMatchObject({ ok: false, reason: "filter_invalid" });
  });

  it("round-trips an item a provider source stored", async () => {
    const items = createItemsHost({
      scope: SCOPE,
      ownerEmail: OWNER,
      getDatabase: () => db,
      clock: () => new Date(NOW),
    });
    const lead: NormalizedItem = {
      id: "lead-1",
      externalId: "hubspot-lead-1",
      kind: "lead",
      provider: "hubspot",
      title: "Acme asked for a demo",
      text: "They want SSO.",
      textRef: "blob://leads/1",
      url: "https://app.example.test/leads/1",
      author: "Pat Example",
      occurredAt: "2026-10-18T09:00:00.000Z",
      thread: { ticketId: undefined, repo: "acme/app" },
      extras: { plan: "team" },
      payload: { stage: "lead", score: 42 },
    };
    expect(await items.upsertItems({ items: [lead] })).toMatchObject({
      ok: true,
    });

    const taken = await inbox(scriptedCaller(() => completed({}))).take(
      statusRequest("received"),
    );

    if (!taken.ok) throw new Error("expected items");
    expect(taken.items).toHaveLength(1);
    expect(taken.items[0]).toMatchObject({
      id: "lead-1",
      externalId: "hubspot-lead-1",
      kind: "lead",
      provider: "hubspot",
      title: "Acme asked for a demo",
      text: "They want SSO.",
      textRef: "blob://leads/1",
      url: "https://app.example.test/leads/1",
      author: "Pat Example",
      occurredAt: "2026-10-18T09:00:00.000Z",
      thread: { repo: "acme/app" },
      extras: { plan: "team", status: "received" },
      payload: { stage: "lead", score: 42 },
    });
  });

  it("hands the engine bounded text and payload, and says what it cut", async () => {
    await insertRow({
      id: "big",
      status: "automation_started",
      summary: "w".repeat(3_000),
      payloadJson: JSON.stringify({ blob: "x".repeat(4_000) }),
    });

    const taken = await inbox(scriptedCaller(() => completed({}))).take(
      statusRequest("automation_started"),
    );

    if (!taken.ok) throw new Error("expected items");
    const [item] = taken.items;
    expect(item.text?.length).toBeLessThanOrEqual(2_048);
    expect(item.textTruncated).toBe(true);
    expect(item.payloadTruncated).toBe(true);
    expect(JSON.stringify(item.payload).length).toBeLessThanOrEqual(2_048);
  });
});

describe("a row that cannot be read", () => {
  it("fails the read and names the item instead of dropping it", async () => {
    await insertRow({ id: "fine" });
    await insertRow({ id: "broken", metadataJson: JSON.stringify([1, 2]) });
    const caller = scriptedCaller(() => completed({ ok: true, observed: 2 }));

    const taken = await inbox(caller).take(pollRequest({ poller: "slack" }));

    expect(taken).toMatchObject({
      ok: false,
      reason: "row_unreadable",
      code: "item_invalid",
      retryable: false,
    });
    expect(taken.ok ? "" : taken.message).toContain("broken");
  });

  it("does not guess a kind for a provider row that carries none", async () => {
    await insertRow({
      id: "mystery",
      source: "hubspot",
      status: "automation_started",
    });

    const taken = await inbox(scriptedCaller(() => completed({}))).take(
      statusRequest("automation_started"),
    );

    expect(taken).toMatchObject({ ok: false, reason: "row_unreadable" });
    expect(taken.ok ? "" : taken.message).toContain("no item kind");
  });

  it("rowToNormalizedItem throws on a row with an unusable url instead of dropping the field", () => {
    expect(() =>
      rowToNormalizedItem({
        id: "u",
        source: "slack",
        externalId: "u",
        sourceUrl: "javascript:alert(1)",
        title: "t",
        summary: null,
        status: "received",
        risk: "unknown",
        confidence: "unknown",
        channelId: null,
        threadTs: null,
        repository: null,
        pullRequestNumber: null,
        headSha: null,
        coverage: "complete",
        dedupeKey: "u",
        metadataJson: "{}",
        payloadJson: "{}",
        textRef: null,
        lastSeenAt: null,
        createdAt: EARLIER,
        updatedAt: EARLIER,
        ownerEmail: OWNER,
        orgId: SCOPE.orgId,
        factoryId: SCOPE.factoryId,
      }),
    ).toThrow(/valid item/);
  });
});

describe("the guarded action caller", () => {
  function registry(seen: unknown[]): Record<string, ActionEntry> {
    return {
      "poll-slack-channel": {
        tool: {
          description: "poll",
          parameters: { type: "object", properties: {} },
        },
        readOnly: true,
        run: async (args: unknown, context?: unknown) => {
          seen.push({ args, context });
          return { ok: true, observed: 0 };
        },
      },
      "poll-broken": {
        tool: {
          description: "broken",
          parameters: { type: "object", properties: {} },
        },
        readOnly: true,
        run: async () => {
          throw new Error("Slack channel not configured");
        },
      },
    };
  }

  it("runs the action as the workflow job would, with its lineage and run id", async () => {
    const seen: any[] = [];
    const caller = createGuardedActionCaller({
      actions: registry(seen),
      ownerEmail: OWNER,
      orgId: SCOPE.orgId,
      automation: {
        triggerId: "job-resource-1",
        triggerName: "factories/factory-1/bug-triage",
      },
      runId: "run-9",
    });

    const result = await caller({
      name: "poll-slack-channel",
      input: { factoryId: "factory-1" },
      callId: "wf-1:poll-slack-channel",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("completed");
    expect(JSON.parse(result.output)).toMatchObject({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].context).toMatchObject({
      caller: "automation",
      automation: {
        triggerId: "job-resource-1",
        triggerName: "factories/factory-1/bug-triage",
      },
      runId: "run-9",
      userEmail: OWNER,
      orgId: SCOPE.orgId,
      actionName: "poll-slack-channel",
    });
  });

  it("hands back a failing action as a failure, with its message", async () => {
    const caller = createGuardedActionCaller({
      actions: registry([]),
      ownerEmail: OWNER,
      orgId: SCOPE.orgId,
      automation: { triggerId: "j", triggerName: "factories/factory-1/x" },
      runId: "run-9",
    });

    const result = await caller({
      name: "poll-broken",
      input: {},
      callId: "c",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("failed");
    expect(result.output).toContain("Slack channel not configured");
  });

  it("does not run an action the registry does not have", async () => {
    const caller = createGuardedActionCaller({
      actions: registry([]),
      ownerEmail: OWNER,
      orgId: SCOPE.orgId,
      automation: { triggerId: "j", triggerName: "factories/factory-1/x" },
      runId: "run-9",
    });

    const result = await caller({
      name: "list-triage-items",
      input: {},
      callId: "c",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("failed");
  });
});
