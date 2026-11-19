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

import addGithubLabels from "../../actions/add-github-labels.js";
import addSlackReaction from "../../actions/add-slack-reaction.js";
import mergeGate from "../../actions/get-factory-merge-gate.js";
import getPullRequest from "../../actions/get-factory-pull-request.js";
import mergePullRequest from "../../actions/merge-factory-pull-request.js";
import postSlackMessage from "../../actions/post-slack-message.js";
import readSlackUserEmail from "../../actions/read-slack-user-email.js";
import removeGithubLabel from "../../actions/remove-github-label.js";
import sendEmail from "../../actions/send-factory-email.js";
import { SlackWriteError } from "../connectors/slack.js";
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
    // A start reads the reports it is for; this spec only looks at what comes back.
    readReports: vi.fn(async () => ({
      ok: true as const,
      reports: [
        {
          id: "r1",
          externalId: "r1",
          kind: "message" as const,
          provider: "slack",
          title: "Login fails",
          occurredAt: "2026-10-18T11:00:00.000Z",
          extras: {},
        },
      ],
    })),
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

function fakeIssueGitHub(
  removal: { removed: boolean; labels: string[] | null } = {
    removed: true,
    labels: [],
  },
) {
  return {
    addIssueLabels: vi.fn(
      async (_repo: unknown, _number: number, labels: readonly string[]) => [
        ...labels,
      ],
    ),
    removeIssueLabel: vi.fn(async () => removal),
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
      reports: [{ id: "r1" }],
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
  "github.addLabels": async () => {
    createGitHubMock.mockReturnValue(fakeIssueGitHub());
    return [
      (await addGithubLabels.run(
        { ...pullRequest, labels: ["triage", "bug"] },
        context,
      )) as Record<string, unknown>,
    ];
  },
  // Both ends of it: a label that was on the item, and one that was not.
  "github.removeLabel": async () => {
    const outputs: Record<string, unknown>[] = [];
    for (const removal of [
      { removed: true, labels: ["keep"] },
      { removed: false, labels: null },
    ]) {
      createGitHubMock.mockReturnValue(fakeIssueGitHub(removal));
      outputs.push(
        (await removeGithubLabel.run(
          { ...pullRequest, label: "triage" },
          context,
        )) as Record<string, unknown>,
      );
    }
    return outputs;
  },
  "slack.addReaction": async () => {
    const outputs: Record<string, unknown>[] = [];
    for (const reacted of [false, true]) {
      createSlackMock.mockReturnValue({
        verifyAgentNativeIdentity: vi.fn(async () => undefined),
        addReaction: vi.fn(async () => {
          if (reacted) {
            throw new SlackWriteError(
              "Slack API error: already_reacted",
              "rejected",
            );
          }
        }),
      });
      outputs.push(
        (await addSlackReaction.run(
          { channel: "C0123ABCD", ts: "1700000000.000100", name: "eyes" },
          context,
        )) as Record<string, unknown>,
      );
    }
    return outputs;
  },
  "slack.getUserEmail": async () => {
    const outputs: Record<string, unknown>[] = [];
    for (const email of ["ada@example.test", null]) {
      createSlackMock.mockReturnValue({
        getUserEmail: vi.fn(async () => ({
          id: "U01REPORT01",
          email,
          isBot: false,
          grantedScopes: ["users:read.email"],
        })),
      });
      outputs.push(
        (await readSlackUserEmail.run(
          {
            userId: "U01REPORT01",
            fallbackEmail: "triage-owner@example.test",
          },
          context,
        )) as Record<string, unknown>,
      );
    }
    return outputs;
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

// jira-workflow.spec.ts and sentry-workflow.spec.ts hold these to their declarations exactly.
const DECLARED_ELSEWHERE = [
  "builder.check",
  "jira.getIssue",
  "jira.listTransitions",
  "jira.transitionIssue",
  "sentry.assignIssue",
  "sentry.resolveIssue",
];

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
