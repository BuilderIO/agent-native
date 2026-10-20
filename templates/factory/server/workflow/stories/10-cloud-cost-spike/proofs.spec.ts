import { describe, expect, it } from "vitest";

import {
  callsTo,
  effectsOf,
  endedWith,
  scenarioRun,
  tickAt,
} from "../proof-kit.js";
import { STORIES } from "../registry.js";

const STORY = "cloud-cost-spike";
const SPIKE_DAY =
  "a-spike-day-alerts-the-owners-with-suspects-and-a-reply-ends-it";
const SEVEN_AM_LA = "2026-10-19T14:00:00.000Z";
const FOUR_HOURS_LATER = "2026-10-19T18:00:00.000Z";
const PULL_LINKS = [
  "https://github.example.test/example-org/example-repo/pull/412",
  "https://github.example.test/example-org/example-repo/pull/415",
];

type Run = Awaited<ReturnType<typeof scenarioRun>>["run"];

/** The item a service was summarized into, found by the event that says so. */
function summaryOf(run: Run, service: string): string {
  for (const [itemId, events] of Object.entries(run.events)) {
    if (
      events.some((event) => event.summary.startsWith(`summarized ${service}:`))
    ) {
      return itemId;
    }
  }
  throw new Error(`No summary item for "${service}".`);
}

/** The list the spiking services were merged into: the one item a scenario's `spikes` Combine made. */
function spikesOf(run: Run): string {
  const found = Object.keys(run.events).filter((itemId) =>
    itemId.startsWith("list:spikes:"),
  );
  if (found.length !== 1) {
    throw new Error(`Expected one spikes list, found ${found.length}.`);
  }
  return found[0];
}

const decisionsOf = (run: Run, itemId: string) =>
  run.events[itemId]
    .filter((event) => event.kind === "decision")
    .map((event) => event.port);

describe("story 10 proofs: the cloud-cost spike", () => {
  it("names each spiking service with its numbers, and every cause the model gives is a pull request it was shown, with its link", async () => {
    const { summary, run } = await scenarioRun(STORY, SPIKE_DAY);

    // What the model sees: only the spiking services, each with its cost and its average, and the merged list with links.
    const [asked] = run.ticks[0].aiRequests;
    const seen = asked.items[0];
    const listed = (
      seen.item.items as {
        key: string;
        latest: number;
        baselineAverage: number;
        increasePercent: number;
      }[]
    ).map(({ key, latest, baselineAverage, increasePercent }) => ({
      key,
      latest,
      baselineAverage,
      increasePercent,
    }));
    expect(listed).toEqual([
      {
        key: "Compute Engine",
        latest: 200,
        baselineAverage: 100,
        increasePercent: 100,
      },
      {
        key: "Cloud CDN",
        latest: 120,
        baselineAverage: 50,
        increasePercent: 140,
      },
    ]);
    const shownLinks = (
      seen.nodes.recent as { items: { html_url: string }[] }
    ).items.map((pull) => pull.html_url);
    expect(shownLinks).toEqual(PULL_LINKS);
    // The instruction forbids a cause with no link: enforced by the prompt, since no code can read prose.
    expect(asked.instruction).toContain("Name no cause you have no link for");

    // The lookup asked for the last day's merges in this repository.
    const lookup = run.ticks[0].calls.find(
      (call) => call.operation.id === "github.mergedPullRequests",
    );
    expect(lookup?.fields).toEqual({
      repo: "example-org/example-repo",
      since: "2026-10-18T14:00:00.000Z",
    });

    // What was sent carries those links and nothing else: one Slack message and one email, the same text.
    const [slack] = effectsOf(summary, "slack.postMessage");
    const [email] = effectsOf(summary, "email.send");
    expect(effectsOf(summary)).toHaveLength(2);
    expect(slack.fields.to).toBe("C0OWNERS");
    expect(email.fields.body).toBe(slack.fields.text);
    const sentLinks =
      String(slack.fields.text).match(/https:\/\/\S+?\/pull\/\d+/g) ?? [];
    expect(sentLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of sentLinks) expect(shownLinks).toContain(link);
    expect(String(slack.fields.text)).toContain("Compute Engine");
    expect(String(slack.fields.text)).toContain("Cloud CDN");
  });

  it("alerts once for two spiking services, not once per service", async () => {
    const { summary } = await scenarioRun(STORY, SPIKE_DAY);

    expect(tickAt(summary, 0).nodes.spikes).toMatchObject({
      in: 2,
      ports: { out: 1 },
    });
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(effectsOf(summary, "email.send")).toHaveLength(1);
  });

  it("does not alert on a swing under a floor, and skips a service with nothing to compare with, saying so", async () => {
    const { summary, run } = await scenarioRun(STORY, SPIKE_DAY);

    // Networking rose 100% but by $2; BigQuery rose $60 but by 20%; Cloud Storage barely moved.
    for (const service of ["Networking", "BigQuery", "Cloud Storage"]) {
      expect(decisionsOf(run, summaryOf(run, service)), service).toEqual([
        "otherwise",
        "otherwise",
      ]);
    }
    expect(tickAt(summary, 0).nodes.spike).toMatchObject({
      in: 5,
      ports: { match: 2, otherwise: 3 },
    });
    // Vertex AI has one day of billing: its item says the baseline is missing, is compared with nothing, and ends with that reason.
    const vertex = summaryOf(run, "Vertex AI");
    const ended = run.events[vertex].filter((event) => event.kind === "ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ nodeId: "baselineEnd", outcome: "done" });
    expect(ended[0].summary).toContain("no earlier bucket");
    expect(tickAt(summary, 0).nodes.noBaseline.ports).toEqual({
      match: 1,
      otherwise: 5,
    });
    expect(tickAt(summary, 0).nodes.byService.ports.out).toBe(6);
  });

  it("parks the spike for exactly four hours, looking again every 15 minutes", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "the-spike-waits-exactly-four-hours",
    );

    expect(summary.parked).toEqual([
      {
        item: spikesOf(run),
        node: "waitReply",
        wait: "reply",
        dueAt: FOUR_HOURS_LATER,
        nextCheckAt: "2026-10-19T14:30:00.000Z",
        thread: { channelId: "C0OWNERS", threadTs: "1760001000.000001" },
      },
    ]);
    expect(Date.parse(FOUR_HOURS_LATER) - Date.parse(SEVEN_AM_LA)).toBe(
      4 * 60 * 60 * 1000,
    );
  });

  it("ends the spike with no escalation when someone replies before the deadline", async () => {
    const { summary, run } = await scenarioRun(STORY, SPIKE_DAY);

    expect(tickAt(summary, 1).run?.counts).toEqual({ stillWaiting: 1 });
    expect(tickAt(summary, 2).nodes.waitReply).toMatchObject({
      ports: { replied: 1 },
    });
    expect(endedWith(summary, "done")).toContain(spikesOf(run));
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(summary.parked).toEqual([]);
  });

  it("escalates once, at the first tick at or after four hours, and a bot's message is not an answer", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "silence-for-four-hours-escalates-once-and-a-bot-does-not-count",
    );

    // The check before the deadline finds nobody, and sends nothing.
    expect(tickAt(summary, 1).effects).toEqual([]);
    expect(tickAt(summary, 1).run?.counts).toEqual({ stillWaiting: 1 });
    // At four hours: one message, to the escalation contact only.
    expect(tickAt(summary, 2).at).toBe(FOUR_HOURS_LATER);
    expect(tickAt(summary, 2).nodes.waitReply).toMatchObject({
      ports: { timedOut: 1 },
    });
    const escalations = tickAt(summary, 2).effects;
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      operation: "slack.postMessage",
      fields: { to: "escalation@example.test" },
    });
    expect(summary.journeys[spikesOf(run)]).toContain(
      "woke@waitReply:timedOut",
    );
    // Afterwards nothing is waiting and nothing is due.
    expect(tickAt(summary, 3).outcome).toBe("nothing_due");
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(2);
    expect(summary.parked).toEqual([]);
  });

  it("sends nothing on a quiet day, looks up nothing, asks the model nothing, and records why", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "a-quiet-day-sends-nothing-and-records-why",
    );

    expect(effectsOf(summary)).toEqual([]);
    expect(callsTo(summary, "slack.postMessage")).toBe(0);
    expect(callsTo(summary, "email.send")).toBe(0);
    expect(callsTo(summary, "github.mergedPullRequests")).toBe(0);
    expect(tickAt(summary, 0).ai).toEqual([]);
    expect(tickAt(summary, 0).run?.status).toBe("succeeded");
    // The empty list a Combine emits is held back by the filter, and ends with the reason.
    expect(tickAt(summary, 0).nodes.spikes).toMatchObject({
      in: 0,
      ports: { out: 1 },
    });
    expect(tickAt(summary, 0).nodes.anySpikes).toMatchObject({
      ports: { otherwise: 1 },
    });
    const ended = run.events[spikesOf(run)].filter(
      (event) => event.kind === "ended",
    );
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ nodeId: "quiet", outcome: "done" });
    expect(ended[0].summary).toContain("no spikes");
    // Nothing is waiting, so the 15-minute check does nothing.
    expect(summary.parked).toEqual([]);
    expect(tickAt(summary, 1).outcome).toBe("nothing_due");
  });

  it("alerts once when the scheduler delivers the 07:00 tick twice", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "the-same-tick-delivered-twice-alerts-once",
    );

    expect(tickAt(summary, 1)).toMatchObject({
      outcome: "nothing_due",
      calls: {},
      effects: [],
      ai: [],
    });
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(callsTo(summary, "bigquery.billingQuery")).toBe(1);
  });

  it("reads the 07:00 window and takes no action on cloud resources: it writes only a Slack message and an email", async () => {
    const { summary } = await scenarioRun(STORY, SPIKE_DAY);

    expect(tickAt(summary, 0).windows["bigquery.billingQuery"]).toEqual({
      from: "2026-10-18T14:00:00.000Z",
      to: SEVEN_AM_LA,
    });
    // The graph can write through two operations, both messages: the catalog offers it no cloud write to name.
    const writes = STORIES[STORY].graph.nodes.flatMap((node) =>
      node.kind === "action" ? [node.settings.operation] : [],
    );
    expect([...new Set(writes)].sort()).toEqual([
      "email.send",
      "slack.postMessage",
    ]);
  });

  it("fails loudly, not quietly, when the costs arrive as text: every row fails and nothing is sent", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "billing-costs-delivered-as-text-fail-instead-of-summing",
    );

    expect(tickAt(summary, 0).nodes.byService).toMatchObject({
      in: 16,
      ports: {},
      status: "failed",
      error: "expression_failed",
    });
    // The whole run fails, so it is never recorded as a quiet day.
    expect(tickAt(summary, 0).run).toMatchObject({
      status: "failed",
      error: "expression_failed",
    });
    expect(effectsOf(summary)).toEqual([]);
  });

  it("does not compare billing data that ends before yesterday, sends nothing, and records why", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "billing-data-that-ends-before-yesterday-is-not-compared-as-yesterday",
    );

    expect(effectsOf(summary)).toEqual([]);
    const ended = run.events[summaryOf(run, "Compute Engine")].filter(
      (event) => event.kind === "ended",
    );
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ nodeId: "baselineEnd", outcome: "done" });
    expect(ended[0].summary).toContain("2026-10-18");
  });
});
