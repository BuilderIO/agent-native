import { createRequire } from "node:module";

import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

// Enabling a workflow must never answer what was already in the channel. These
// run the real engine, the real inbox host and the real poll actions over a
// real database; only the providers are fakes (a Slack channel, a GitHub
// repository, a Sentry project). Nothing here calls a live provider.
const world = vi.hoisted(() => ({
  db: undefined as unknown,
  job: undefined as unknown,
  slack: undefined as unknown,
  github: undefined as unknown,
  sentry: undefined as unknown,
}));

vi.mock("../../../../packages/core/dist/audit/store.js", async (original) => ({
  ...(await original<object>()),
  insertAuditEvent: async () => {},
}));
vi.mock("../db/index.js", () => ({ getDb: () => world.db }));
vi.mock("../lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: async () => {},
}));
vi.mock("../lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: async () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
    role: "member",
  }),
  workspaceMemberIdentityFromContext: () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
  }),
}));
vi.mock("../lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: async () => world.job,
}));
vi.mock("../triage/audit.js", () => ({ recordFactoryAudit: async () => {} }));
vi.mock("../triage/slack-client.js", () => ({
  createSlackReader: () => world.slack,
}));
vi.mock("../triage/github-client.js", async (original) => ({
  ...(await original<object>()),
  createGitHubClient: () => world.github,
}));
vi.mock("../triage/sentry-client.js", async (original) => ({
  ...(await original<object>()),
  createSentryClient: () => world.sentry,
}));

import * as pollGithub from "../../actions/poll-github-sources.js";
import * as pollSentry from "../../actions/poll-sentry-errors.js";
import * as pollSlack from "../../actions/poll-slack-channel.js";
import { factoryPollCursors, triageItems } from "../db/schema.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import type {
  GitHubIssue,
  GitHubPullRequest,
} from "../triage/github-client.js";
import { itemDedupeKey } from "../triage/ids.js";
import type { SentryIssue } from "../triage/sentry-client.js";
import type { InboxRequest, WorkflowScope } from "../workflow/adapter.js";
import type { StepRecord } from "../workflow/contract.js";
import {
  chain,
  endWith,
  ran,
  stepOf,
} from "../workflow/testing/engine-fixtures.js";
import {
  makeHost,
  reenable,
  seedWorkflow,
} from "../workflow/testing/make-host.js";
import { decodeStart } from "./inbox-start.js";
import {
  createGuardedActionCaller,
  createInboxHost,
  type GuardedActionCall,
} from "./inbox.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

/** The entry at `index`, or a loud failure: a test reads what it expects to be there. */
function nth<T>(list: readonly T[], index: number): T {
  const found = list.find((_, at) => at === index);
  if (found === undefined) throw new Error(`There is no entry ${index}.`);
  return found;
}

/** What the step sent out of its `out` port. */
function out(step: StepRecord) {
  const port = Object.entries(step.ports).find(([name]) => name === "out");
  if (!port) throw new Error(`Step "${step.nodeId}" has no out port.`);
  return port[1];
}

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "product-feedback" };
const OWNER = "owner@example.test";
const CHANNEL = "C0123ABCD";
const REPO = "acme/web";

let sharedClient: PGliteClient | undefined;

async function emptyClient(): Promise<PGliteClient> {
  if (!sharedClient) {
    sharedClient = await PGlite.create("memory://");
    for (const migration of factoryMigrations) {
      if (typeof migration.sql === "string") {
        await sharedClient.exec(migration.sql);
      }
    }
  }
  await sharedClient.exec(
    "TRUNCATE factory_items, factory_workflow_item_state, factory_poll_cursors",
  );
  return sharedClient;
}

afterAll(async () => {
  await sharedClient?.close();
  sharedClient = undefined;
});

let db: ReturnType<typeof drizzle>;
/** Wall-clock time as the actions see it: rows are stamped with it, and a source's start is compared against it. */
let wall: number;

const registry = loadActionsFromStaticRegistry({
  "poll-slack-channel": pollSlack,
  "poll-github-sources": pollGithub,
  "poll-sentry-errors": pollSentry,
});

beforeEach(async () => {
  const client = await emptyClient();
  db = drizzle(client);
  world.db = db;
  vi.useFakeTimers({ toFake: ["Date"] });
  wall = Date.parse("2026-10-19T12:00:00.000Z");
  vi.setSystemTime(wall);
});

afterEach(() => vi.useRealTimers());

/** Five minutes pass. */
function later(minutes = 5) {
  wall += minutes * 60_000;
  vi.setSystemTime(wall);
}

/** One workflow over one inbox source, wired to the real host and the real poll actions. */
async function startWorkflow(source: Record<string, unknown>) {
  const test = makeHost({ scope: SCOPE });
  const { id } = await seedWorkflow(
    test,
    chain([], { source, end: endWith("done") }),
  );
  const guarded = createGuardedActionCaller({
    actions: registry,
    ownerEmail: OWNER,
    orgId: SCOPE.orgId,
    automation: {
      triggerId: "job-1",
      triggerName: `factories/${SCOPE.factoryId}/flow`,
    },
    runId: "run-1",
  });
  const calls: GuardedActionCall[] = [];
  const host = createInboxHost({
    scope: SCOPE,
    workflowId: id,
    getDatabase: () => db,
    callAction: async (call) => {
      calls.push(call);
      const result = await guarded(call);
      if (result.status !== "completed") {
        throw new Error(`${call.name}: ${result.output}`);
      }
      return result;
    },
  });
  test.inbox.take = async (request: InboxRequest) => {
    test.inbox.requests.push(request);
    return host.take(request);
  };
  // An End moves the real row, so a handled message is not offered again.
  const setStatus = test.statuses.setStatus.bind(test.statuses);
  test.statuses.setStatus = async (request) => {
    const result = await setStatus(request);
    if (result.ok) {
      await db
        .update(triageItems)
        .set({ status: request.status })
        .where(eq(triageItems.id, request.itemId));
    }
    return result;
  };
  return {
    test,
    id,
    calls,
    /** Everything the engine has finished with, in order. */
    handled: () => test.statuses.written.map((entry) => entry.itemId),
    cursor: () =>
      test.store.getSourceCursor(test.scope, { workflowId: id, nodeId: "src" }),
    rows: () => db.select().from(triageItems),
    factoryCursors: () => db.select().from(factoryPollCursors),
  };
}

// --- Slack ---------------------------------------------------------------

interface SlackLine {
  type: "message";
  user: string;
  text: string;
  ts: string;
}

/** A channel that pages the way Slack's history does: newest first, a cursor to the next page. */
class FakeChannel {
  readonly messages: SlackLine[] = [];
  readonly historyCalls: { limit: number; cursor?: string }[] = [];

  /** `ts` for the nth message: one a second, from a fixed epoch. */
  static ts(n: number): string {
    return `${1_760_000_000 + n}.000100`;
  }

  post(n: number): string {
    const ts = FakeChannel.ts(n);
    this.messages.push({
      type: "message",
      user: "U1",
      text: `message ${n}`,
      ts,
    });
    return ts;
  }

  postRange(from: number, to: number): void {
    for (let n = from; n <= to; n += 1) this.post(n);
  }

  reader = {
    getChannelHistory: async (
      _workspace: string,
      _channel: string,
      limit = 100,
      cursor?: string,
    ) => {
      this.historyCalls.push({ limit, ...(cursor ? { cursor } : {}) });
      const newestFirst = [...this.messages].reverse();
      const start = cursor === undefined ? 0 : Number(cursor);
      const more = start + limit < newestFirst.length;
      return {
        messages: newestFirst.slice(start, start + limit),
        has_more: more,
        ...(more ? { next_cursor: String(start + limit) } : {}),
      };
    },
    getTeamInfo: async () => ({ domain: "builder" }),
    getUserInfo: async (_workspace: string, id: string) => ({
      id,
      name: id,
      displayName: null,
      isBot: false,
    }),
    getAgentNativeIdentity: async () => ({ userId: "UBOT" }),
  };
}

const slackSource = (takeLimit = 5) => ({
  source: "inbox-poll",
  poller: "slack",
  takeLimit,
  filter: { scopes: [CHANNEL] },
});

/** What the poller calls a message: the channel and its thread, which for a message that starts one is its own time. */
const slackExternalId = (n: number) => `${CHANNEL}:${FakeChannel.ts(n)}`;

/** The id the inbox gives the message, which is what a step lists and an End moves. */
const slackItemId = (n: number) =>
  itemDedupeKey(
    { source: "slack", externalId: slackExternalId(n) },
    SCOPE.orgId,
    SCOPE.factoryId,
  );

const externalIds = (rows: { externalId: string }[]) =>
  rows.map((row) => row.externalId).sort();

function slackWorld(options: { inboxLimit?: number } = {}) {
  const channel = new FakeChannel();
  world.slack = channel.reader;
  world.job = {
    name: "factories/product-feedback/jobs/flow",
    content: "",
    config: {
      source: "slack",
      slackChannelId: CHANNEL,
      authorMode: "exclude",
      authorIds: [],
      inboxLimit: options.inboxLimit ?? 25,
    },
  };
  return channel;
}

describe("a Slack source over a busy channel", () => {
  it("takes the newest position on its first live run and nothing that was already there", async () => {
    const channel = slackWorld();
    channel.postRange(1, 200);
    const flow = await startWorkflow(slackSource());

    const first = await ran(flow.test, flow.id);

    const step = stepOf(first, "src");
    expect(step.status).toBe("succeeded");
    expect(step.fields).toMatchObject({
      source: "inbox-poll",
      primed: true,
      ingested: false,
    });
    expect(out(step).count).toBe(0);
    expect(first.run.counts).toMatchObject({ taken: 0, primed: 1 });
    // Only the newest message was read, and nothing of the 200 was stored.
    expect(channel.historyCalls).toEqual([{ limit: 1 }]);
    expect(await flow.rows()).toEqual([]);
    expect(await flow.factoryCursors()).toEqual([]);
    const saved = await flow.cursor();
    const decoded = decodeStart(saved?.value ?? "");
    if (!decoded.ok) throw new Error(decoded.message);
    expect(decoded.start).toMatchObject({
      scope: CHANNEL,
      position: FakeChannel.ts(200),
    });
  });

  it("takes only what is newer than that position on the next run, each message once, in order", async () => {
    const channel = slackWorld();
    channel.postRange(1, 200);
    const flow = await startWorkflow(slackSource(10));
    await ran(flow.test, flow.id);

    channel.postRange(201, 203);
    later();
    const second = await ran(flow.test, flow.id);
    expect(stepOf(second, "src").fields).not.toHaveProperty("primed");
    expect(stepOf(second, "src").fields).toMatchObject({ ingested: true });
    expect(second.run.counts).toMatchObject({ taken: 3, primed: 0 });

    later();
    const quiet = await ran(flow.test, flow.id);
    expect(quiet.run.counts).toMatchObject({ taken: 0 });

    channel.postRange(204, 205);
    later();
    await ran(flow.test, flow.id);

    expect([...flow.handled()].sort()).toEqual(
      [201, 202, 203, 204, 205].map(slackItemId).sort(),
    );
    expect(new Set(flow.handled()).size).toBe(flow.handled().length);
    // The history is not in the inbox at all.
    expect(externalIds(await flow.rows())).toEqual(
      [201, 202, 203, 204, 205].map(slackExternalId).sort(),
    );
  });

  it("reaches every message of a burst bigger than one run takes, none twice and none skipped", async () => {
    const channel = slackWorld({ inboxLimit: 25 });
    channel.postRange(1, 200);
    const flow = await startWorkflow(slackSource(10));
    await ran(flow.test, flow.id);

    channel.postRange(201, 260);
    for (let run = 0; run < 10; run += 1) {
      later();
      await ran(flow.test, flow.id);
    }

    const expected = Array.from({ length: 60 }, (_, index) =>
      slackItemId(201 + index),
    );
    expect([...flow.handled()].sort()).toEqual([...expected].sort());
    expect(new Set(flow.handled()).size).toBe(60);
  });

  it("leaves nothing behind when a dry run comes first, and the first live run still starts from now", async () => {
    const channel = slackWorld();
    channel.postRange(1, 200);
    const flow = await startWorkflow(slackSource(5));

    const dry = await ran(flow.test, flow.id, { mode: "dry" });

    const step = stepOf(dry, "src");
    expect(step.fields).toMatchObject({
      sample: true,
      wouldPrime: true,
      ingested: false,
    });
    // The newest five messages are shown as a sample, so the graph can be tried on real data.
    expect(out(step).count).toBe(5);
    expect(out(step).itemIds.sort()).toEqual(
      [196, 197, 198, 199, 200].map(slackItemId).sort(),
    );
    expect(dry.run.counts).toMatchObject({ primed: 0 });
    expect(await flow.rows()).toEqual([]);
    expect(await flow.factoryCursors()).toEqual([]);
    expect(await flow.cursor()).toBeNull();
    expect(nth(flow.calls, 0).input).toMatchObject({
      prime: true,
      preview: true,
    });

    later();
    const live = await ran(flow.test, flow.id);

    expect(stepOf(live, "src").fields).toMatchObject({ primed: true });
    expect(live.run.counts).toMatchObject({ taken: 0, primed: 1 });
    expect(flow.handled().filter((id) => id.startsWith(CHANNEL))).toEqual(
      // Only the dry run's own End was simulated: it wrote nothing.
      [],
    );
    expect(await flow.rows()).toEqual([]);
  });

  it("leaves nothing behind when a dry run comes after, and the next live run takes the message once", async () => {
    const channel = slackWorld();
    channel.postRange(1, 200);
    const flow = await startWorkflow(slackSource(5));
    await ran(flow.test, flow.id);
    const before = (await flow.cursor())?.value;

    channel.post(201);
    later();
    const dry = await ran(flow.test, flow.id, { mode: "dry" });

    expect(out(stepOf(dry, "src")).itemIds).toEqual([slackItemId(201)]);
    expect(stepOf(dry, "src").fields).toMatchObject({ sample: true });
    expect(await flow.rows()).toEqual([]);
    expect(await flow.factoryCursors()).toEqual([]);
    expect((await flow.cursor())?.value).toBe(before);

    later();
    const live = await ran(flow.test, flow.id);

    expect(live.run.counts).toMatchObject({ taken: 1 });
    expect(flow.handled()).toEqual([slackItemId(201)]);
  });

  it("keeps its position when the workflow is turned off and on, and does not start over", async () => {
    const channel = slackWorld();
    channel.postRange(1, 200);
    const flow = await startWorkflow(slackSource(5));
    await ran(flow.test, flow.id);
    const before = (await flow.cursor())?.value;
    await flow.test.store.setWorkflowEnabled(flow.test.scope, flow.id, false);

    channel.post(201);
    later(60);
    await reenable(flow.test, flow.id);
    const live = await ran(flow.test, flow.id);

    expect(stepOf(live, "src").fields).not.toHaveProperty("primed");
    expect(flow.handled()).toEqual([slackItemId(201)]);
    expect(before).toBeDefined();
  });

  it("reads exactly as it always did when the workflow was already running with no position saved", async () => {
    const channel = slackWorld();
    channel.postRange(1, 40);
    const flow = await startWorkflow(slackSource(5));
    // A workflow that finished a live run before positions existed.
    await flow.test.store.recordTriggerRun(flow.test.scope, {
      workflowId: flow.id,
      at: new Date(wall - 3_600_000).toISOString(),
    });
    later();

    const live = await ran(flow.test, flow.id);

    expect(nth(flow.test.inbox.requests, 0)).not.toHaveProperty("start");
    expect(nth(flow.calls, 0).input).toEqual({
      factoryId: SCOPE.factoryId,
      channelId: CHANNEL,
      skipOwnPosts: true,
      headlines: true,
    });
    expect(stepOf(live, "src").fields).not.toHaveProperty("primed");
    // The legacy read: the oldest messages first, up to the inbox limit.
    expect(live.run.counts).toMatchObject({ taken: 5, primed: 0 });
    expect(await flow.cursor()).toBeNull();
    expect((await flow.factoryCursors()).length).toBe(1);
  });
});

// --- GitHub --------------------------------------------------------------

/** An instant `n` minutes into a fixed day, in the second-resolution form GitHub writes. */
const minute = (n: number) =>
  new Date(Date.UTC(2026, 9, 1, 0, 0) + n * 60_000)
    .toISOString()
    .replace(".000Z", "Z");

class FakeRepository {
  issues: GitHubIssue[] = [];
  pullRequests: GitHubPullRequest[] = [];
  readonly pagesAsked: { kind: "issues" | "pulls"; page: number }[] = [];

  issue(number: number, createdAt: string): GitHubIssue {
    const issue: GitHubIssue = {
      number,
      title: `Issue ${number}`,
      body: `Body of issue ${number}`,
      state: "open",
      htmlUrl: `https://github.test/${REPO}/issues/${number}`,
      userLogin: "reporter",
      userId: "7",
      labels: [],
      createdAt,
      updatedAt: createdAt,
    };
    this.issues.push(issue);
    return issue;
  }

  pullRequest(number: number, createdAt: string): GitHubPullRequest {
    const pullRequest: GitHubPullRequest = {
      number,
      title: `Pull request ${number}`,
      body: "A change",
      state: "open",
      draft: false,
      merged: false,
      mergedAt: null,
      htmlUrl: `https://github.test/${REPO}/pull/${number}`,
      userId: 8,
      userLogin: "author",
      headSha: `sha${number}`,
      headRef: `branch-${number}`,
      baseRef: "main",
      createdAt,
      updatedAt: createdAt,
    };
    this.pullRequests.push(pullRequest);
    return pullRequest;
  }

  /** Newest first, fifty to a page, as GitHub lists open items by default. */
  private page<T extends { createdAt: string }>(
    all: readonly T[],
    perPage: number,
    page: number,
  ) {
    const newestFirst = [...all].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    const start = (page - 1) * perPage;
    return {
      items: newestFirst.slice(start, start + perPage),
      unparsed: 0,
      hasMore: newestFirst.length > start + perPage,
    };
  }

  client = {
    listOpenIssues: async (
      _repository: unknown,
      limit = 100,
      options: { page?: number } = {},
    ) => {
      this.pagesAsked.push({ kind: "issues", page: options.page ?? 1 });
      return this.page(this.issues, limit, options.page ?? 1);
    },
    listOpenPullRequests: async (
      _repository: unknown,
      limit = 100,
      options: { page?: number } = {},
    ) => {
      this.pagesAsked.push({ kind: "pulls", page: options.page ?? 1 });
      return this.page(this.pullRequests, limit, options.page ?? 1);
    },
    // A pull request the inbox already holds is looked at again every poll:
    // these answer that look with a quiet, open pull request.
    getPullRequestSummary: async (_repository: unknown, number: number) => ({
      ...this.pullRequests.find((entry) => entry.number === number)!,
      mergeable: true,
      mergeableState: "clean",
    }),
    getPullRequestEvidence: async () => ({
      comments: [],
      reviews: [],
      commentsTruncated: false,
      reviewsTruncated: false,
    }),
    listIssueComments: async () => ({ comments: [], truncated: false }),
  };
}

const githubSource = (takeLimit = 10) => ({
  source: "inbox-poll",
  poller: "github",
  takeLimit,
  filter: { scopes: [REPO] },
});

function githubWorld() {
  const repository = new FakeRepository();
  world.github = repository.client;
  world.job = {
    name: "factories/product-feedback/jobs/flow",
    content: "",
    config: {
      source: "github",
      repository: REPO,
      authorMode: "exclude",
      authorIds: [],
      inboxLimit: 25,
    },
  };
  return repository;
}

const pullRequestId = (number: number) =>
  itemDedupeKey(
    {
      source: "github",
      externalId: `${REPO}#${number}`,
      repository: REPO,
      pullRequestNumber: number,
    },
    SCOPE.orgId,
    SCOPE.factoryId,
  );

describe("a GitHub source over a repository with open work", () => {
  it("starts from the newest open item and takes only what is opened after, once", async () => {
    const repository = githubWorld();
    for (let n = 1; n <= 120; n += 1) repository.issue(n, minute(n));
    for (let n = 1; n <= 30; n += 1) repository.pullRequest(500 + n, minute(n));
    const flow = await startWorkflow(githubSource());

    const first = await ran(flow.test, flow.id);

    expect(stepOf(first, "src").fields).toMatchObject({
      primed: true,
      ingested: false,
    });
    expect(first.run.counts).toMatchObject({ taken: 0, primed: 1 });
    expect(await flow.rows()).toEqual([]);
    const decoded = decodeStart((await flow.cursor())?.value ?? "");
    if (!decoded.ok) throw new Error(decoded.message);
    expect(decoded.start).toMatchObject({
      scope: REPO,
      position: minute(120),
    });

    repository.pullRequest(601, minute(130));
    repository.pullRequest(602, minute(131));
    later();
    const second = await ran(flow.test, flow.id);
    expect(second.run.counts).toMatchObject({ taken: 2, primed: 0 });

    later();
    const quiet = await ran(flow.test, flow.id);
    expect(quiet.run.counts).toMatchObject({ taken: 0 });

    repository.pullRequest(603, minute(140));
    later();
    await ran(flow.test, flow.id);

    expect([...flow.handled()].sort()).toEqual(
      [601, 602, 603].map(pullRequestId).sort(),
    );
    expect(externalIds(await flow.rows())).toEqual([
      `${REPO}#601`,
      `${REPO}#602`,
      `${REPO}#603`,
    ]);
  });

  it("holds its position while pull requests newer than it are still unread, and loses none of them", async () => {
    const repository = githubWorld();
    for (let n = 1; n <= 10; n += 1) repository.pullRequest(n, minute(n));
    const flow = await startWorkflow(githubSource(10));
    await ran(flow.test, flow.id);
    const positionOf = async () => {
      const decoded = decodeStart((await flow.cursor())?.value ?? "");
      if (!decoded.ok) throw new Error(decoded.message);
      return decoded.start.position;
    };
    expect(await positionOf()).toBe(minute(10));

    // Thirty pull requests open at once and the inbox takes twenty-five at a time.
    for (let n = 11; n <= 40; n += 1) repository.pullRequest(n, minute(n));
    later();
    await ran(flow.test, flow.id);
    expect(await positionOf()).toBe(minute(10));

    for (let run = 0; run < 4; run += 1) {
      later();
      await ran(flow.test, flow.id);
    }

    expect(await positionOf()).toBe(minute(40));
    expect(flow.handled()).toHaveLength(30);
    expect(new Set(flow.handled()).size).toBe(30);
  });

  it("reads the open items only as far back as its position, not the whole list", async () => {
    const repository = githubWorld();
    for (let n = 1; n <= 120; n += 1) repository.issue(n, minute(n));
    const flow = await startWorkflow(githubSource());
    await ran(flow.test, flow.id);
    repository.pagesAsked.length = 0;

    later();
    await ran(flow.test, flow.id);

    // Newest first, so the first page already reaches the position and the walk
    // stops; and nothing of the 120 open issues is stored.
    expect(
      repository.pagesAsked.filter((entry) => entry.kind === "issues"),
    ).toEqual([{ kind: "issues", page: 1 }]);
    expect(await flow.rows()).toEqual([]);
  });

  it("leaves no row behind in a dry run, before or after the first live run", async () => {
    const repository = githubWorld();
    for (let n = 1; n <= 40; n += 1) repository.pullRequest(n, minute(n));
    const flow = await startWorkflow(githubSource(5));

    const dry = await ran(flow.test, flow.id, { mode: "dry" });

    expect(stepOf(dry, "src").fields).toMatchObject({
      sample: true,
      wouldPrime: true,
    });
    expect(out(stepOf(dry, "src")).count).toBe(5);
    expect(await flow.rows()).toEqual([]);
    expect(await flow.cursor()).toBeNull();

    later();
    const live = await ran(flow.test, flow.id);
    expect(live.run.counts).toMatchObject({ taken: 0, primed: 1 });

    repository.pullRequest(41, minute(60));
    later();
    const dryAfter = await ran(flow.test, flow.id, { mode: "dry" });
    expect(out(stepOf(dryAfter, "src")).count).toBe(1);
    expect(await flow.rows()).toEqual([]);

    later();
    const next = await ran(flow.test, flow.id);
    expect(next.run.counts).toMatchObject({ taken: 1 });
    expect(await flow.rows()).toHaveLength(1);
  });
});

// --- Sentry --------------------------------------------------------------

class FakeProject {
  issues: SentryIssue[] = [];
  readonly asked: { query?: string; limit?: number; sort?: string }[] = [];

  issue(id: number, firstSeen: string): void {
    this.issues.push({
      id: String(id),
      shortId: `WEB-${id}`,
      title: `Error ${id}`,
      culprit: `app/module${id}`,
      permalink: `https://sentry.test/issues/${id}`,
      level: "error",
      status: "unresolved",
      projectSlug: "web",
      count: "3",
      firstSeen,
      lastSeen: firstSeen,
    });
  }

  client = {
    listIssues: async (
      query?: string,
      limit = 100,
      options: { sort?: "freq" | "new" } = {},
    ) => {
      this.asked.push({
        ...(query ? { query } : {}),
        limit,
        ...(options.sort ? { sort: options.sort } : {}),
      });
      const ordered =
        options.sort === "new"
          ? [...this.issues].sort(
              (a, b) => Date.parse(b.firstSeen) - Date.parse(a.firstSeen),
            )
          : // The busiest first: here, the oldest, which is where a new issue is not.
            [...this.issues].sort(
              (a, b) => Date.parse(a.firstSeen) - Date.parse(b.firstSeen),
            );
      return ordered.slice(0, limit);
    },
  };
}

const sentrySource = (takeLimit = 10) => ({
  source: "inbox-poll",
  poller: "sentry",
  takeLimit,
  filter: { scopes: ["acme/web"] },
});

function sentryWorld() {
  const project = new FakeProject();
  world.sentry = project.client;
  world.job = {
    name: "factories/product-feedback/jobs/flow",
    content: "",
    config: {
      source: "sentry",
      sentryOrgSlug: "acme",
      sentryProjectSlug: "web",
      authorMode: "exclude",
      authorIds: [],
      inboxLimit: 25,
    },
  };
  return project;
}

describe("a Sentry source over a project with open issues", () => {
  it("starts from the newest first-seen time and takes only issues first seen after, once", async () => {
    const project = sentryWorld();
    for (let n = 1; n <= 80; n += 1) project.issue(n, minute(n));
    const flow = await startWorkflow(sentrySource());

    const first = await ran(flow.test, flow.id);

    expect(stepOf(first, "src").fields).toMatchObject({
      primed: true,
      ingested: false,
    });
    expect(first.run.counts).toMatchObject({ taken: 0, primed: 1 });
    expect(await flow.rows()).toEqual([]);
    expect(await flow.factoryCursors()).toEqual([]);
    // Newest first, so a brand-new issue is never left off a short page.
    expect(project.asked[0]).toMatchObject({ limit: 1, sort: "new" });
    const decoded = decodeStart((await flow.cursor())?.value ?? "");
    if (!decoded.ok) throw new Error(decoded.message);
    expect(decoded.start).toMatchObject({
      scope: "acme/web",
      position: minute(80),
    });

    project.issue(81, minute(90));
    project.issue(82, minute(95));
    later();
    const second = await ran(flow.test, flow.id);
    expect(second.run.counts).toMatchObject({ taken: 2, primed: 0 });

    later();
    const quiet = await ran(flow.test, flow.id);
    expect(quiet.run.counts).toMatchObject({ taken: 0 });

    project.issue(83, minute(100));
    later();
    await ran(flow.test, flow.id);

    expect([...flow.handled()].sort()).toEqual(
      [81, 82, 83]
        .map((id) =>
          itemDedupeKey(
            { source: "sentry", externalId: String(id) },
            SCOPE.orgId,
            SCOPE.factoryId,
          ),
        )
        .sort(),
    );
    expect(externalIds(await flow.rows())).toEqual(["81", "82", "83"]);
  });

  it("holds its position while issues newer than it are still unread, and loses none of them", async () => {
    const project = sentryWorld();
    for (let n = 1; n <= 80; n += 1) project.issue(n, minute(n));
    const flow = await startWorkflow(sentrySource(10));
    await ran(flow.test, flow.id);
    const positionOf = async () => {
      const decoded = decodeStart((await flow.cursor())?.value ?? "");
      if (!decoded.ok) throw new Error(decoded.message);
      return decoded.start.position;
    };

    // Thirty issues arrive at once and the inbox takes twenty-five at a time.
    for (let n = 81; n <= 110; n += 1) project.issue(n, minute(n));
    later();
    await ran(flow.test, flow.id);
    expect(await positionOf()).toBe(minute(80));

    for (let run = 0; run < 4; run += 1) {
      later();
      await ran(flow.test, flow.id);
    }

    expect(await positionOf()).toBe(minute(110));
    expect(new Set(flow.handled()).size).toBe(30);
    expect(flow.handled()).toHaveLength(30);
  });

  it("leaves no row behind in a dry run, before or after the first live run", async () => {
    const project = sentryWorld();
    for (let n = 1; n <= 40; n += 1) project.issue(n, minute(n));
    const flow = await startWorkflow(sentrySource(5));

    const dry = await ran(flow.test, flow.id, { mode: "dry" });

    expect(stepOf(dry, "src").fields).toMatchObject({
      sample: true,
      wouldPrime: true,
    });
    expect(await flow.rows()).toEqual([]);
    expect(await flow.factoryCursors()).toEqual([]);
    expect(await flow.cursor()).toBeNull();

    later();
    const live = await ran(flow.test, flow.id);
    expect(live.run.counts).toMatchObject({ taken: 0, primed: 1 });

    project.issue(41, minute(60));
    later();
    const dryAfter = await ran(flow.test, flow.id, { mode: "dry" });
    expect(out(stepOf(dryAfter, "src")).count).toBe(1);
    expect(await flow.rows()).toEqual([]);

    later();
    const next = await ran(flow.test, flow.id);
    expect(next.run.counts).toMatchObject({ taken: 1 });
  });
});
