import { describe, expect, it } from "vitest";

import { callsTo, effectsOf, scenarioRun, tickAt } from "../proof-kit.js";
import { STORIES } from "../registry.js";

const STORY = "hot-lead-routing";
const nodesOf = (effects: { node: string }[]) =>
  effects.map((effect) => effect.node);

describe("story 4 proofs: hot-lead routing with an SLA", () => {
  it("gives a hot lead one task and one message, and says nothing more when the owner answers in the thread", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "owner-replies-in-the-thread-and-nothing-escalates",
    );

    expect(effectsOf(summary, "hubspot.createTask")).toHaveLength(1);
    expect(effectsOf(summary, "hubspot.createTask")[0]).toMatchObject({
      item: "lead-hot",
      fields: {
        contactId: "lead-hot",
        ownerId: "owner-1",
        title: "Follow up: pat@prospect.example.test",
        due: "today",
      },
    });
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(effectsOf(summary, "slack.postMessage")[0].fields.to).toBe(
      "U0OWNER",
    );
    // The owner answered, so neither the manager nor the sales channel is told, by Slack or email.
    expect(callsTo(summary, "email.send")).toBe(0);
    expect(nodesOf(effectsOf(summary))).toEqual(["task", "tellOwner"]);
    expect(tickAt(summary, 2).nodes.ack1.ports).toEqual({ replied: 1 });
    expect(summary.statuses).toEqual({ "lead-hot": "resolved" });
    expect(summary.parked).toEqual([]);
  });

  it("counts the ack reaction from the owner as an answer", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "the-ack-reaction-counts-as-an-answer",
    );

    expect(tickAt(summary, 1).nodes.ack1.ports).toEqual({ replied: 1 });
    expect(nodesOf(effectsOf(summary))).toEqual(["task", "tellOwner"]);
    expect(summary.statuses).toEqual({ "lead-hot": "resolved" });
  });

  it("does not escalate after an answer, even when the scheduler looked late", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-late-tick-still-counts-an-answer-given-in-time",
    );

    // The look came after the two hours were up, and the answer found there still wins.
    expect(tickAt(summary, 1).nodes.ack1.ports).toEqual({ replied: 1 });
    expect(nodesOf(effectsOf(summary))).toEqual(["task", "tellOwner"]);
  });

  it("tells the manager after two silent hours and the sales channel after two more, in that order and once each", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "nobody-answers-so-the-manager-is-told-and-then-the-sales-channel",
    );

    expect(nodesOf(effectsOf(summary))).toEqual([
      "task",
      "tellOwner",
      "mgrSlack",
      "mgrEmail",
      "salesChannel",
    ]);
    // Nothing is sent while the owner's two hours run, or while the manager's do.
    expect(tickAt(summary, 1).effects).toEqual([]);
    expect(tickAt(summary, 3).effects).toEqual([]);
    expect(tickAt(summary, 2).nodes.ack1.ports).toEqual({ timedOut: 1 });
    expect(tickAt(summary, 4).nodes.ack2.ports).toEqual({ timedOut: 1 });
    expect(
      effectsOf(summary, "slack.postMessage").map((e) => e.fields.to),
    ).toEqual(["U0OWNER", "manager@example.test", "C0SALES"]);
    expect(effectsOf(summary, "email.send")).toHaveLength(1);
    // The second miss ends in the channel and hands the lead to a person.
    expect(summary.statuses).toEqual({ "lead-hot": "needs_manual" });
    expect(summary.parked).toEqual([]);
  });

  it("lets the manager end the second wait with a reply, and then posts nothing in the sales channel", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "the-manager-answers-the-second-wait",
    );

    expect(tickAt(summary, 2).nodes.ack2.ports).toEqual({ replied: 1 });
    expect(nodesOf(effectsOf(summary))).toEqual([
      "task",
      "tellOwner",
      "mgrSlack",
      "mgrEmail",
    ]);
    expect(summary.statuses).toEqual({ "lead-hot": "resolved" });
  });

  it("does not take a stranger's reply or a bot's message as an answer to either wait", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "strangers-and-bots-do-not-count-as-an-answer",
    );

    expect(tickAt(summary, 1).nodes).toEqual({});
    expect(tickAt(summary, 2).nodes.ack1.ports).toEqual({ timedOut: 1 });
    expect(tickAt(summary, 3).nodes).toEqual({});
    expect(tickAt(summary, 4).nodes.ack2.ports).toEqual({ timedOut: 1 });
    expect(summary.statuses).toEqual({ "lead-hot": "needs_manual" });
    // Who may answer is the Wait's setting; the host's thread reader applies it
    // (`workflow-host/thread-reader.ts`, proved in its own spec) and so does the
    // fake used here, which also drops bots.
    const accepted = run.world.test.threads.requests.map(
      (request) => request.acceptFrom,
    );
    expect(accepted.slice(0, 2)).toEqual(["owner", "owner"]);
    expect(accepted[accepted.length - 1]).toEqual({
      emails: ["owner@example.test", "manager@example.test"],
    });
  });

  it("routes three leads to three places: a task and a message, the nurture list, and a dismissal with its reason", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "three-leads-take-three-routes",
    );

    expect(tickAt(summary, 0).nodes.tier.ports).toEqual({
      "route:hot": 1,
      "route:warm": 1,
      otherwise: 1,
    });
    expect(effectsOf(summary, "hubspot.createTask").map((e) => e.item)).toEqual(
      ["lead-hot"],
    );
    expect(effectsOf(summary, "slack.postMessage").map((e) => e.item)).toEqual([
      "lead-hot",
    ]);
    expect(effectsOf(summary, "hubspot.addToList")).toMatchObject([
      { item: "lead-warm", fields: { listId: "list-1", leadId: "lead-warm" } },
    ]);
    const dismissed = run.world.test.statuses.written.find(
      (entry) => entry.itemId === "lead-cold",
    );
    expect(dismissed).toMatchObject({
      status: "dismissed",
      reason: "Not a buyer: student project, no company.",
    });
    expect(summary.statuses).toEqual({
      "lead-hot": "resolved",
      "lead-warm": "resolved",
      "lead-cold": "dismissed",
    });
  });

  it("does not process a lead twice when the source offers it again, while it waits or after it ended", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "a-lead-offered-again-is-not-processed-twice",
    );

    const leadsStep = (tick: number) =>
      run.ticks[tick].steps.find((step) => step.nodeId === "leads");
    // Offered every tick; taken once.
    expect(callsTo(summary, "hubspot.newLeads")).toBe(5);
    expect(leadsStep(1)?.fields).toMatchObject({
      taken: 0,
      heldByAnotherRun: 1,
    });
    expect(leadsStep(2)?.fields).toMatchObject({
      taken: 0,
      heldByAnotherRun: 1,
    });
    expect(leadsStep(3)?.fields).toMatchObject({ taken: 0, alreadyHandled: 1 });
    // One task and one message in all, and no escalation once the two hours have passed.
    expect(effectsOf(summary, "hubspot.createTask")).toHaveLength(1);
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(tickAt(summary, 4).effects).toEqual([]);
    expect(summary.statuses).toEqual({ "lead-hot": "resolved" });
  });

  it("treats a Slack lookup that fails as a failure, never as a lead with no owner", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-failed-slack-lookup-is-a-failure-and-not-no-owner",
    );

    // Nothing was created or sent for a lead whose owner could not be found.
    expect(effectsOf(summary)).toEqual([]);
    // Looking the same person up again would find nobody, so the lead goes to a person now and is not tried again.
    expect(callsTo(summary, "slack.findUserByEmail")).toBe(1);
    expect(tickAt(summary, 0).nodes.owner).toMatchObject({
      status: "failed",
      error: "provider_error",
    });
    expect(summary.journeys["lead-hot"]).toEqual([
      "error@owner:provider_error",
      "ended@owner:needsManual",
    ]);
    expect(summary.statuses).toEqual({ "lead-hot": "needs_manual" });
  });

  it("retries a failed lead after 5 and then 10 minutes and hands it to a person after the third failure, when the source works from a cursor", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-failed-lead-behind-a-cursor-is-retried-and-then-handed-to-a-person",
    );

    // The cursor moved past the lead on the first run and HubSpot never offers it again; the lead is set aside instead.
    expect(summary.cursors).toEqual({ leads: "1001" });
    expect(tickAt(summary, 0).run?.counts.retryParked).toBe(1);
    expect(tickAt(summary, 1).run?.counts).toMatchObject({
      retried: 1,
      retryParked: 1,
    });
    expect(tickAt(summary, 2).run?.counts).toMatchObject({
      retried: 1,
      needsManual: 1,
    });
    expect(summary.journeys["lead-hot"]).toEqual([
      "error@owner:provider_error",
      "parked@owner",
      "woke@owner:?",
      "error@owner:provider_error",
      "parked@owner",
      "woke@owner:?",
      "error@owner:provider_error",
      "ended@owner:needsManual",
    ]);
    expect(summary.statuses).toEqual({ "lead-hot": "needs_manual" });
    expect(effectsOf(summary)).toEqual([]);
  });

  it("contacts nobody outside the company: every message and email goes to the owner, the manager or the sales channel", async () => {
    const internal = new Set(["U0OWNER", "manager@example.test", "C0SALES"]);
    for (const name of Object.keys(STORIES[STORY].script.scenarios)) {
      const { summary } = await scenarioRun(STORY, name);
      for (const effect of effectsOf(summary, "slack.postMessage")) {
        expect(
          internal.has(String(effect.fields.to)),
          `${name}: ${effect.fields.to}`,
        ).toBe(true);
      }
      for (const effect of effectsOf(summary, "email.send")) {
        expect(effect.fields.to, name).toBe("manager@example.test");
      }
    }
  });
});
