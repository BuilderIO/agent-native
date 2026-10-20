import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "../catalog/index.js";
import { receiptKey } from "../contract.js";
import type { NormalizedItem } from "../items.js";
import { STORY_GRAPHS } from "../story-graphs.fixture.js";
import {
  eventsOf,
  last,
  normalizedItem,
  ran,
  sourceResult,
  stepOf,
  tick,
} from "../testing/engine-fixtures.js";
import { aiPerItem, ok, type AiResponder } from "../testing/fakes.js";
import { makeHost, seedWorkflow } from "../testing/make-host.js";
import { combinedItemId } from "./nodes/combine.js";

// These run the story graphs from the fixture, unchanged, through the real
// engine against the real catalog, with fake providers, a fake clock, and
// scripted model answers. Stories that wait or loop (1, 4, 7, 9, 10) need the
// next slice; 3, 5, 6 and 8 have no Wait, and the stuck path of 2 has none.

const MONDAY_8AM_NEW_YORK = "2026-10-19T12:00:00.000Z";
const FRIDAY_8AM_NEW_YORK = "2026-10-16T12:00:00.000Z";

/** The digest of the three commits the story-3 specs offer. */
const DIGEST_ID = combinedItemId({
  kind: "list",
  nodeId: "digest",
  memberIds: ["sha1", "sha2", "sha3"],
  windowStart: FRIDAY_8AM_NEW_YORK,
});

function hostFor(story: keyof typeof STORY_GRAPHS) {
  const test = makeHost({ catalog: OPERATION_CATALOG });
  return { test, seed: () => seedWorkflow(test, STORY_GRAPHS[story]) };
}

describe("story 3: the morning digest", () => {
  const commit = (sha: string, title: string) =>
    normalizedItem(sha, {
      kind: "commit",
      provider: "github",
      title,
      author: "ada",
      url: `https://github.test/commit/${sha}`,
      text: "A long commit body that a digest does not need.",
      payload: { sha, files: ["a.ts", "b.ts"] },
      extras: { sha },
    });

  async function setup(
    commits: readonly NormalizedItem[] = [
      commit("sha1", "Fix export button"),
      commit("sha2", "Speed up search"),
      commit("sha3", "Update docs"),
    ],
  ) {
    const { test, seed } = hostFor("morning-digest");
    const { id } = await seed();
    test.operations.script("github.listCommits", sourceResult(commits));
    test.operations.script(
      "slack.postMessage",
      ok(
        { ok: true },
        {
          externalRef: "1729.001",
          url: "https://slack.test/archives/C0DIGEST/p1729001",
        },
      ),
    );
    test.ai.respond(
      aiPerItem(() => ({ text: "TL;DR: three changes landed." })),
    );
    return { test, id };
  }

  it("reads Friday morning to Monday morning, and posts one AI-written message under a receipt", async () => {
    const { test, id } = await setup();

    const result = await ran(test, id, { scheduledFor: MONDAY_8AM_NEW_YORK });

    expect(result.run).toMatchObject({ status: "succeeded", mode: "live" });
    expect(result.clean).toBe(true);
    expect(result.steps.map((step) => [step.nodeId, step.status])).toEqual([
      ["weekdays8", "succeeded"],
      ["commits", "succeeded"],
      ["digest", "succeeded"],
      ["post", "succeeded"],
      ["done", "succeeded"],
    ]);
    expect(
      result.steps.map((step) =>
        Object.fromEntries(
          Object.entries(step.ports).map(([port, entry]) => [
            port,
            entry.count,
          ]),
        ),
      ),
    ).toEqual([{ out: 0 }, { out: 3 }, { out: 1 }, { out: 1 }, {}]);

    expect(test.operations.callsTo("github.listCommits")).toHaveLength(1);
    expect(test.operations.callsTo("github.listCommits")[0]).toMatchObject({
      credentialSlot: "github",
      limit: 100,
      fields: {
        repo: "example-org/example-repo",
        since: FRIDAY_8AM_NEW_YORK,
        until: MONDAY_8AM_NEW_YORK,
      },
    });

    // The model wrote the text; it saw the list, without the commit bodies.
    expect(test.ai.requests).toHaveLength(1);
    const asked = test.ai.requests[0];
    // The instruction is the one the graph's author wrote on the `text` field.
    const postNode = STORY_GRAPHS["morning-digest"].nodes.find(
      (node) => node.id === "post",
    );
    const written =
      postNode?.kind === "action" ? postNode.settings.args.text : undefined;
    expect(written).toMatchObject({ mode: "ai" });
    expect(asked.instruction).toBe(
      written?.mode === "ai" ? written.instruction : undefined,
    );
    expect(asked.resultSchemaFields).toEqual({
      text: { type: "string", description: "Message" },
    });
    expect(asked.items[0].item).toMatchObject({
      count: 3,
      truncated: false,
      totalAvailable: 3,
      items: [
        { id: "sha1", title: "Fix export button", author: "ada" },
        { id: "sha2" },
        { id: "sha3" },
      ],
    });
    expect(JSON.stringify(asked.items[0].item)).not.toContain(
      "long commit body",
    );

    const digestId = stepOf(result, "digest").ports.out.itemIds[0];
    expect(digestId).toBe(DIGEST_ID);
    const [post] = test.operations.callsTo("slack.postMessage");
    expect(post).toMatchObject({
      credentialSlot: "slack",
      mode: "live",
      fields: { to: "C0DIGEST", text: "TL;DR: three changes landed." },
      receiptKey: receiptKey({
        workflowId: id,
        itemId: digestId,
        nodeId: "post",
        attempt: 0,
      }),
    });
    expect(
      await test.store.getReceipt(test.scope, post.receiptKey ?? ""),
    ).toMatchObject({
      status: "done",
      externalRef: "1729.001",
      url: "https://slack.test/archives/C0DIGEST/p1729001",
    });
    expect(stepOf(result, "post").receiptKeys).toEqual([post.receiptKey]);

    // Commits are not inbox rows, so nothing is written to an inbox.
    expect(test.statuses.written).toEqual([]);
    expect(result.run.counts).toMatchObject({
      taken: 3,
      done: 1,
      modelCalls: 1,
    });

    expect(
      (await eventsOf(test, id, "sha1")).map((event) => [
        event.kind,
        event.nodeId,
      ]),
    ).toEqual([
      ["taken", "commits"],
      ["output", "digest"],
    ]);
    expect(
      (await eventsOf(test, id, digestId)).map((event) => [
        event.kind,
        event.nodeId,
      ]),
    ).toEqual([
      ["output", "digest"],
      ["effect", "post"],
      ["ended", "done"],
    ]);
  });

  it("does not post twice for one morning when the same tick is delivered again", async () => {
    const { test, id } = await setup();
    await ran(test, id, {
      tickKey: "2026-10-19T12:00:00Z",
      scheduledFor: MONDAY_8AM_NEW_YORK,
    });

    const again = await tick(test, id, {
      tickKey: "2026-10-19T12:00:00Z",
      scheduledFor: MONDAY_8AM_NEW_YORK,
    });

    // The first delivery used up what was due, so a second finds nothing to do.
    expect(again.kind).toBe("nothing_due");
    expect(test.operations.callsTo("slack.postMessage")).toHaveLength(1);
    expect(test.operations.callsTo("github.listCommits")).toHaveLength(1);
    expect(test.ai.requests).toHaveLength(1);
  });

  it("starts Tuesday's window where Monday's ended", async () => {
    const { test, id } = await setup();
    await ran(test, id, { scheduledFor: MONDAY_8AM_NEW_YORK });
    test.operations.script(
      "github.listCommits",
      sourceResult([commit("sha4", "Later")]),
    );
    test.operations.script(
      "slack.postMessage",
      ok(null, { externalRef: "1729.002" }),
    );
    test.ai.respond(aiPerItem(() => ({ text: "One change." })));

    await ran(test, id, { scheduledFor: "2026-10-20T12:00:00.000Z" });

    expect(
      test.operations.callsTo("github.listCommits")[1].fields,
    ).toMatchObject({
      since: MONDAY_8AM_NEW_YORK,
      until: "2026-10-20T12:00:00.000Z",
    });
  });

  it("still posts when there were no commits, with a count of zero for the text to say so", async () => {
    const { test, id } = await setup([]);

    const result = await ran(test, id, { scheduledFor: MONDAY_8AM_NEW_YORK });

    expect(stepOf(result, "commits").ports.out.count).toBe(0);
    expect(test.ai.requests[0].items[0].item).toMatchObject({
      count: 0,
      items: [],
    });
    expect(test.operations.callsTo("slack.postMessage")).toHaveLength(1);
    expect(result.run.status).toBe("succeeded");
  });

  it("says so when the window had more commits than it took, so the cut-off is not hidden", async () => {
    const many = Array.from({ length: 150 }, (_, index) =>
      commit(`sha${index}`, `Change ${index}`),
    );
    const { test, id } = await setup(many);

    const result = await ran(test, id, { scheduledFor: MONDAY_8AM_NEW_YORK });

    expect(stepOf(result, "commits")).toMatchObject({
      truncated: { totalAvailable: 150 },
      fields: { cutBy: "count", taken: 100 },
    });
    expect(test.ai.requests[0].items[0].item).toMatchObject({
      count: 100,
      truncated: true,
      totalAvailable: 150,
    });
  });

  it("walks the whole digest dry, writing the message it would send and posting nothing", async () => {
    const { test, id } = await setup();

    const result = await ran(test, id, {
      mode: "dry",
      scheduledFor: MONDAY_8AM_NEW_YORK,
    });

    expect(result.clean).toBe(true);
    expect(test.operations.callsTo("slack.postMessage")).toHaveLength(0);
    expect(test.ai.requests).toHaveLength(1);
    expect(stepOf(result, "post").fields).toMatchObject({
      wouldCallCount: 1,
      wouldCall: [
        {
          item: DIGEST_ID,
          fields: expect.stringContaining("TL;DR: three changes landed."),
        },
      ],
    });
    expect(
      (await test.store.getWorkflow(test.scope, id))?.lastTriggerAt,
    ).toBeNull();
  });
});

describe("story 6: a support ticket to the right place", () => {
  const ticket = (id: string, email: string) =>
    normalizedItem(id, {
      kind: "ticket",
      provider: "pylon",
      author: email,
      thread: { ticketId: id },
      extras: { state: "new" },
    });

  const classes: Record<string, Record<string, unknown>> = {
    "t-bug": {
      category: "bug",
      severity: "medium",
      confidence: "high",
      summary: "Export fails",
    },
    "t-bill-ok": {
      category: "billing",
      severity: "low",
      confidence: "high",
      summary: "Invoice question",
    },
    "t-bill-unsure": {
      category: "billing",
      severity: "low",
      confidence: "medium",
      summary: "Refund question",
    },
    "t-urgent": {
      category: "urgent",
      severity: "high",
      confidence: "high",
      summary: "Customer is down",
    },
    "t-other": {
      category: "other",
      severity: "low",
      confidence: "high",
      summary: "How do I export?",
    },
  };
  const answers: Record<string, Record<string, unknown>> = {
    "t-bill-ok": {
      answer: "Your invoice is paid and your plan is Pro.",
      supported: true,
      confidence: "high",
    },
    "t-bill-unsure": {
      answer: "You may be owed a refund of $12.",
      supported: false,
      confidence: "low",
    },
  };

  const model: AiResponder = (request) => {
    const shape = Object.keys(request.resultSchemaFields).sort().join(",");
    const per = (answer: Parameters<typeof aiPerItem>[0]) =>
      aiPerItem(answer)(request);
    switch (shape) {
      case "category,confidence,severity,summary":
        return per((item) => classes[item.id]);
      case "answer,confidence,supported":
        return per((item) => answers[item.id]);
      case "description,title":
        return per(() => ({
          title: "Export fails",
          description: "Steps to reproduce.",
        }));
      case "bodyHtml":
        return per(() => ({ bodyHtml: "<p>Suggested reply</p>" }));
      default:
        throw new Error(
          `The model was asked for an unexpected shape: ${shape}`,
        );
    }
  };

  async function setup() {
    const { test, seed } = hostFor("support-ticket-routing");
    const { id } = await seed();
    test.operations.script(
      "pylon.newTickets",
      sourceResult(
        [
          ticket("t-bug", "bug@customer.test"),
          ticket("t-bill-ok", "ok@customer.test"),
          ticket("t-bill-unsure", "unsure@customer.test"),
          ticket("t-urgent", "urgent@customer.test"),
          ticket("t-other", "other@customer.test"),
        ],
        { cursor: "2026-10-19T11:59:00Z" },
      ),
    );
    test.operations.always(
      "pylon.ticketThread",
      ok({ data: [{ id: "msg-1" }] }),
    );
    test.operations.always(
      "stripe.customerBilling",
      ok({ data: [{ id: "cus_1" }] }),
    );
    test.operations.always(
      "jira.createIssue",
      ok(null, { externalRef: "EX-1" }),
    );
    const ref = (request: {
      operation: { id: string };
      fields: Record<string, unknown>;
    }) =>
      ok(null, {
        externalRef: `${request.operation.id}:${String(request.fields.ticketId ?? request.fields.to)}`,
      });
    test.operations.always("pylon.addNote", ref);
    test.operations.always("pylon.reply", ref);
    test.operations.always("slack.postMessage", ref);
    test.operations.always("email.send", ref);
    test.ai.always(model);
    return { test, id };
  }

  it("lands each category where the story says, and sends the customer only what Stripe supports", async () => {
    const { test, id } = await setup();

    const result = await ran(test, id);

    expect(result.run).toMatchObject({ status: "succeeded" });
    expect(result.run.counts).toEqual({
      taken: 5,
      done: 3,
      dismissed: 0,
      needsManual: 2,
      released: 0,
      itemFailures: 0,
      needsCheck: 0,
      skippedRows: 0,
      modelCalls: 4,
      parked: 0,
      woke: 0,
      stillWaiting: 0,
      sentBack: 0,
      loopLimited: 0,
      graphChanged: 0,
      retryParked: 0,
      retried: 0,
      setAside: 0,
      continued: 0,
      heldBack: 0,
    });
    expect(result.clean).toBe(true);

    expect(stepOf(result, "route").ports).toEqual({
      "route:bug": { count: 1, itemIds: ["t-bug"] },
      "route:billing": { count: 2, itemIds: ["t-bill-ok", "t-bill-unsure"] },
      "route:urgent": { count: 1, itemIds: ["t-urgent"] },
      otherwise: { count: 1, itemIds: ["t-other"] },
    });
    expect(stepOf(result, "sure").ports).toMatchObject({
      match: { itemIds: ["t-bill-ok"] },
      otherwise: { itemIds: ["t-bill-unsure"] },
    });
    // The answer that passed it states no amount or date, so it goes on to the customer.
    expect(stepOf(result, "hasFigures").ports).toMatchObject({
      otherwise: { itemIds: ["t-bill-ok"] },
    });

    // A bug: a Jira issue, then a note naming it, then the customer is told.
    expect(test.operations.callsTo("jira.createIssue")[0].fields).toEqual({
      projectKey: "EXAMPLE",
      title: "Export fails",
      description: "Steps to reproduce.",
      issueType: "Bug",
    });
    const replies = test.operations.callsTo("pylon.reply");
    const notes = test.operations.callsTo("pylon.addNote");
    expect(
      notes.map((call) => [call.fields.ticketId, call.fields.bodyHtml]),
    ).toEqual([
      ["t-bug", "Logged in Jira: EX-1"],
      ["t-other", "<p>Suggested reply</p>"],
    ]);
    // Billing: the supported answer goes to its customer; the unsure one never does.
    expect(
      replies.map((call) => [call.fields.ticketId, call.fields.messageId]),
    ).toEqual([
      ["t-bug", "msg-1"],
      ["t-bill-ok", "msg-1"],
    ]);
    expect(
      replies.find((call) => call.fields.ticketId === "t-bill-ok")?.fields
        .bodyHtml,
    ).toBe("Your invoice is paid and your plan is Pro.");
    expect(
      replies.some((call) => call.fields.ticketId === "t-bill-unsure"),
    ).toBe(false);
    expect(replies.some((call) => call.fields.ticketId === "t-urgent")).toBe(
      false,
    );

    // Finance sees the draft the customer did not; the support lead sees the urgent ticket twice over.
    const slack = test.operations.callsTo("slack.postMessage");
    expect(slack.map((call) => call.fields.to).sort()).toEqual([
      "C0FINANCE",
      "support-lead@example.test",
    ]);
    expect(
      slack.find((call) => call.fields.to === "C0FINANCE")?.fields.text,
    ).toBe("Draft for Item t-bill-unsure: You may be owed a refund of $12.");
    expect(test.operations.callsTo("email.send")[0].fields).toMatchObject({
      to: "support-lead@example.test",
      subject: "Urgent ticket: Item t-urgent",
      body: "Customer is down",
    });

    // Each ticket ends where its path ends; the tickets are inbox rows, so the inbox is told.
    expect(
      Object.fromEntries(
        test.statuses.written.map((entry) => [entry.itemId, entry.status]),
      ),
    ).toEqual({
      "t-bug": "resolved",
      "t-bill-ok": "resolved",
      "t-other": "resolved",
      "t-bill-unsure": "needs_manual",
      "t-urgent": "needs_manual",
    });

    // The cursor is saved, and every write has a closed receipt.
    expect(
      (
        await test.store.getSourceCursor(test.scope, {
          workflowId: id,
          nodeId: "tickets",
        })
      )?.value,
    ).toBe("2026-10-19T11:59:00Z");
    for (const nodeId of [
      "jira",
      "note",
      "replyCustomer",
      "sendAnswer",
      "finance",
      "lead",
      "leadEmail",
      "suggest",
    ]) {
      const keys = stepOf(result, nodeId).receiptKeys ?? [];
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect((await test.store.getReceipt(test.scope, key))?.status).toBe(
          "done",
        );
      }
    }
  });

  it("gives every ticket a row in the inbox before the story moves it, so each ends where the story says", async () => {
    const { test, id } = await setup();
    test.statuses.requireRows();

    const result = await ran(test, id);

    // Without a row an End cannot set a status: every one of these would have failed.
    expect(result.run.counts).toMatchObject({
      taken: 5,
      done: 3,
      needsManual: 2,
      itemFailures: 0,
    });
    expect([...test.statuses.rows.keys()].sort()).toEqual([
      "t-bill-ok",
      "t-bill-unsure",
      "t-bug",
      "t-other",
      "t-urgent",
    ]);
    expect(test.statuses.rows.get("t-bug")).toMatchObject({
      provider: "pylon",
      kind: "ticket",
    });
    expect(test.statuses.written.map((entry) => entry.itemId).sort()).toEqual([
      "t-bill-ok",
      "t-bill-unsure",
      "t-bug",
      "t-other",
      "t-urgent",
    ]);
    expect(test.statuses.statusOf("t-bug")).toBe("resolved");
    expect(test.statuses.statusOf("t-urgent")).toBe("needs_manual");
  });

  it("stores no ticket when the same story runs dry", async () => {
    const { test, id } = await setup();
    test.statuses.requireRows();

    const result = await ran(test, id, { mode: "dry" });

    expect(result.clean).toBe(true);
    expect(test.statuses.upserts).toEqual([]);
    expect(test.statuses.rows.size).toBe(0);
  });

  it("leaves a journey for one ticket that reads in order, receipts and all", async () => {
    const { test, id } = await setup();
    await ran(test, id);

    const journey = await eventsOf(test, id, "t-bug");

    expect(journey.map((event) => [event.kind, event.nodeId])).toEqual([
      ["taken", "tickets"],
      ["output", "thread"],
      ["output", "classify"],
      ["decision", "route"],
      ["effect", "jira"],
      ["effect", "note"],
      ["effect", "replyCustomer"],
      ["ended", "done"],
    ]);
    expect(journey[3]).toMatchObject({
      port: "route:bug",
      summary: "route: Bug",
    });
    expect(journey[4]).toMatchObject({
      summary: "called jira.createIssue -> EX-1",
      receiptKey: receiptKey({
        workflowId: id,
        itemId: "t-bug",
        nodeId: "jira",
        attempt: 0,
      }),
    });
  });

  it("runs the same graph dry with every read and model answer real, and nothing sent", async () => {
    const { test, id } = await setup();

    const result = await ran(test, id, { mode: "dry" });

    expect(result.clean).toBe(true);
    for (const op of [
      "jira.createIssue",
      "pylon.addNote",
      "pylon.reply",
      "slack.postMessage",
      "email.send",
    ]) {
      expect(test.operations.callsTo(op)).toHaveLength(0);
    }
    expect(test.operations.callsTo("pylon.ticketThread")).toHaveLength(5);
    expect(test.operations.callsTo("stripe.customerBilling")).toHaveLength(2);
    expect(test.ai.requests).toHaveLength(4);
    expect(test.statuses.written).toEqual([]);
    expect(
      await test.store.getSourceCursor(test.scope, {
        workflowId: id,
        nodeId: "tickets",
      }),
    ).toBeNull();
    expect(stepOf(result, "note").fields).toMatchObject({ wouldCallCount: 1 });
    expect(stepOf(result, "suggest").fields).toMatchObject({
      wouldCallCount: 1,
    });
  });

  it("hands a ticket to a person, with nothing sent to the customer, when its classification cannot be read", async () => {
    const { test, id } = await setup();
    classes["t-other"] = {
      category: "other",
      severity: "low",
      confidence: "high",
    };

    const result = await ran(test, id);

    // The model left out the summary, so that one ticket fails and the other four carry on.
    expect(result.run.counts.itemFailures).toBe(1);
    expect(stepOf(result, "classify").error?.code).toBe("ai_invalid_output");
    expect(result.run.counts).toMatchObject({
      taken: 5,
      done: 2,
      needsManual: 2,
    });
    expect(
      test.statuses.written.some((entry) => entry.itemId === "t-other"),
    ).toBe(false);
    classes["t-other"] = {
      category: "other",
      severity: "low",
      confidence: "high",
      summary: "How do I export?",
    };
  });
});

describe("story 2: a Builder task that is stuck", () => {
  const report = (id: string) =>
    normalizedItem(id, {
      title: `Report ${id}`,
      extras: {
        builderTaskId: "task-1",
        projectId: "project-1",
        branchName: "factory-g1",
        repository: "example-org/example-repo",
      },
    });

  async function setup() {
    const { test, seed } = hostFor("builder-to-merge");
    const { id } = await seed();
    test.inbox.always("status", {
      ok: true,
      items: [report("r1"), report("r2")],
    });
    test.operations.always(
      "builder.check",
      ok({ state: "stuck", hasPullRequest: false }),
    );
    test.operations.always(
      "builder.followUp",
      ok({ accepted: true }, { externalRef: "factory-g1" }),
    );
    test.operations.always(
      "slack.postMessage",
      ok(null, { externalRef: "1.1" }),
    );
    return { test, id };
  }

  it("checks the task once for its two reports, nudges it, and tries again next tick", async () => {
    const { test, id } = await setup();

    const first = await ran(test, id);

    expect(test.inbox.requests[0].settings).toMatchObject({
      source: "status",
      status: "automation_started",
    });
    expect(stepOf(first, "byTask").ports.out.count).toBe(1);
    const check = test.operations.callsTo("builder.check");
    expect(check).toHaveLength(1);
    expect(check[0].fields).toEqual({
      projectId: "project-1",
      branchName: "factory-g1",
    });
    expect(stepOf(first, "state").ports).toMatchObject({
      "route:stuck": { count: 1 },
      "route:hasPr": { count: 0 },
    });
    expect(test.operations.callsTo("builder.followUp")).toHaveLength(1);
    // Every node ran, even the ones that were handed nothing, and the run is whole.
    expect(first.steps).toHaveLength(
      STORY_GRAPHS["builder-to-merge"].nodes.length,
    );
    expect(stepOf(first, "readPr")).toMatchObject({
      status: "succeeded",
      fields: { in: 0 },
    });
    expect(first.run.counts).toMatchObject({
      taken: 2,
      released: 1,
      needsManual: 0,
    });
    // Released: nothing about the reports changes, and they are taken again next tick.
    expect(test.statuses.written).toEqual([]);
  });

  it("nudges twice, then tells the triage owner and hands the reports to a person", async () => {
    const { test, id } = await setup();

    await ran(test, id);
    await ran(test, id);
    expect(test.operations.callsTo("builder.followUp")).toHaveLength(2);
    expect(test.operations.callsTo("slack.postMessage")).toHaveLength(0);

    const third = await ran(test, id);

    // A third tick does not nudge a third time: the group has been nudged twice.
    expect(test.operations.callsTo("builder.followUp")).toHaveLength(2);
    expect(test.operations.callsTo("slack.postMessage")).toHaveLength(1);
    expect(test.operations.callsTo("slack.postMessage")[0].fields).toEqual({
      to: "triage-owner@example.test",
      text: "Builder is stuck on Report r1",
    });
    // The group stands for both reports, so both are handed to a person.
    expect(
      Object.fromEntries(
        test.statuses.written.map((entry) => [entry.itemId, entry.status]),
      ),
    ).toEqual({ r1: "needs_manual", r2: "needs_manual" });
    expect(third.run.counts).toMatchObject({ needsManual: 1 });
    const groupId = stepOf(third, "byTask").ports.out.itemIds[0];
    expect(
      (await test.store.getItemState(test.scope, id, groupId))?.counters,
    ).toMatchObject({
      nudges: 2,
      rounds: 2,
    });
    expect(last(await eventsOf(test, id, "r2"))).toMatchObject({
      kind: "ended",
      summary: expect.stringContaining(`through ${groupId}`),
    });
  });
});
