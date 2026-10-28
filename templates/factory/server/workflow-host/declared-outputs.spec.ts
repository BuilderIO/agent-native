import { BuilderBranchError } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const resolveRepositoryMock = vi.hoisted(() => vi.fn());
const createGitHubMock = vi.hoisted(() => vi.fn());
const createSlackMock = vi.hoisted(() => vi.fn());
const slackWorkspaceMock = vi.hoisted(() => vi.fn());
const sendEmailMock = vi.hoisted(() => vi.fn());
const readinessMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  sendEmail: sendEmailMock,
  getEmailReadiness: readinessMock,
}));
vi.mock("../db/index.js", () => ({ getDb: () => ({}) }));
vi.mock("../lib/workflow-action-support.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../lib/workflow-action-support.js")
  >()),
  requireWorkflowActionCaller: requireCallerMock,
}));
vi.mock("../lib/factory-repository-scope.js", () => ({
  resolveFactoryRepository: resolveRepositoryMock,
}));
vi.mock("../triage/github-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../triage/github-client.js")>()),
  createGitHubClient: createGitHubMock,
}));
vi.mock("../triage/slack-client.js", () => ({
  createSlackWorkflowClient: createSlackMock,
}));
vi.mock("../connectors/slack-workflow.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../connectors/slack-workflow.js")>()),
  resolveFactorySlackWorkspace: slackWorkspaceMock,
}));

import mergeGate from "../../actions/get-factory-merge-gate.js";
import getPullRequest from "../../actions/get-factory-pull-request.js";
import mergePullRequest from "../../actions/merge-factory-pull-request.js";
import postSlackMessage from "../../actions/post-slack-message.js";
import sendEmail from "../../actions/send-factory-email.js";
import { fakeGitHub } from "../lib/factory-pull-request.fixture.js";
import {
  createRunObserver,
  withRunObserver,
} from "../lib/workflow-run-observer.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import { operationOutputs } from "../workflow/operations.js";
import {
  DEFAULT_BUILDER_STUCK_AFTER_MS,
  executeBuilderOperation,
  type BuilderOperationDeps,
} from "./builder-operations.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };
const pullRequest = { repo: "acme/app", number: 7 };

function builderDeps(): BuilderOperationDeps {
  return {
    startAgent: vi.fn(async (args: { branchName?: string }) => ({
      branchName: args.branchName ?? "generated",
      projectId: "proj-1",
      url: "https://builder.test/app/projects/proj-1/branch",
      status: "processing",
    })),
    // A start looks for an earlier task on the branch first; there is none.
    getStatus: vi.fn(async () => {
      throw new BuilderBranchError("branch_not_found", "status", "none");
    }),
    sendMessage: vi.fn(async () => ({ accepted: true as const })),
    now: () => new Date("2026-10-18T12:00:00.000Z"),
    stuckAfterMs: DEFAULT_BUILDER_STUCK_AFTER_MS,
  } as unknown as BuilderOperationDeps;
}

async function builderOutput(
  operationId: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const operation = OPERATION_CATALOG.get(operationId);
  if (!operation) throw new Error(`${operationId} is not in the catalog`);
  const result = await executeBuilderOperation({
    operation,
    fields,
    owner: caller.userEmail,
    signal: new AbortController().signal,
    deps: builderDeps(),
  });
  if (!result.ok) throw new Error(`${operationId} did not return a result`);
  return result.output as Record<string, unknown>;
}

const task = { projectId: "proj-1", branchName: "factory-group-7" };

function fakeSlack(permalink: "found" | "missing") {
  return {
    verifyAgentNativeIdentity: vi.fn(async () => undefined),
    findUserByEmail: vi.fn(),
    postChannelMessage: vi.fn(async () => ({
      ok: true,
      channel: "C0123ABCD",
      ts: "1700000000.000200",
    })),
    postThreadReply: vi.fn(async () => ({
      ok: true,
      channel: "C0123ABCD",
      ts: "1700000000.000300",
    })),
    getMessagePermalink: vi.fn(async () => {
      if (permalink === "missing") throw new Error("not_in_channel");
      return "https://example.slack.com/archives/C0123ABCD/p1";
    }),
  };
}

async function slackOutputs(
  extra: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const outputs: Record<string, unknown>[] = [];
  for (const permalink of ["found", "missing"] as const) {
    createSlackMock.mockReturnValue(fakeSlack(permalink));
    outputs.push(
      (await postSlackMessage.run(
        { to: "C0123ABCD", text: "Hello", ...extra },
        context,
      )) as Record<string, unknown>,
    );
  }
  return outputs;
}

// What each operation's implementation returns, produced by running it with
// only its provider edge (Builder, GitHub, Slack, the email transport) faked.
// `builder.check` is held to its declaration exactly in builder-operations.spec.ts.
const RETURNED: Record<string, () => Promise<Record<string, unknown>[]>> = {
  "builder.start": async () => [
    await builderOutput("builder.start", {
      ...task,
      prompt: "Fix the login bug",
      clearBug: true,
      productUxImplications: false,
      risk: "low",
      confidence: "high",
      alreadyClaimed: false,
      categories: [],
    }),
  ],
  "builder.followUp": async () => [
    await builderOutput("builder.followUp", {
      ...task,
      userMessage: "status? continue",
    }),
  ],
  "github.readPullRequest": async () => {
    createGitHubMock.mockReturnValue(fakeGitHub());
    return [
      (await getPullRequest.run(pullRequest, context)) as Record<
        string,
        unknown
      >,
    ];
  },
  "github.mergePullRequest": async () => {
    createGitHubMock.mockReturnValue(fakeGitHub());
    const capture = createCapturingTripwireSink();
    const observer = createRunObserver(capture.sink);
    return [
      (await withRunObserver(observer, () =>
        mergePullRequest.run(
          { ...pullRequest, mergeMethod: "squash" },
          context,
        ),
      )) as Record<string, unknown>,
    ];
  },
  "factory.mergeGate": async () => {
    createGitHubMock.mockReturnValue(fakeGitHub());
    return [
      (await mergeGate.run(pullRequest, context)) as Record<string, unknown>,
    ];
  },
  "slack.postMessage": () => slackOutputs({}),
  "slack.replyInThread": () => slackOutputs({ threadTs: "1700000000.000100" }),
  "email.send": async () => [
    (await sendEmail.run(
      {
        to: "ada@example.test",
        subject: "Hello",
        body: "Hi **Ada**",
        cc: "lee@example.test",
      },
      { ...context, runId: "run-1" },
    )) as Record<string, unknown>,
  ],
};

const DECLARED_ELSEWHERE = ["builder.check"];

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
  resolveRepositoryMock.mockResolvedValue("acme/app");
  slackWorkspaceMock.mockResolvedValue("primary");
  readinessMock.mockResolvedValue({ status: "ready", provider: "resend" });
  sendEmailMock.mockResolvedValue({ status: "sent", provider: "resend" });
});

describe("declared operation outputs", () => {
  it("is checked for every operation that declares outputs, so a new declaration cannot go unchecked", () => {
    const declaring = OPERATION_CATALOG.list()
      .filter((def) => def.outputs && !DECLARED_ELSEWHERE.includes(def.id))
      .map((def) => def.id)
      .sort();

    expect(Object.keys(RETURNED).sort()).toEqual(declaring);
  });

  it.each(Object.keys(RETURNED))(
    "%s returns no field its declaration leaves out",
    async (operationId) => {
      const def = OPERATION_CATALOG.get(operationId);
      const allowed = new Set(
        (def ? (operationOutputs(def) ?? []) : []).map((output) => output.name),
      );
      const returned = await RETURNED[operationId]!();

      for (const output of returned) {
        const keys = Object.keys(output);
        expect(keys.length).toBeGreaterThan(0);
        expect(keys.filter((key) => !allowed.has(key))).toEqual([]);
      }
    },
  );
});
