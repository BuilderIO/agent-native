import { describe, expect, it } from "vitest";

import { workflowNodeSchema, type WorkflowNode } from "@/lib/workflow-editor";

import {
  IDLE,
  liveOutputOf,
  liveTestFor,
  liveTestReducer,
  canTestRequestOnItsOwn,
  type LiveTest,
} from "./api-request-test";
import {
  liveAnswerOf,
  liveAnswerOfRefusal,
  type LiveAnswer,
} from "./node-details/api-request-output";
import { WORKFLOW_CATALOG } from "./workflow-catalog";

const fixed = (value: unknown) => ({ mode: "fixed", value });
const fromPath = (path: string) => ({ mode: "path", path });

function lookup(
  operation: string,
  args: Record<string, unknown>,
): WorkflowNode {
  return workflowNodeSchema.parse({
    id: "n1",
    name: "n1",
    kind: "lookup",
    position: { x: 0, y: 0 },
    settings: { operation, args },
  });
}

const answer = (value: unknown): LiveAnswer => ({
  kind: "answer",
  value,
  status: 200,
  elapsedMs: 120,
});

describe("which steps are tested in the window", () => {
  it("is an API request that reads nothing about an item", () => {
    expect(
      canTestRequestOnItsOwn(
        lookup("github.apiRequest", { path: fixed("repos/acme/web/issues") }),
        WORKFLOW_CATALOG,
      ),
    ).toBe(true);
    expect(
      canTestRequestOnItsOwn(
        lookup("github.apiRequest", {
          path: fromPath("settings.extras.path"),
          query: fixed({ since: "{{ run.windowStart }}" }),
        }),
        WORKFLOW_CATALOG,
      ),
    ).toBe(true);
  });

  it("is not one that reads the item or an earlier step, which needs items as every other step does", () => {
    for (const args of [
      { path: fromPath("item.extras.path") },
      { path: fixed("repos/{{ item.thread.repo }}/issues") },
      { path: fromPath("nodes.earlier.path") },
    ]) {
      expect(
        canTestRequestOnItsOwn(
          lookup("github.apiRequest", args),
          WORKFLOW_CATALOG,
        ),
      ).toBe(false);
    }
  });

  it("is not a curated lookup or another kind of step, which a run tests and records", () => {
    expect(
      canTestRequestOnItsOwn(
        lookup("slack.findUserByEmail", { email: fixed("pat@example.com") }),
        WORKFLOW_CATALOG,
      ),
    ).toBe(false);
    const end = workflowNodeSchema.parse({
      id: "e1",
      name: "e1",
      kind: "end",
      position: { x: 0, y: 0 },
      settings: { outcome: "done" },
    });
    expect(canTestRequestOnItsOwn(end, WORKFLOW_CATALOG)).toBe(false);
  });
});

describe("the test in the window", () => {
  const running = (nodeId = "a", token = 1): LiveTest => ({
    phase: "running",
    nodeId,
    token,
  });

  it("answers at once with the skeleton, then the answer", () => {
    const started = liveTestReducer(IDLE, {
      type: "start",
      nodeId: "a",
      token: 1,
    });
    expect(started).toEqual(running());
    expect(
      liveOutputOf(started as Exclude<LiveTest, { phase: "idle" }>),
    ).toEqual({ kind: "skeleton" });

    const done = liveTestReducer(started, {
      type: "finish",
      nodeId: "a",
      token: 1,
      answer: answer({ ok: true }),
    });
    expect(done).toMatchObject({ phase: "done", nodeId: "a" });
    expect(liveOutputOf(done as Exclude<LiveTest, { phase: "idle" }>)).toEqual({
      kind: "answer",
      answer: answer({ ok: true }),
    });
  });

  it("shows a failure as a failure, with the heading kind and status the pane maps", () => {
    const failed = liveAnswerOf({
      ok: false,
      code: "provider_not_found",
      message: "github could not find what github.apiRequest asked for.",
      status: 404,
      elapsedMs: 80,
    });
    const done = liveTestReducer(running(), {
      type: "finish",
      nodeId: "a",
      token: 1,
      answer: failed,
    });
    const shown = liveOutputOf(done as Exclude<LiveTest, { phase: "idle" }>);
    expect(shown).toMatchObject({
      kind: "failure",
      answer: {
        failure: { kind: "not_found", code: "provider_not_found", status: 404 },
        elapsedMs: 80,
      },
    });
  });

  it("replaces a shown answer with the skeleton the moment a new test starts", () => {
    const done: LiveTest = {
      phase: "done",
      nodeId: "a",
      token: 1,
      answer: answer([1]),
    };
    expect(
      liveTestReducer(done, { type: "start", nodeId: "a", token: 2 }),
    ).toEqual(running("a", 2));
  });

  it("belongs to one step: another step sees nothing", () => {
    const done: LiveTest = {
      phase: "done",
      nodeId: "a",
      token: 1,
      answer: answer([1]),
    };
    expect(liveTestFor(done, "a")).toBe(done);
    expect(liveTestFor(done, "b")).toBe(IDLE);
    expect(liveTestFor(done, undefined)).toBe(IDLE);
    expect(liveTestFor(running(), "b")).toBe(IDLE);
  });

  it("clears when the step changes or the window closes, whatever it held", () => {
    const done: LiveTest = {
      phase: "done",
      nodeId: "a",
      token: 1,
      answer: answer({ secret: "kept nowhere" }),
    };
    expect(liveTestReducer(done, { type: "clear" })).toBe(IDLE);
    expect(liveTestReducer(running(), { type: "clear" })).toBe(IDLE);
    expect(liveTestReducer(IDLE, { type: "clear" })).toBe(IDLE);
  });

  it("drops an answer that comes back after the window moved on", () => {
    const cleared = liveTestReducer(running(), { type: "clear" });
    expect(
      liveTestReducer(cleared, {
        type: "finish",
        nodeId: "a",
        token: 1,
        answer: answer({ late: true }),
      }),
    ).toBe(IDLE);

    // Another step's test is running now: the first one's answer is not shown on it.
    const other = running("b", 2);
    expect(
      liveTestReducer(other, {
        type: "finish",
        nodeId: "a",
        token: 1,
        answer: answer({ late: true }),
      }),
    ).toBe(other);
  });

  it("drops the answer of an earlier test of the same step when a newer one is running", () => {
    const newer = running("a", 2);
    expect(
      liveTestReducer(newer, {
        type: "finish",
        nodeId: "a",
        token: 1,
        answer: answer({ stale: true }),
      }),
    ).toBe(newer);
  });

  it("goes back to nothing when the save before the test was refused, because nothing was sent", () => {
    expect(
      liveTestReducer(running(), { type: "abandon", nodeId: "a", token: 1 }),
    ).toBe(IDLE);
    const newer = running("a", 2);
    expect(
      liveTestReducer(newer, { type: "abandon", nodeId: "a", token: 1 }),
    ).toBe(newer);
  });
});

describe("what a test that was refused shows", () => {
  it("words a member without access, with the server's message", () => {
    const refused = liveAnswerOfRefusal(
      "run_not_queued",
      "The test was not run: Collaborate access is required to run this automation.",
    );
    expect(refused).toMatchObject({
      kind: "failed",
      elapsedMs: null,
      failure: {
        kind: "test_not_allowed",
        code: "run_not_queued",
        message: expect.stringContaining("Collaborate access"),
      },
    });
  });

  it("words a path with no value, and falls back to a plain failure for a code it does not know", () => {
    expect(
      liveAnswerOf({
        ok: false,
        code: "expression_failed",
        message: 'args.path: "settings.extras.path" has no value here.',
        elapsedMs: 0,
      }),
    ).toMatchObject({
      kind: "failed",
      failure: { kind: "expression_failed" },
    });
    expect(liveAnswerOfRefusal(null, "Unknown error")).toMatchObject({
      failure: { kind: "failed", code: "failed" },
    });
    expect(
      liveAnswerOfRefusal("workflow_job_missing", "The job file is gone."),
    ).toMatchObject({ failure: { kind: "failed" } });
  });

  it("words every refusal the request can get before it is sent, and the provider's answers", () => {
    const kinds: [string, string][] = [
      ["full_url_refused", "full_url_refused"],
      ["unsafe_path_value", "unsafe_path_value"],
      ["header_denied", "header_denied"],
      ["invalid_query", "invalid_query"],
      ["invalid_timeout", "invalid_timeout"],
      ["invalid_pagination", "invalid_pagination"],
      ["incompatible_fields", "incompatible_fields"],
      ["operation_fields_invalid", "invalid_field"],
      ["credential_missing", "not_connected"],
      ["provider_not_configured", "not_connected"],
      ["provider_access_denied", "access_denied"],
      ["provider_not_found", "not_found"],
      ["provider_rate_limited", "rate_limited"],
      ["provider_unavailable", "provider_problem"],
      ["provider_rejected", "rejected"],
      ["provider_request_failed", "request_failed"],
      ["provider_request_refused", "request_refused"],
      ["unexpected_response", "unreadable"],
      ["output_over_cap", "too_large"],
    ];
    for (const [code, kind] of kinds) {
      expect(
        liveAnswerOf({ ok: false, code, message: "m", elapsedMs: 1 }),
        code,
      ).toMatchObject({ kind: "failed", failure: { kind } });
    }
  });

  it("keeps the status the provider sent, which the message may not name", () => {
    expect(
      liveAnswerOf({
        ok: false,
        code: "provider_not_found",
        message: "github could not find what it asked for.",
        status: 404,
        elapsedMs: 5,
      }),
    ).toMatchObject({ failure: { status: 404 } });
  });
});
