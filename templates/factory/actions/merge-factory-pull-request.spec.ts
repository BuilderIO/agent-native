import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());
const resolveRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/db/index.js", () => ({ getDb: () => ({}) }));
vi.mock("../server/lib/workflow-action-support.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workflow-action-support.js")
  >()),
  requireWorkflowActionCaller: requireCallerMock,
}));
vi.mock("../server/lib/factory-repository-scope.js", () => ({
  resolveFactoryRepository: resolveRepositoryMock,
}));
vi.mock("../server/triage/github-client.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/triage/github-client.js")
  >()),
  createGitHubClient: createClientMock,
}));

import {
  fakeGitHub,
  observedAt,
  pullRequestSummary,
} from "../server/lib/factory-pull-request.fixture.js";
import {
  createRunObserver,
  withRunObserver,
  type RunObserver,
} from "../server/lib/workflow-run-observer.js";
import { createCapturingTripwireSink } from "../server/tripwire/testing.js";
import type { TripwireInput } from "../server/tripwire/types.js";
import action from "./merge-factory-pull-request.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };
const input = { repo: "acme/app", number: 7, mergeMethod: "squash" as const };

// Every run reports to a capturing sink, as the host's runs do, so a spec never
// reaches the default recorder, whose database is not there.
let events: TripwireInput[];
let observer: RunObserver;

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
  resolveRepositoryMock.mockResolvedValue("acme/app");
  const capture = createCapturingTripwireSink();
  events = capture.events;
  observer = createRunObserver(capture.sink);
});

const run = () => withRunObserver(observer, () => action.run(input, context));

describe("merge-factory-pull-request", () => {
  it("declares a destructive write that reaches outside", () => {
    expect(action.mcpAnnotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    expect(action.http).toBe(false);
  });

  it("merges an eligible pull request and returns the sha and url for the receipt", async () => {
    const github = fakeGitHub();
    createClientMock.mockReturnValue(github);

    await expect(run()).resolves.toMatchObject({
      ok: true,
      merged: true,
      sha: "merge-sha",
      url: "https://github.test/acme/app/pull/7",
      mergeMethod: "squash",
    });
    expect(github.mergePullRequest).toHaveBeenCalledWith(
      { owner: "acme", repo: "app" },
      7,
      undefined,
      "head-sha-1",
      "squash",
    );
  });

  it("re-runs the gate itself, so a graph that skipped the gate node still cannot merge an ineligible pull request", async () => {
    const github = fakeGitHub({
      getPullRequestChecks: vi.fn().mockResolvedValue({
        checks: [{ name: "tests", state: "failed", observedAt }],
        checksCoverage: "complete",
      }),
    });
    createClientMock.mockReturnValue(github);

    await expect(run()).rejects.toMatchObject({
      errorCode: "merge_gate_ineligible",
    });
    expect(github.getPullRequestChecks).toHaveBeenCalledTimes(1);
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("refuses a pull request a person opened, even when everything else is green", async () => {
    const github = fakeGitHub({
      getPullRequestSummary: vi
        .fn()
        .mockResolvedValue(pullRequestSummary({ userLogin: "octocat" })),
    });
    createClientMock.mockReturnValue(github);

    await expect(run()).rejects.toMatchObject({
      errorCode: "merge_gate_ineligible",
    });
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("refuses a green pull request nobody has approved, so a graph that skipped the approval check still cannot merge it", async () => {
    const github = fakeGitHub({
      listPullRequestReviews: vi
        .fn()
        .mockResolvedValue({ reviews: [], reviewsTruncated: false }),
    });
    createClientMock.mockReturnValue(github);

    await expect(run()).rejects.toMatchObject({
      errorCode: "merge_gate_ineligible",
      details: { reasonCodes: ["approval_required"] },
    });
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("refuses a repository that is not the factory's", async () => {
    const github = fakeGitHub();
    createClientMock.mockReturnValue(github);
    resolveRepositoryMock.mockResolvedValue("acme/other");

    await expect(run()).rejects.toMatchObject({
      errorCode: "merge_gate_ineligible",
    });
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it("does nothing for a caller the gate refuses", async () => {
    requireCallerMock.mockRejectedValue(new Error("not allowed"));

    await expect(run()).rejects.toThrow("not allowed");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("describes its audit entry by the pull request and the outcome", () => {
    const audit = action.audit as {
      target: (args: unknown) => unknown;
      summary: (
        args: unknown,
        result: unknown,
        meta: { status: string },
      ) => string;
    };

    expect(audit.target(input)).toMatchObject({ id: "acme/app#7" });
    expect(audit.summary(input, {}, { status: "success" })).toBe(
      "Merged acme/app#7",
    );
    expect(audit.summary(input, undefined, { status: "error" })).toContain(
      "Tried to merge",
    );
  });

  it("hands a clean merge's gate snapshot to the run's own tripwire, and nothing unexpected", async () => {
    createClientMock.mockReturnValue(fakeGitHub());

    await run();

    expect(events.map((event) => event.code)).toEqual(["merge_gate_snapshot"]);
    expect(events[0]).toMatchObject({
      area: "merge",
      severity: "info",
      operationId: "github.mergePullRequest",
    });
  });

  it("hands a refusal to the run's own tripwire as the clause that blocked it", async () => {
    createClientMock.mockReturnValue(fakeGitHub());
    resolveRepositoryMock.mockResolvedValue("acme/other");

    await expect(run()).rejects.toMatchObject({
      errorCode: "merge_gate_ineligible",
    });

    expect(events.map((event) => event.code)).toEqual(["merge_blocked"]);
  });
});
