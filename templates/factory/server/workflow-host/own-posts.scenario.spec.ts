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

// A workflow that posts into the channel it reads must never read its own post
// as the next report. These run the real engine, the real inbox host, the real
// poll action, the real Slack reader and its identity check, over a real
// database; only Slack's HTTP answers are fakes, shaped as Slack shapes them
// (the app's post carries its bot user, bot id and app id). Nothing here calls a
// live provider, and none of the sources sets an author filter.
const world = vi.hoisted(() => ({
  db: undefined as unknown,
  job: undefined as unknown,
}));
const fetchMock = vi.hoisted(() => vi.fn());
const secretMock = vi.hoisted(() => vi.fn());

vi.mock("@factory-test/audit-store", async (original) => ({
  ...(await original<object>()),
  insertAuditEvent: async () => {},
}));
vi.mock("../db/index.js", () => ({ getDb: () => world.db }));
vi.mock("../connectors/credentials.js", () => ({
  resolveConnectorSecret: secretMock,
}));
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

import * as pollSlack from "../../actions/poll-slack-channel.js";
import { triageItems } from "../db/schema.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import { itemDedupeKey } from "../triage/ids.js";
import type { InboxRequest, WorkflowScope } from "../workflow/adapter.js";
import { STORIES } from "../workflow/stories/registry.js";
import {
  chain,
  endWith,
  ran,
  stepOf,
} from "../workflow/testing/engine-fixtures.js";
import { makeHost, seedWorkflow } from "../workflow/testing/make-host.js";
import { decodeStart } from "./inbox-start.js";
import {
  createGuardedActionCaller,
  createInboxHost,
  type GuardedActionCall,
} from "./inbox.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "product-feedback" };
const OWNER = "owner@example.test";
const CHANNEL = "C0123ABCD";

// Who the app is in this workspace, and who else posts there.
const APP_USER = "UAPP0000001";
const APP_BOT = "BAPP0000001";
const APP_ID = "AAPP0000001";
const OTHER_BOT = "BOTHER00001";
const PERSON = "UPERSON0001";

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
let wall: number;
let tokens = 0;

const registry = loadActionsFromStaticRegistry({
  "poll-slack-channel": pollSlack,
});

beforeEach(async () => {
  db = drizzle(await emptyClient());
  world.db = db;
  vi.useFakeTimers({ toFake: ["Date"] });
  wall = Date.parse("2026-10-19T12:00:00.000Z");
  vi.setSystemTime(wall);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  newToken();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Slack reads are cached by token for two minutes: a new token is a fresh look at Slack. */
function newToken() {
  tokens += 1;
  secretMock.mockReset().mockResolvedValue(`slack-test-token-${tokens}`);
}

function later(minutes = 5) {
  wall += minutes * 60_000;
  vi.setSystemTime(wall);
}

// --- Slack ---------------------------------------------------------------

type SlackMessage = Record<string, unknown> & { ts: string };

const json = (value: unknown) => new Response(JSON.stringify(value));

/** The nth second of a fixed day, as Slack writes a message time. */
const ts = (n: number) => `${1_760_000_000 + n}.000100`;

class FakeChannel {
  readonly messages: SlackMessage[] = [];
  historyCalls = 0;
  /** What `auth.test` answers: the app's identity, or Slack's error. */
  identity: "ok" | "ok-without-bot" | { error: string } = "ok";

  person(n: number, text = `report ${n}`): string {
    this.messages.push({ type: "message", user: PERSON, text, ts: ts(n) });
    return ts(n);
  }

  /** A channel post made with the app's bot token, as the history lists it. */
  appPost(n: number, text = `Needs a person: report ${n - 1}`): string {
    this.messages.push({
      type: "message",
      subtype: "bot_message",
      text,
      ts: ts(n),
      bot_id: APP_BOT,
      app_id: APP_ID,
      user: APP_USER,
      bot_profile: { id: APP_BOT, app_id: APP_ID, name: "agent-native" },
    });
    return ts(n);
  }

  /** The app's reply in a report's thread, shown in the channel too: the only reply a history lists. */
  appReply(n: number, threadN: number): string {
    this.messages.push({
      type: "message",
      subtype: "thread_broadcast",
      text: "Builder has started work on this.",
      ts: ts(n),
      thread_ts: ts(threadN),
      bot_id: APP_BOT,
      app_id: APP_ID,
      user: APP_USER,
    });
    return ts(n);
  }

  /** Another Slack app's bot: not this one, so a workflow still reads it. */
  otherBot(n: number): string {
    this.messages.push({
      type: "message",
      subtype: "bot_message",
      text: `deploy finished ${n}`,
      ts: ts(n),
      bot_id: OTHER_BOT,
      app_id: "AOTHER00001",
      username: "Deploys",
    });
    return ts(n);
  }

  install() {
    fetchMock.mockImplementation(async (input: unknown): Promise<Response> => {
      const url = new URL(String(input));
      const method = url.pathname.replace("/api/", "");
      if (method === "auth.test") {
        if (typeof this.identity === "object") {
          return json({ ok: false, error: this.identity.error });
        }
        return json({
          ok: true,
          user_id: APP_USER,
          user: "agent-native",
          team_id: "T1",
          team: "Builder",
          ...(this.identity === "ok" ? { bot_id: APP_BOT } : {}),
        });
      }
      if (method === "team.info") {
        return json({
          ok: true,
          team: { id: "T1", name: "Builder", domain: "builder" },
        });
      }
      if (method === "users.info") {
        const user = url.searchParams.get("user");
        return json({
          ok: true,
          user: { id: user, name: user, is_bot: false },
        });
      }
      if (method === "conversations.history") {
        this.historyCalls += 1;
        const limit = Number(url.searchParams.get("limit") ?? "100");
        const latest = url.searchParams.get("latest");
        const newestFirst = [...this.messages]
          .reverse()
          .filter((message) => latest === null || message.ts < latest);
        return json({
          ok: true,
          has_more: newestFirst.length > limit,
          messages: newestFirst.slice(0, limit),
        });
      }
      throw new Error(`unplanned Slack call: ${method}`);
    });
  }
}

function slackWorld(): FakeChannel {
  const channel = new FakeChannel();
  channel.install();
  // No author filter: nothing here says who not to read.
  world.job = {
    name: "factories/product-feedback/jobs/flow",
    content: "",
    config: {
      source: "slack",
      slackChannelId: CHANNEL,
      authorMode: "exclude",
      authorIds: [],
      inboxLimit: 25,
    },
  };
  return channel;
}

/** The Source of story 1 as shipped, pointed at the test channel. */
function storyOneSource(extra: Record<string, unknown> = {}) {
  const node = STORIES["bug-report-to-builder"].graph.nodes.find(
    (candidate) => candidate.id === "feedback",
  );
  if (!node || node.kind !== "source") {
    throw new Error("Story 1 has no feedback Source.");
  }
  const settings = node.settings;
  if (settings.source !== "inbox-poll") {
    throw new Error("Story 1's feedback node is not an inbox poll.");
  }
  return {
    ...settings,
    filter: { ...settings.filter, scopes: [CHANNEL], ...extra },
  };
}

const slackItemId = (n: number) =>
  itemDedupeKey(
    { source: "slack", externalId: `${CHANNEL}:${ts(n)}` },
    SCOPE.orgId,
    SCOPE.factoryId,
  );

// --- The workflow --------------------------------------------------------

/** One workflow over one Slack source, wired to the real host and the real poll action. */
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
      return guarded(call);
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
    handled: () => test.statuses.written.map((entry) => entry.itemId),
    cursor: async () => {
      const saved = await test.store.getSourceCursor(test.scope, {
        workflowId: id,
        nodeId: "src",
      });
      const decoded = decodeStart(saved?.value ?? "");
      if (!decoded.ok) throw new Error(decoded.message);
      return decoded.start.position;
    },
    rows: () => db.select().from(triageItems),
    /** The workflow goes live and takes the newest position, as the first run always does. */
    async goLive() {
      later();
      return ran(test, id);
    },
    async run(options: Parameters<typeof ran>[2] = {}) {
      later();
      return ran(test, id, options);
    },
  };
}

const externalIds = (rows: { externalId: string }[]) =>
  rows.map((row) => row.externalId).sort();

describe("the app's notice in the channel its Source reads", () => {
  it("is not taken as a second report, and the position moves past it so it is never read again", async () => {
    const channel = slackWorld();
    channel.person(1);
    const flow = await startWorkflow(storyOneSource());
    await flow.goLive();
    channel.person(2, "Checkout button does nothing");
    const first = await flow.run();
    expect(first.run.counts).toMatchObject({ taken: 1 });

    // The loop answers the report: a notice in the channel, newer than the position.
    channel.appPost(3, "Needs a person: Checkout button does nothing");
    const afterNotice = await flow.run();

    const step = stepOf(afterNotice, "src");
    expect(step.status).toBe("succeeded");
    expect(step.fields).toMatchObject({ taken: 0, skippedOwn: 1 });
    expect(afterNotice.run.counts).toMatchObject({ taken: 0 });
    expect(await flow.cursor()).toBe(ts(3));
    const quiet = await flow.run();
    expect(stepOf(quiet, "src").fields).toMatchObject({
      taken: 0,
      skippedOwn: 0,
    });
    expect(flow.handled()).toEqual([slackItemId(2)]);
    expect(externalIds(await flow.rows())).toEqual([`${CHANNEL}:${ts(2)}`]);
  });

  it("is passed over in the same read as the report it follows, and the position goes past both", async () => {
    const channel = slackWorld();
    channel.person(1);
    const flow = await startWorkflow(storyOneSource());
    await flow.goLive();
    channel.person(2, "Checkout button does nothing");
    channel.appPost(3);

    const read = await flow.run();

    expect(stepOf(read, "src").fields).toMatchObject({
      taken: 1,
      skippedOwn: 1,
    });
    expect(await flow.cursor()).toBe(ts(3));
    const next = await flow.run();
    expect(stepOf(next, "src").fields).toMatchObject({ skippedOwn: 0 });
    expect(flow.handled()).toEqual([slackItemId(2)]);
  });

  it("does not take the app's reply in a report's thread, and leaves the report as it was", async () => {
    const channel = slackWorld();
    channel.person(1);
    const flow = await startWorkflow(storyOneSource());
    await flow.goLive();
    channel.person(2, "Checkout button does nothing");
    await flow.run();
    const before = await flow.rows();

    channel.appReply(3, 2);
    const afterReply = await flow.run();

    expect(stepOf(afterReply, "src").fields).toMatchObject({
      taken: 0,
      skippedOwn: 1,
    });
    // The reply shares the report's thread, so taken it would have rewritten the report.
    expect(await flow.rows()).toEqual(before);
    expect(flow.handled()).toEqual([slackItemId(2)]);
    expect(await flow.cursor()).toBe(ts(3));
  });

  it("is passed over beside another app's bot and a person, who are both still taken", async () => {
    const channel = slackWorld();
    channel.person(1);
    const flow = await startWorkflow(storyOneSource());
    await flow.goLive();
    channel.otherBot(2);
    channel.appPost(3);
    channel.person(4, "Pay button is dead");
    channel.appPost(5);

    const read = await flow.run();

    expect(stepOf(read, "src").fields).toMatchObject({
      taken: 2,
      skippedOwn: 2,
    });
    expect(externalIds(await flow.rows())).toEqual([
      `${CHANNEL}:${ts(2)}`,
      `${CHANNEL}:${ts(4)}`,
    ]);
    expect(await flow.cursor()).toBe(ts(5));
  });

  it("is still recognised by its user when Slack answers auth.test for a token that has no bot", async () => {
    const channel = slackWorld();
    channel.identity = "ok-without-bot";
    channel.person(1);
    const flow = await startWorkflow(storyOneSource());
    await flow.goLive();
    channel.appPost(2);

    const read = await flow.run();

    expect(stepOf(read, "src").fields).toMatchObject({
      taken: 0,
      skippedOwn: 1,
    });
  });

  it("is taken when the Source says it should include the app's own posts", async () => {
    const channel = slackWorld();
    channel.person(1);
    const flow = await startWorkflow(storyOneSource({ includeOwnPosts: true }));
    await flow.goLive();
    channel.appPost(2);

    const read = await flow.run();

    expect(stepOf(read, "src").fields).toMatchObject({ taken: 1 });
    expect(stepOf(read, "src").fields).not.toHaveProperty("skippedOwn");
    expect(nth(flow.calls, 1).input).not.toHaveProperty("skipOwnPosts");
  });

  it("is counted in a dry run, which stores nothing and shows only what a live run would take", async () => {
    const channel = slackWorld();
    channel.person(1);
    const flow = await startWorkflow(storyOneSource());
    await flow.goLive();
    channel.person(2, "Checkout button does nothing");
    channel.appPost(3);

    const dry = await flow.run({ mode: "dry" });

    const step = stepOf(dry, "src");
    expect(step.fields).toMatchObject({
      sample: true,
      taken: 1,
      skippedOwn: 1,
      ingested: false,
    });
    expect(await flow.rows()).toEqual([]);
    // The live run after it still takes the report, once.
    const live = await flow.run();
    expect(stepOf(live, "src").fields).toMatchObject({
      taken: 1,
      skippedOwn: 1,
    });
  });
});

describe("a dry run before the workflow has ever been live", () => {
  it("shows the newest reports without the app's own posts, says it left them out, and stores nothing", async () => {
    const channel = slackWorld();
    channel.person(1, "Checkout button does nothing");
    channel.appPost(2);
    channel.person(3, "Pay button is dead");
    channel.appPost(4);
    const flow = await startWorkflow(storyOneSource());

    const dry = await flow.run({ mode: "dry" });

    const step = stepOf(dry, "src");
    expect(step.fields).toMatchObject({
      sample: true,
      wouldPrime: true,
      taken: 2,
      skippedOwn: 2,
    });
    expect(await flow.rows()).toEqual([]);
  });
});

describe("a Source that cannot learn who the app is", () => {
  it("fails with a typed error and takes nothing, then takes what it missed once the app can say", async () => {
    const channel = slackWorld();
    channel.person(1);
    const flow = await startWorkflow(storyOneSource());
    await flow.goLive();
    channel.person(2, "Checkout button does nothing");
    channel.appPost(3);
    channel.identity = { error: "invalid_auth" };
    newToken();
    const historyBefore = channel.historyCalls;
    const position = await flow.cursor();

    const failed = await flow.run();

    const step = stepOf(failed, "src");
    expect(step.status).toBe("failed");
    expect(step.error?.code).toBe("provider_error");
    expect(step.error?.message).toMatch(
      /^identity_unresolved: poll-slack-channel took nothing: .*invalid_auth/,
    );
    expect(failed.run.counts).toMatchObject({ taken: 0 });
    expect(await flow.rows()).toEqual([]);
    expect(channel.historyCalls).toBe(historyBefore);
    expect(await flow.cursor()).toBe(position);

    channel.identity = "ok";
    newToken();
    const recovered = await flow.run();
    expect(stepOf(recovered, "src").fields).toMatchObject({
      taken: 1,
      skippedOwn: 1,
    });
    expect(flow.handled()).toEqual([slackItemId(2)]);
  });
});

describe("a caller that does not ask to leave the app's own posts out", () => {
  it("reads as it always did: the notice is stored as a message, and the answer says nothing about it", async () => {
    const channel = slackWorld();
    channel.person(1);
    channel.appPost(2);
    const caller = createGuardedActionCaller({
      actions: registry,
      ownerEmail: OWNER,
      orgId: SCOPE.orgId,
      automation: {
        triggerId: "job-1",
        triggerName: `factories/${SCOPE.factoryId}/flow`,
      },
      runId: "run-legacy",
    });

    const result = await caller({
      name: "poll-slack-channel",
      input: { factoryId: SCOPE.factoryId },
      callId: "legacy",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("completed");
    const answer = JSON.parse(result.output);
    expect(answer).toMatchObject({ ok: true, observed: 2 });
    expect(answer).not.toHaveProperty("skippedOwn");
    expect(externalIds(await db.select().from(triageItems))).toEqual([
      `${CHANNEL}:${ts(1)}`,
      `${CHANNEL}:${ts(2)}`,
    ]);
  });
});

/** The entry at `index`, or a loud failure: a test reads what it expects to be there. */
function nth<T>(list: readonly T[], index: number): T {
  const found = list.find((_, at) => at === index);
  if (found === undefined) throw new Error(`There is no entry ${index}.`);
  return found;
}
