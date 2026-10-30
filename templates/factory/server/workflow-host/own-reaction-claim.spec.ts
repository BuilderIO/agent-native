import { createRequire } from "node:module";

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

const fetchMock = vi.hoisted(() => vi.fn());
const secretMock = vi.hoisted(() => vi.fn());

vi.mock("../connectors/credentials.js", () => ({
  resolveConnectorSecret: secretMock,
}));
vi.mock("../db/index.js", () => ({ getDb: () => ({}) }));

import {
  addWorkflowSlackReaction,
  readWorkflowSlackThread,
} from "../connectors/slack-workflow.js";
import { triageItems } from "../db/schema.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import { mergeTriageMetadata } from "../triage/metadata.js";
import { createSlackWorkflowClient } from "../triage/slack-client.js";
import { pollSlackChannel } from "../triage/slack-poller.js";
import type { WorkflowScope } from "../workflow/adapter.js";
import { createInboxHost } from "./inbox.js";
import { createThreadReader } from "./thread-reader.js";

// The loop reacts to a message with `slack.addReaction`, and a Source that skips
// a message "a person claimed" and a reply Wait that takes a reaction as an
// answer both read reactions back. These run the real writer, a fake Slack that
// attributes each reaction to whoever's token made it, and each reader: the
// loop's own reaction must never be taken for a person's.

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "factory-1" };
const BOT = "UBOT";
const PERSON = "UPERSON";
const OTHER_BOT = "UOTHERBOT";
const NOW = "2026-10-18T10:00:00.000Z";
const CHANNEL = "C0123ABCD";
const REPORT = "1790000001.000000";
const CLAIMED = "1790000002.000000";

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
    "TRUNCATE factory_items, factory_workflow_item_state",
  );
  return sharedClient;
}

afterAll(async () => {
  await sharedClient?.close();
  sharedClient = undefined;
});

/** What Slack holds: each message's reactions as `[emoji, who]`. */
let reactions: Map<string, Array<[string, string]>>;
let tokens = 0;

const json = (value: unknown) => new Response(JSON.stringify(value));

/** A Slack that answers as its API does, and records a reaction against the token owner's id. */
function fakeSlack() {
  fetchMock.mockImplementation(
    async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const method = url.pathname.replace("/api/", "");
      if (method === "auth.test") {
        return json({
          ok: true,
          user_id: BOT,
          user: "agent-native",
          team_id: "T1",
          team: "Builder",
        });
      }
      if (method === "reactions.add") {
        const body = JSON.parse(String(init?.body)) as {
          timestamp: string;
          name: string;
        };
        const held = reactions.get(body.timestamp) ?? [];
        if (held.some(([name, who]) => name === body.name && who === BOT)) {
          return json({ ok: false, error: "already_reacted" });
        }
        reactions.set(body.timestamp, [...held, [body.name, BOT]]);
        return json({ ok: true });
      }
      if (method === "team.info") {
        return json({
          ok: true,
          team: { id: "T1", name: "Builder", domain: "builder" },
        });
      }
      if (method === "users.info") {
        const user = url.searchParams.get("user");
        // The bot's own profile is deliberately not flagged as a bot, so only
        // the rule about its own id keeps its reaction out of a claim.
        return json({
          ok: true,
          user: { id: user, name: user, is_bot: user === OTHER_BOT },
        });
      }
      if (method === "conversations.history") {
        return json({
          ok: true,
          has_more: false,
          messages: [REPORT, CLAIMED].map((ts) => message(ts)),
        });
      }
      if (method === "conversations.replies") {
        return json({
          ok: true,
          has_more: false,
          messages: [message(url.searchParams.get("ts") ?? REPORT)],
        });
      }
      throw new Error(`unplanned ${method}`);
    },
  );
}

function message(ts: string) {
  const held = reactions.get(ts) ?? [];
  const names = [...new Set(held.map(([name]) => name))];
  return {
    type: "message",
    user: "UAUTHOR",
    text: `report ${ts}`,
    ts,
    ...(names.length === 0
      ? {}
      : {
          reactions: names.map((name) => {
            const users = held
              .filter(([emoji]) => emoji === name)
              .map(([, who]) => who);
            return { name, count: users.length, users };
          }),
        }),
  };
}

const identity = { ownerEmail: "owner@example.test", orgId: "org-1" };
const loop = () => createSlackWorkflowClient(identity);

/** The loop puts a reaction on a message, the way the `slack.addReaction` step does. */
const loopReacts = (name: string, ts = REPORT) =>
  addWorkflowSlackReaction(loop(), {
    workspace: "primary",
    channel: CHANNEL,
    ts,
    name,
  });

beforeEach(() => {
  reactions = new Map();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // A token of its own per test: Slack reads are cached by token.
  tokens += 1;
  secretMock.mockReset().mockResolvedValue(`slack-test-token-${tokens}`);
  fakeSlack();
});

afterEach(() => vi.unstubAllGlobals());

describe("a Source that skips messages a person claimed with a reaction", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    db = drizzle(await emptyClient());
  });

  /** Polls the channel, stores what the poller found, and asks the Source node what it takes. */
  async function taken(claimReaction: string) {
    const polled = await pollSlackChannel({
      workspace: "primary",
      channelId: CHANNEL,
      priorLastSlackTs: "1.0",
      ownerEmail: identity.ownerEmail,
      orgId: identity.orgId,
    });
    for (const envelope of polled.envelopes) {
      await db.insert(triageItems).values({
        id: envelope.externalId,
        source: "slack",
        externalId: envelope.externalId,
        title: envelope.title,
        status: "received",
        coverage: envelope.coverage,
        channelId: envelope.channelId ?? null,
        threadTs: envelope.threadTs ?? null,
        dedupeKey: envelope.externalId,
        metadataJson: mergeTriageMetadata("{}", envelope.metadata ?? {}),
        createdAt: NOW,
        updatedAt: NOW,
        ownerEmail: identity.ownerEmail,
        orgId: SCOPE.orgId,
        factoryId: SCOPE.factoryId,
      });
    }
    const host = createInboxHost({
      scope: SCOPE,
      workflowId: "wf-1",
      getDatabase: () => db,
      callAction: async () => ({
        status: "completed",
        output: JSON.stringify({ ok: true, observed: polled.envelopes.length }),
      }),
      clock: () => new Date(NOW),
    });
    const result = await host.take({
      settings: {
        source: "inbox-poll",
        poller: "slack",
        takeLimit: 10,
        filter: { claimReaction },
      },
      mode: "live",
      signal: new AbortController().signal,
    });
    if (!result.ok) throw new Error(result.message);
    return result.items.map((item) => item.externalId).sort();
  }

  it("still takes a message the loop itself reacted to with the claim reaction", async () => {
    await loopReacts("eyes");

    expect(await taken("eyes")).toEqual([
      `${CHANNEL}:${REPORT}`,
      `${CHANNEL}:${CLAIMED}`,
    ]);
  });

  it("skips a message a person reacted to, so the test above is not passing because nothing is ever skipped", async () => {
    reactions.set(CLAIMED, [["eyes", PERSON]]);
    await loopReacts("eyes");

    expect(await taken("eyes")).toEqual([`${CHANNEL}:${REPORT}`]);
  });

  it("skips a message a person claimed after the loop reacted to it too", async () => {
    await loopReacts("eyes");
    reactions.set(REPORT, [...(reactions.get(REPORT) ?? []), ["eyes", PERSON]]);

    expect(await taken("eyes")).toEqual([`${CHANNEL}:${CLAIMED}`]);
  });

  it("takes a message another bot reacted to as well", async () => {
    reactions.set(CLAIMED, [["eyes", OTHER_BOT]]);

    expect(await taken("eyes")).toEqual([
      `${CHANNEL}:${REPORT}`,
      `${CHANNEL}:${CLAIMED}`,
    ]);
  });
});

describe("reading a thread the loop reacted to", () => {
  const read = () =>
    readWorkflowSlackThread(loop(), {
      workspace: "primary",
      channel: CHANNEL,
      threadTs: REPORT,
    });

  it("lists the loop's reaction as its own, and not among the reactions a person made", async () => {
    await loopReacts("eyes");

    const thread = await read();

    expect(thread.messages[0]?.reactions).toEqual([]);
    expect(thread.messages[0]?.ownReactions).toEqual(["eyes"]);
  });

  it("still shows the people who made the same reaction", async () => {
    await loopReacts("eyes");
    reactions.set(REPORT, [...(reactions.get(REPORT) ?? []), ["eyes", PERSON]]);

    const thread = await read();

    expect(thread.messages[0]?.reactions).toEqual([
      { name: "eyes", count: 1, users: [PERSON] },
    ]);
    expect(thread.messages[0]?.ownReactions).toEqual(["eyes"]);
  });
});

describe("a reply Wait that takes a reaction as the answer", () => {
  // The wait began at the message's own time: its reactions count from then
  // on, and the message itself is not a reply.
  const SINCE = new Date(1_790_000_001_000).toISOString();

  function waitReader() {
    return createThreadReader({
      factoryId: SCOPE.factoryId,
      lookupMember: async () => ({ found: false, reason: "no_such_member" }),
      clock: { now: () => new Date(NOW), sleep: async () => undefined },
      log: () => undefined,
      callAction: async (call) => {
        const input = call.input as { channel: string; threadTs: string };
        const thread = await readWorkflowSlackThread(loop(), {
          workspace: "primary",
          channel: input.channel,
          threadTs: input.threadTs,
        });
        return {
          status: "completed",
          output: JSON.stringify({ ok: true, coverage: "complete", ...thread }),
        };
      },
    });
  }

  const replies = async (ackReaction: string) => {
    const result = await waitReader().readReplies({
      thread: { channelId: CHANNEL, threadTs: REPORT },
      since: SINCE,
      acceptFrom: "anyone",
      ackReaction,
      ownerEmail: identity.ownerEmail,
      signal: new AbortController().signal,
    });
    if (!result.ok) throw new Error(result.message);
    return result.replies;
  };

  it.each(["eyes", "white_check_mark"])(
    "does not take the loop's own %s as the answer, whatever emoji it chose",
    async (name) => {
      await loopReacts(name);

      expect(await replies(name)).toEqual([]);
    },
  );

  it("takes the same reaction from a person as the answer, so the check above can fail", async () => {
    await loopReacts("white_check_mark");
    reactions.set(REPORT, [
      ...(reactions.get(REPORT) ?? []),
      ["white_check_mark", PERSON],
    ]);

    expect(await replies("white_check_mark")).toEqual([
      expect.objectContaining({ kind: "reaction", author: PERSON }),
    ]);
  });
});
