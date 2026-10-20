import { describe, expect, it } from "vitest";

import { callsTo, effectsOf, scenarioRun, tickAt } from "../proof-kit.js";
import { STORIES } from "../registry.js";

const STORY = "after-every-customer-call";
const graph = STORIES[STORY].graph;
const node = (id: string) => {
  const found = graph.nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`The story has no node "${id}".`);
  return found;
};

describe("story 5 proofs: after every customer call", () => {
  it("posts once and creates one task per action item, each under a closed receipt", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "an-external-call-gets-one-post-and-one-task-per-action-item",
    );

    const posts = effectsOf(summary, "slack.postMessage");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      item: "call-1",
      fields: { to: "C0CALLS" },
      receipt: { status: "done" },
    });
    const tasks = effectsOf(summary, "hubspot.createTask");
    expect(tasks.map((task) => [task.item, task.fields.title])).toEqual([
      ["call-1#0", "Send the pricing sheet"],
      ["call-1#1", "Share the security questionnaire answers"],
    ]);
    expect(tasks.every((task) => task.receipt?.status === "done")).toBe(true);
    // The model's guess at who owns a task is notes, never an owner id (create-hubspot-task takes an id).
    expect(tasks.every((task) => !("ownerId" in task.fields))).toBe(true);
    expect(tasks[0].fields.body).toContain("account-owner@example.test");
  });

  it("dismisses an internal-only call with its reason and never reads its transcript", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "an-external-call-gets-one-post-and-one-task-per-action-item",
    );

    expect(summary.journeys["call-2"]).toEqual([
      "decision@external:otherwise",
      "ended@internalOnly:dismissed",
    ]);
    const ended = run.events["call-2"].find((event) => event.kind === "ended");
    expect(ended?.summary).toContain("Internal-only call");
    const transcriptReads = run.ticks[0].calls.filter(
      (call) => call.operation.id === "gong.transcript",
    );
    expect(transcriptReads.map((call) => call.fields.callId)).toEqual([
      "call-1",
    ]);
  });

  it("creates no task and still posts for a call with no action items", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-call-with-no-action-items-posts-and-creates-no-task",
    );

    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    expect(callsTo(summary, "hubspot.createTask")).toBe(0);
  });

  it("fails an incomplete action item alone and sends nothing half-filled to HubSpot", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "an-action-item-the-model-left-incomplete-fails-only-itself",
    );

    expect(tickAt(summary, 0).nodes.task).toMatchObject({
      status: "failed",
      error: "expression_failed",
    });
    expect(callsTo(summary, "hubspot.createTask")).toBe(0);
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
  });

  it("never treats a failed or empty transcript read as an empty call", async () => {
    const down = await scenarioRun(
      STORY,
      "a-transcript-that-cannot-be-read-fails-the-call-and-sends-nothing",
    );
    // Retried within the run (one call plus two retries), then set aside; it comes back at the next window for three more.
    expect(callsTo(down.summary, "gong.transcript")).toBe(6);
    expect(tickAt(down.summary, 0).nodes.transcript).toMatchObject({
      status: "failed",
      error: "provider_error",
    });
    expect(down.summary.ticks.flatMap((tick) => tick.ai)).toEqual([]);
    expect(effectsOf(down.summary)).toEqual([]);

    const empty = await scenarioRun(
      STORY,
      "an-empty-transcript-response-is-a-failure-not-an-empty-call",
    );
    expect(tickAt(empty.summary, 0).nodes.transcript.error).toBe(
      "lookup_failed",
    );
    expect(empty.summary.ticks.flatMap((tick) => tick.ai)).toEqual([]);
    expect(effectsOf(empty.summary)).toEqual([]);
  });

  it("does not repeat the post or the task that went out when a run dies partway", async () => {
    const { summary } = await scenarioRun(
      STORY,
      "a-run-that-dies-while-creating-tasks-creates-no-task-twice",
    );

    expect(tickAt(summary, 1).outcome).toBe("crashed");
    expect(effectsOf(summary, "slack.postMessage")).toHaveLength(1);
    const tasks = effectsOf(summary, "hubspot.createTask");
    // The first task went out and the process died before its receipt closed; the second run does not create it again.
    expect(tasks.map((task) => [task.item, task.receipt?.status])).toEqual([
      ["call-1#0", "started"],
      ["call-1#1", "done"],
    ]);
    expect(tickAt(summary, 2).calls["slack.postMessage"]).toBeUndefined();
    expect(tickAt(summary, 2).nodes.task).toMatchObject({
      status: "needs_check",
      error: "effect_needs_check",
    });
    expect(summary.journeys["call-1#0"]).toContain("ended@task:needsManual");
    // The window of the second run reaches back over the one that died.
    expect(tickAt(summary, 2).windows["gong.newCalls"].from).toBe(
      "2026-10-19T11:30:00.000Z",
    );
  });

  it("gives the model that extracts the call its input budget", async () => {
    const { run } = await scenarioRun(
      STORY,
      "an-external-call-gets-one-post-and-one-task-per-action-item",
    );

    const extract = run.ticks[0].aiRequests.find(
      (request) =>
        request.items[0].id === "call-1" && request.mode === "perItem",
    );
    expect(extract?.inputBudgetTokens).toBe(20_000);
  });

  it("sends and creates nothing from a dry run", async () => {
    const { summary, run } = await scenarioRun(
      STORY,
      "a-dry-run-creates-nothing",
    );

    expect(effectsOf(summary)).toEqual([]);
    expect(callsTo(summary, "slack.postMessage")).toBe(0);
    expect(callsTo(summary, "hubspot.createTask")).toBe(0);
    const task = run.ticks[0].steps.find((step) => step.nodeId === "task");
    expect(task?.fields).toMatchObject({ wouldCallCount: 2 });
  });

  describe("no transcript text in the Slack post", () => {
    // Enforced by the instructions only: no code reads the text a model writes.
    it("tells the model that extracts the call to use its own words in every field", () => {
      const extract = node("extract");
      const instruction =
        extract.kind === "ai" ? extract.settings.instruction : "";
      expect(instruction).toContain("into any field");
      expect(instruction).toContain(
        "no more than five consecutive transcript words and no quotation marks",
      );
    });

    it("tells the model that writes the post to use the extracted fields and never the transcript", () => {
      const post = node("post");
      const text = post.kind === "action" ? post.settings.args.text : undefined;
      expect(text).toMatchObject({ mode: "ai" });
      const instruction = text?.mode === "ai" ? text.instruction : "";
      expect(instruction).toContain("nodes.extract");
      expect(instruction).toContain("never quote or paste");
      expect(instruction).toContain("nodes.transcript");
    });

    it("shows what the post's model is handed today: the extracted fields, and the transcript with them", async () => {
      const { run } = await scenarioRun(
        STORY,
        "an-external-call-gets-one-post-and-one-task-per-action-item",
      );

      const asked = run.ticks[0].aiRequests.find(
        (request) => request.resultSchemaFields.text !== undefined,
      );
      expect(Object.keys(asked?.items[0].nodes ?? {}).sort()).toEqual([
        "extract",
        "transcript",
      ]);
    });

    it("keeps the gap visible: a post that pastes transcript lines is sent as written", async () => {
      const { summary } = await scenarioRun(
        STORY,
        "a-post-that-quotes-the-transcript-is-sent-because-no-code-reads-the-text",
      );

      expect(effectsOf(summary, "slack.postMessage")[0].fields.text).toContain(
        "TRANSCRIPT-LINE",
      );
    });

    it.todo(
      "the post never sees or sends raw transcript text: the post node's model is handed `nodes.transcript` (the Lookup's result stays on the item) and the engine sends whatever text it returns. Fix: a way to drop a lookup result (or hand a node only the fields it names), so only `nodes.extract` reaches `post`",
    );
  });

  it.todo(
    "a call whose transcript is not ready is set aside, brought back after 5 and then 10 minutes, and handed to a person after the third failure (the plan said 6 hours): a scenario of three ticks at those times is still to be scripted",
  );
  it.todo(
    "a very long call records on its step that the transcript was cut at the input budget (`inputTruncated`): the recorded model answers cannot yet say so (the story data layer has no `inputTruncated` flag), so the story only proves the budget reaches the runner",
  );
});
