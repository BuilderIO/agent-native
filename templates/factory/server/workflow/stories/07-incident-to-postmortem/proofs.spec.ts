import { describe, expect, it } from "vitest";

import { OPERATION_CATALOG } from "../../catalog/index.js";
import { callsTo, effectsOf, scenarioRun, tickAt } from "../proof-kit.js";
import { STORIES } from "../registry.js";

const STORY = "incident-to-postmortem";
const nodesOf = (effects: { node: string }[]) =>
  effects.map((effect) => effect.node);

describe("story 7 proofs: an incident to a postmortem", () => {
  it("pages on-call by Slack and email once, and goes quiet when they answer", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "an-answered-incident-resolves-into-a-postmortem-draft",
    );

    expect(effectsOf(summary, "slack.postMessage")[0]).toMatchObject({
      node: "pageSlack",
      fields: { to: "oncall@example.test" },
    });
    expect(effectsOf(summary, "email.send")).toMatchObject([
      { node: "pageEmail", fields: { to: "oncall@example.test" } },
    ]);
    // Answered in time: the escalation contact is never told.
    expect(nodesOf(effectsOf(summary))).toEqual([
      "pageSlack",
      "pageEmail",
      "notion",
      "announce",
    ]);
    expect(tickAt(summary, 2).nodes.ack.ports).toEqual({ replied: 1 });
  });

  it("re-checks the condition on each cadence and not between", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "an-answered-incident-resolves-into-a-postmortem-draft",
    );

    // +5m: nothing is due. +15m: the answer is seen and the issue starts to be watched.
    expect(
      callsTo(
        { ...summary, ticks: summary.ticks.slice(0, 3) },
        "sentry.issueStatus",
      ),
    ).toBe(0);
    // +30m and +45m: still open, read once each. +1h: resolved, so the item moves on.
    expect(tickAt(summary, 3).calls["sentry.issueStatus"]).toBe(1);
    expect(tickAt(summary, 4).calls["sentry.issueStatus"]).toBe(1);
    expect(tickAt(summary, 5).nodes.resolved.ports).toEqual({ met: 1 });
    expect(callsTo(summary, "sentry.issueStatus")).toBe(3);
  });

  it("escalates after fifteen silent minutes, once, and still writes the postmortem when the issue resolves unanswered", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "nobody-answers-so-the-escalation-contact-is-told-and-the-issue-still-resolves",
    );

    expect(tickAt(summary, 1).nodes.ack.ports).toEqual({ timedOut: 1 });
    expect(
      effectsOf(summary, "slack.postMessage").map((e) => e.fields.to),
    ).toEqual([
      "oncall@example.test",
      "escalation@example.test",
      "oncall@example.test",
    ]);
    expect(effectsOf(summary, "email.send").map((e) => e.fields.to)).toEqual([
      "oncall@example.test",
      "escalation@example.test",
    ]);
    expect(effectsOf(summary, "notion.createPage")).toHaveLength(1);
    expect(summary.statuses).toEqual({ "issue-4821": "resolved" });
  });

  it("gives up after 48 hours, tells the incident owner once, and writes nothing to Notion", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "still-open-after-48-hours-tells-the-incident-owner",
    );

    // A minute short of the limit it is still waiting; at the limit it times out.
    expect(tickAt(summary, 4).nodes).toEqual({});
    expect(tickAt(summary, 5).nodes.resolved.ports).toEqual({ timedOut: 1 });
    expect(
      effectsOf(summary, "slack.postMessage").map((e) => e.fields.to),
    ).toEqual(["oncall@example.test", "incident-owner@example.test"]);
    expect(callsTo(summary, "notion.createPage")).toBe(0);
    expect(summary.statuses).toEqual({ "issue-4821": "needs_manual" });
  });

  it("reads a failed status check as neither a resolution nor a timeout, even at the deadline", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-failed-status-read-is-neither-resolved-nor-a-timeout",
    );

    expect(tickAt(summary, 2).nodes.resolved).toMatchObject({
      status: "failed",
      error: "provider_error",
    });
    // At the deadline the read fails: the owner is not told, the incident is not abandoned.
    expect(tickAt(summary, 4).nodes.resolved).toMatchObject({
      status: "failed",
    });
    expect(tickAt(summary, 4).effects).toEqual([]);
    expect(tickAt(summary, 5).nodes.resolved.ports).toEqual({ timedOut: 1 });
    expect(summary.statuses).toEqual({ "issue-4821": "needs_manual" });
  });

  it("shows the model the recorded events with their links, and the page and the Slack post carry what it wrote", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "an-answered-incident-resolves-into-a-postmortem-draft",
    );

    const asked = run.ticks
      .flatMap((tick) => tick.aiRequests)
      .find((request) => request.instruction.includes("Write a postmortem"));
    expect(asked).toBeDefined();
    const shown = (
      asked?.items[0].nodes.gather as {
        events: { eventID: string; url: string }[];
      }
    ).events;
    expect(shown.map((event) => event.eventID)).toEqual(["e1", "e2", "e3"]);
    for (const event of shown) expect(event.url).toMatch(/^https:\/\//);
    // The instruction makes citing an event the rule; the model's answer is prose-shaped, so only a
    // spec can check it against what it was shown (below). No node validates it in code.
    expect(asked?.instruction).toContain("nodes.gather");
    expect(asked?.instruction).toContain("{at, what, eventId, link}");
    expect(asked?.instruction).toContain("never cite the issue's id or link");
    expect(asked?.instruction).toContain("leave timeline empty");

    const answer = STORIES[STORY].fixtures.ai.postmortem.grounded;
    const written =
      "perItem" in answer
        ? (answer.perItem["*"] as Record<string, unknown>)
        : {};
    const timeline = written.timeline as { eventId: string; link: string }[];
    const urlOf = new Map(shown.map((event) => [event.eventID, event.url]));
    expect(timeline.length).toBeGreaterThan(0);
    for (const entry of timeline) {
      expect(urlOf.get(entry.eventId), entry.eventId).toBe(entry.link);
    }

    const [page] = effectsOf(summary, "notion.createPage");
    expect(page.fields.title).toMatch(/^\[Draft\] /);
    expect(page.fields.parentPageId).toBe("page-1");
    for (const entry of timeline) {
      expect(String(page.fields.body)).toContain(entry.link);
    }
    const announce = effectsOf(summary, "slack.postMessage").find(
      (effect) => effect.node === "announce",
    );
    expect(announce?.fields.text).toBe(
      `Postmortem draft: ${page.receipt?.url}`,
    );
  });

  it("writes an empty timeline, and a page with no event link, when Sentry recorded no events", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "an-issue-with-no-recorded-events-gets-a-postmortem-with-an-empty-timeline",
    );

    const asked = run.ticks
      .flatMap((tick) => tick.aiRequests)
      .find((request) => request.instruction.includes("Write a postmortem"));
    expect(
      (asked?.items[0].nodes.gather as { events: unknown[] }).events,
    ).toEqual([]);
    const answer = STORIES[STORY].fixtures.ai.postmortem.noEvents;
    const written =
      "perItem" in answer
        ? (answer.perItem["*"] as Record<string, unknown>)
        : {};
    expect(written.timeline).toEqual([]);
    // The issue is not an event: nothing in the page cites it as one.
    const [page] = effectsOf(summary, "notion.createPage");
    expect(page.fields.title).toMatch(/^\[Draft\] /);
    expect(String(page.fields.body)).not.toContain("/events/");
    expect(String(page.fields.body)).not.toContain("## Timeline");
    expect(page.receipt?.status).toBe("done");
    expect(effectsOf(summary, "slack.postMessage").map((e) => e.node)).toEqual([
      "pageSlack",
      "escalate",
      "announce",
    ]);
    expect(summary.statuses).toEqual({ "issue-4821": "resolved" });
  });

  it.todo(
    "reads the events the way the live Sentry list endpoint returns them: the recorded events here are `{ events: [{ eventID, dateCreated, url, tags: { release } }] }`, but the repo's own Sentry client (`server/triage/sentry-client.ts`) treats that response as a bare array whose events carry `tags` as key/value pairs and no `url`; not run against live Sentry. If so, `nodes.gather` is the array itself, and the event links the page must carry have to be built from the issue link and the event id",
  );

  it.todo(
    "refuses a postmortem entry that cites an event the model was not shown: an AI result needs a validator that checks cited ids against the item's recorded events",
  );

  it("never touches Sentry beyond reading", async () => {
    for (const name of Object.keys(STORIES[STORY].script.scenarios)) {
      const { summary } = await scenarioRun(STORY, name);
      for (const tick of summary.ticks) {
        for (const operation of Object.keys(tick.calls)) {
          if (!operation.startsWith("sentry.")) continue;
          expect(
            OPERATION_CATALOG.get(operation)?.effect,
            `${name}: ${operation}`,
          ).toBe("read");
        }
      }
    }
  });

  it("leaves the incident for a person when Notion is down, and announces nothing", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "notion-down-leaves-the-incident-for-a-person",
    );

    expect(
      effectsOf(summary, "notion.createPage").map((e) => e.receipt?.status),
      // Three tries in each of the three ticks, each on a receipt of its own.
    ).toEqual(Array(9).fill("failed"));
    expect(effectsOf(summary, "slack.postMessage").map((e) => e.node)).toEqual([
      "pageSlack",
    ]);
    expect(summary.statuses).toEqual({ "issue-4821": "needs_manual" });
    expect(summary.parked).toEqual([]);
  });

  it("pages nobody when the model cannot summarize, and hands the incident to a person after three tries", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "the-model-cannot-summarize-so-nobody-is-paged-and-a-person-is-handed-the-incident",
    );

    expect(effectsOf(summary)).toEqual([]);
    expect(summary.statuses).toEqual({ "issue-4821": "needs_manual" });
  });

  it("pages once however often the source offers the same issue", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "the-same-issue-offered-again-is-paged-once",
    );

    expect(
      effectsOf(summary, "slack.postMessage").filter(
        (e) => e.node === "pageSlack",
      ),
    ).toHaveLength(1);
    expect(effectsOf(summary, "email.send")).toHaveLength(1);
    // The engine's own guard: an item that waits is not taken again, whatever the source offers.
    for (const tick of [1, 2, 4]) {
      const spikes = run.ticks[tick].steps.find(
        (step) => step.nodeId === "spikes",
      );
      expect(spikes?.fields, `tick ${tick}`).toMatchObject({
        taken: 0,
        heldByAnotherRun: 1,
      });
    }
    expect(
      summary.journeys["issue-4821"].filter(
        (step) => step === "effect@pageSlack",
      ),
    ).toHaveLength(1);
  });
});
