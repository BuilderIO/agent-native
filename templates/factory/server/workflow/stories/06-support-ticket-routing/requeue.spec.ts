import { describe, expect, it } from "vitest";

import { putBackRowsFor } from "../../testing/engine-fixtures.js";
import { compileScenario } from "../../testing/story-data.js";
import { runStoryScript } from "../../testing/story-harness.js";
import { STORIES } from "../registry.js";

const STORY = "support-ticket-routing";
const { graph, fixtures } = STORIES[STORY];
const TICKET = "t-other";

const scenario = (steps: unknown[]) =>
  compileScenario(
    graph,
    { description: "a piece of the requeue story", steps } as never,
    fixtures,
  );

/** Pylon offers the ticket once and then has moved its cursor on; the model cannot read it three times. */
const unreadableThreeTimes = scenario([
  {
    kind: "serve",
    operation: "pylon.newTickets",
    recording: "oneOther",
    calls: 1,
  },
  { kind: "serve", operation: "pylon.newTickets", recording: "none" },
  { kind: "serve", operation: "pylon.ticketThread", recording: "threads" },
  { kind: "serve", operation: "pylon.addNote", recording: "added" },
  { kind: "ai", node: "classify", recording: "oneOtherUnreadable" },
  { kind: "tick", label: "first attempt" },
  { kind: "tick", at: "+10m", label: "second attempt" },
  { kind: "tick", at: "+20m", label: "third attempt" },
]);

/** What the model says once the problem is fixed. */
const readableNow = scenario([
  { kind: "ai", node: "classify", recording: "all" },
  { kind: "ai", node: "suggest", recording: "reply" },
]);

describe("story 6: a ticket a person sent back to the workflow", () => {
  it("is handled once, though Pylon has moved its cursor past it and will not offer it again", async () => {
    let before: string | undefined;
    const run = await runStoryScript(STORY, {
      start: unreadableThreeTimes.start,
      steps: [
        ...unreadableThreeTimes.steps,
        {
          kind: "call",
          run: async (world) => {
            const { test } = world;
            before = test.statuses.rowStatus.get(TICKET);
            // What requeueing does: back to the queue status, attempts cleared.
            test.statuses.rowStatus.set(TICKET, "received");
            await world.store().clearCounters(test.scope, {
              workflowId: (await world.store().listWorkflows(test.scope))
                .items[0].id,
              itemId: TICKET,
              counters: ["attempts"],
            });
            putBackRowsFor(
              test,
              (await world.store().listWorkflows(test.scope)).items[0].id,
            );
          },
        },
        ...readableNow.steps,
        {
          kind: "tick",
          at: "2026-10-19T12:30:00.000Z",
          label: "after the requeue",
        },
        {
          kind: "tick",
          at: "2026-10-19T12:40:00.000Z",
          label: "the run after",
        },
      ],
    });

    // Three unreadable answers handed it to a person.
    expect(before).toBe("needs_manual");
    const [requeued, after] = run.ticks.slice(3);
    expect(
      requeued.steps.find((step) => step.nodeId === "tickets")?.fields,
    ).toMatchObject({ taken: 1, requeued: 1 });
    expect(run.statuses[TICKET]).toBe("resolved");
    // It was sent its internal note once, and its thread was read for the requeue and no more.
    expect(
      requeued.calls.filter((call) => call.operation.id === "pylon.addNote"),
    ).toHaveLength(1);
    expect(
      after.steps.find((step) => step.nodeId === "tickets")?.fields,
    ).not.toHaveProperty("requeued");
    expect(
      after.calls.filter((call) => call.operation.id === "pylon.ticketThread"),
    ).toEqual([]);
  });
});
