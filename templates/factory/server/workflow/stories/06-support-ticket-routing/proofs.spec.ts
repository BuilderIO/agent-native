import { describe, expect, it } from "vitest";

import {
  callsTo,
  effectsOf,
  endedWith,
  scenarioRun,
  tickAt,
} from "../proof-kit.js";
import { STORIES } from "../registry.js";

const STORY = "support-ticket-routing";
const EACH = "each-category-lands-where-the-story-says";
const FIGURES =
  "an-answer-that-states-an-amount-or-a-date-goes-to-finance-whatever-the-model-says";
const PYLON_WRITES = ["pylon.reply", "pylon.addNote"];
const graph = STORIES[STORY].graph;
const edgesInto = (nodeId: string) =>
  graph.edges
    .filter((edge) => edge.to.node === nodeId)
    .map((edge) => `${edge.from.node}:${edge.from.port}`)
    .sort();

const forTicket = (
  effects: ReturnType<typeof effectsOf>,
  ticket: string,
): string[] =>
  effects
    .filter((effect) => effect.item === ticket)
    .map((effect) => `${effect.node}:${effect.operation}`);

describe("story 6 proofs: support ticket to the right place", () => {
  it("lands each category where the story says", async () => {
    const { summary } = await scenarioRun(STORY, EACH);
    const effects = effectsOf(summary);

    expect(forTicket(effects, "t-bug")).toEqual([
      "jira:jira.createIssue",
      "note:pylon.addNote",
      "replyCustomer:pylon.reply",
    ]);
    expect(forTicket(effects, "t-bill-ok")).toEqual(["sendAnswer:pylon.reply"]);
    expect(forTicket(effects, "t-bill-unsure")).toEqual([
      "finance:slack.postMessage",
    ]);
    expect(forTicket(effects, "t-urgent")).toEqual([
      "lead:slack.postMessage",
      "leadEmail:email.send",
    ]);
    expect(forTicket(effects, "t-other")).toEqual(["suggest:pylon.addNote"]);
    expect(summary.statuses).toEqual({
      "t-bug": "resolved",
      "t-bill-ok": "resolved",
      "t-other": "resolved",
      "t-bill-unsure": "needs_manual",
      "t-urgent": "needs_manual",
    });
    // The Jira note names the issue the Jira write returned.
    expect(effects.find((e) => e.node === "note")?.fields.bodyHtml).toBe(
      "Logged in Jira: EXAMPLE-1",
    );
    expect(effects.find((e) => e.node === "finance")?.fields.to).toBe(
      "C0FINANCE",
    );
    expect(
      effects.filter((e) => e.node === "lead" || e.node === "leadEmail"),
    ).toSatisfy((both: typeof effects) =>
      both.every((e) => e.fields.to === "support-lead@example.test"),
    );
  });

  it("never replies to an urgent ticket on its own", async () => {
    const { summary } = await scenarioRun(STORY, EACH);

    const pylonWrites = effectsOf(summary).filter((effect) =>
      PYLON_WRITES.includes(effect.operation),
    );
    expect(pylonWrites.map((effect) => effect.item)).not.toContain("t-urgent");
    expect(endedWith(summary, "needsManual")).toContain("t-urgent");
  });

  it("sends the customer only the validated answer, and only behind the supported-and-sure and no-figures filters", async () => {
    const { summary } = await scenarioRun(STORY, EACH);

    const answers = effectsOf(summary).filter(
      (effect) => effect.node === "sendAnswer",
    );
    expect(answers).toHaveLength(1);
    expect(answers[0].fields.bodyHtml).toBe(
      "Your latest invoice is paid and your plan is Pro.",
    );
    // Every answer sent passed both filters; the unsure one stopped at the first and went to finance with its draft.
    expect(summary.journeys["t-bill-ok"]).toContain("decision@sure:match");
    expect(summary.journeys["t-bill-ok"]).toContain(
      "decision@hasFigures:otherwise",
    );
    expect(summary.journeys["t-bill-unsure"]).toContain(
      "decision@sure:otherwise",
    );
    expect(summary.journeys["t-bill-unsure"]).not.toContain(
      "effect@sendAnswer",
    );
    const draft = effectsOf(summary, "slack.postMessage").find(
      (effect) => effect.node === "finance",
    );
    expect(draft?.fields.text).toContain("You may be owed a $12.00 refund");
  });

  it("reaches the customer's reply only through the no-figures filter, and gives finance every held answer", () => {
    expect(edgesInto("sendAnswer")).toEqual(["hasFigures:otherwise"]);
    expect(edgesInto("hasFigures")).toEqual(["sure:match"]);
    expect(edgesInto("finance")).toEqual([
      "hasFigures:match",
      "sure:otherwise",
    ]);
    // Any digit in the answer text, and nothing the model says about itself.
    const filter = graph.nodes.find((node) => node.id === "hasFigures");
    expect(filter?.kind === "filter" && filter.settings.combinator).toBe("any");
    expect(filter?.kind === "filter" && filter.settings.rules).toEqual(
      Array.from({ length: 10 }, (_, digit) => ({
        left: "nodes.answer.answer",
        op: "contains",
        right: String(digit),
      })),
    );
  });

  it("asks Stripe about the ticket's own customer and nobody else, and only for billing tickets", async () => {
    const { run } = await scenarioRun(STORY, EACH);

    const asked = run.ticks[0].calls
      .filter((call) => call.operation.id === "stripe.customerBilling")
      .map((call) => call.fields.email);
    expect(asked).toEqual([
      "ok@customer.example.test",
      "unsure@customer.example.test",
    ]);
    // The lookup is keyed by the requester's email, the ticket's own `author`.
    const lookup = STORIES[STORY].graph.nodes.find(
      (node) => node.id === "stripe",
    );
    expect(lookup?.kind === "lookup" && lookup.settings.args.email).toEqual({
      mode: "path",
      path: "item.author",
    });
  });

  it("replies to a ticket at most once", async () => {
    const { summary } = await scenarioRun(STORY, EACH);

    const replies = effectsOf(summary, "pylon.reply").map(
      (effect) => effect.item,
    );
    expect(new Set(replies).size).toBe(replies.length);
  });

  it("does not handle a ticket twice when the provider offers it again", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "a-ticket-offered-again-after-it-was-handled-is-not-handled-twice",
    );

    expect(callsTo(summary, "pylon.reply")).toBe(1);
    expect(callsTo(summary, "jira.createIssue")).toBe(1);
    expect(tickAt(summary, 1).ai).toEqual([]);
    const source = run.ticks[1].steps.find((step) => step.nodeId === "tickets");
    expect(source?.fields).toMatchObject({ taken: 0, alreadyHandled: 1 });
  });

  it("fails a ticket whose classification cannot be read, alone, and sends nothing for it", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-ticket-whose-classification-cannot-be-read-fails-alone",
    );

    expect(tickAt(summary, 0).nodes.classify).toMatchObject({
      status: "failed",
      error: "ai_invalid_output",
    });
    // Set aside for a retry each time it fails, and brought back once.
    expect(summary.journeys["t-other"]).toEqual([
      "error@classify:ai_invalid_output",
      "parked@classify",
      "woke@classify:?",
      "error@classify:ai_invalid_output",
      "parked@classify",
    ]);
    expect(forTicket(effectsOf(summary), "t-other")).toEqual([]);
    expect(summary.statuses["t-bug"]).toBe("resolved");
  });

  it("hands an unreadable ticket to a person on the third attempt, with nothing sent to the customer", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "an-unreadable-ticket-that-is-offered-again-is-handed-to-a-person-on-the-third-try",
    );

    expect(summary.ticks.map((tick) => tick.run?.counts.needsManual)).toEqual([
      undefined,
      undefined,
      1,
    ]);
    expect(summary.statuses).toEqual({ "t-other": "needs_manual" });
    expect(effectsOf(summary)).toEqual([]);
  });

  it("never classifies a ticket from a thread that returned nothing", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-thread-that-returns-nothing-is-a-failed-lookup-not-an-empty-ticket",
    );

    expect(tickAt(summary, 0).nodes.thread.error).toBe("lookup_failed");
    expect(tickAt(summary, 0).ai).toEqual([]);
    expect(effectsOf(summary)).toEqual([]);
  });

  it("tests one node on a pinned ticket without reading or sending anything", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-test-of-the-classify-node-runs-on-a-sample-ticket-and-sends-nothing",
    );

    expect(tickAt(summary, 0)).toMatchObject({
      mode: "test",
      calls: {},
      effects: [],
    });
    expect(Object.keys(tickAt(summary, 0).nodes)).toEqual(["classify"]);
  });

  it("sends nothing from a dry run", async () => {
    const { summary } = await scenarioRun(STORY, "a-dry-run-sends-nothing");

    expect(effectsOf(summary)).toEqual([]);
    for (const operation of [
      "jira.createIssue",
      "pylon.addNote",
      "pylon.reply",
      "slack.postMessage",
      "email.send",
    ]) {
      expect(callsTo(summary, operation), operation).toBe(0);
    }
  });

  describe("a billing answer with a fact that is not in the Stripe data", () => {
    // `supported` and `confidence` are the model's own flags: no code compares the answer with the data.
    // Only a digit in the answer text is checked in code, so an amount or a date never goes out unseen.
    it("tells the model Stripe amounts are cents and to flag an answer the data does not give", () => {
      const answer = graph.nodes.find((node) => node.id === "answer");
      const instruction =
        answer?.kind === "ai" ? answer.settings.instruction : "";
      expect(instruction).toContain("Stripe stores amounts in cents");
      expect(instruction).toContain("never 4000 USD");
      expect(instruction).toContain("Use only facts present in that data");
      expect(instruction).toContain(
        "set supported to false and confidence to low",
      );
    });

    it("is held back when the model says it is not supported", async () => {
      const { summary } = await scenarioRun(STORY, EACH);

      expect(
        effectsOf(summary, "pylon.reply").map((e) => e.item),
      ).not.toContain("t-bill-unsure");
      expect(summary.statuses["t-bill-unsure"]).toBe("needs_manual");
    });

    it("goes to finance, not the customer, when it states an amount or a date, whatever the model says about itself", async () => {
      const { summary } = await scenarioRun(STORY, FIGURES);

      expect(callsTo(summary, "pylon.reply")).toBe(0);
      expect(summary.journeys["t-bill-claimed"]).toEqual([
        "decision@route:route:billing",
        "decision@sure:match",
        "decision@hasFigures:match",
        "effect@finance",
        "ended@manual:needsManual",
      ]);
      expect(effectsOf(summary, "slack.postMessage")[0]).toMatchObject({
        node: "finance",
        fields: {
          to: "C0FINANCE",
          text: expect.stringContaining("$40.00 on October 3, 2026"),
        },
      });
      expect(summary.statuses["t-bill-claimed"]).toBe("needs_manual");
    });

    it("is sent when the model wrongly says it is supported and writes no figure: the gap, kept visible", async () => {
      const { summary } = await scenarioRun(
        STORY,
        "a-model-claiming-support-for-an-invented-fact-is-believed",
      );

      expect(effectsOf(summary, "pylon.reply")[0].fields.bodyHtml).toContain(
        "refunded the duplicate charge",
      );
    });

    it.todo(
      "an answer whose amounts or dates are not in the Stripe lookup result is never sent, whatever the model says about its own support, and an answer that states an amount or date can be sent when every one of them is in the lookup result: today any digit sends the answer to finance (so cents shown as dollars are caught, and so is every correct amount), and a plan name or a claim without a digit is still sent on the model's `supported` flag alone. Fix: a check on the model-written answer against the lookup result (every amount and date must appear in it, cents read as dollars) before `sendAnswer`, which needs an engine feature no node kind provides; then `hasFigures` can go",
    );
  });

  it.todo(
    "a ticket whose classification cannot be read is set aside and brought back after 5 and then 10 minutes, and handed to a person after three attempts: the scenario that shows it now parks and retries the ticket; the third failure, at the right times, is still to be scripted",
  );
  it.todo(
    "a customer email that is not in Stripe, or matches several customers, goes to a person: the rules language cannot count a list, so only the model's flag stands between that lookup and a customer reply",
  );
});
