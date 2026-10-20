import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

import { triageItems } from "../db/schema.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import { mergeTriageMetadata } from "../triage/metadata.js";
import { createSlackReader } from "../triage/slack-client.js";
import { pollSlackChannel } from "../triage/slack-poller.js";
import type { WorkflowScope } from "../workflow/adapter.js";
import { createInboxHost } from "./inbox.js";

vi.mock("../triage/slack-client.js", () => ({
  createSlackReader: vi.fn(),
}));

// What the poller records about a message's reactions, read back by the Source
// node's claim reaction: a person reacting claims a report, a bot never does.

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "factory-1" };
const OWN_BOT = "UAGENTNATIVE";
const OTHER_BOT = "UOTHERBOT";
const PERSON = "UPERSON";
const NOW = "2026-10-18T10:00:00.000Z";

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

let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  db = drizzle(await emptyClient());
  const reader = {
    getChannelHistory: vi.fn(),
    getTeamInfo: vi
      .fn()
      .mockResolvedValue({ id: "T1", name: "Builder", domain: "builder" }),
    getUserInfo: vi.fn(async (_workspace: string, userId: string) => ({
      id: userId,
      name: null,
      displayName: null,
      isBot: userId === OTHER_BOT,
    })),
    getAgentNativeIdentity: vi.fn().mockResolvedValue({
      userId: OWN_BOT,
      userName: "agent-native",
      teamId: "T1",
      teamName: "Builder",
    }),
  };
  vi.mocked(createSlackReader).mockReturnValue(reader as never);
  history = reader.getChannelHistory;
});

let history: ReturnType<typeof vi.fn>;

/** Polls a channel whose messages carry these reactions, stores what the poller found, and asks the Source node what it takes. */
async function takenAfterPolling(
  messages: Array<{
    ts: string;
    reactions?: Array<{ name: string; count: number; users: string[] }>;
  }>,
  claimReaction: string | undefined,
) {
  history.mockResolvedValue({
    messages: messages.map((message) => ({
      type: "message",
      user: "UAUTHOR",
      text: `report ${message.ts}`,
      ...message,
    })),
    has_more: false,
  });
  const polled = await pollSlackChannel({
    workspace: "primary",
    channelId: "C1",
    priorLastSlackTs: "1.0",
    ownerEmail: "owner@example.test",
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
      ownerEmail: "owner@example.test",
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
  const taken = await host.take({
    settings: {
      source: "inbox-poll",
      poller: "slack",
      takeLimit: 10,
      ...(claimReaction === undefined ? {} : { filter: { claimReaction } }),
    },
    mode: "live",
    signal: new AbortController().signal,
  });
  if (!taken.ok) throw new Error(taken.message);
  return taken.items.map((item) => item.externalId).sort();
}

describe("the claim reaction, from the poller to the Source node", () => {
  it("takes a message nobody reacted to", async () => {
    expect(await takenAfterPolling([{ ts: "20.1" }], "eyes")).toEqual([
      "C1:20.1",
    ]);
  });

  it("skips a message a person reacted to with the configured reaction", async () => {
    expect(
      await takenAfterPolling(
        [
          { ts: "20.1" },
          {
            ts: "20.2",
            reactions: [{ name: "eyes", count: 1, users: [PERSON] }],
          },
        ],
        "eyes",
      ),
    ).toEqual(["C1:20.1"]);
  });

  it("takes a message only a bot reacted to, the workspace's own or another's", async () => {
    expect(
      await takenAfterPolling(
        [
          {
            ts: "20.1",
            reactions: [{ name: "eyes", count: 1, users: [OWN_BOT] }],
          },
          {
            ts: "20.2",
            reactions: [{ name: "eyes", count: 1, users: [OTHER_BOT] }],
          },
          {
            ts: "20.3",
            reactions: [{ name: "eyes", count: 2, users: [OTHER_BOT, PERSON] }],
          },
        ],
        "eyes",
      ),
    ).toEqual(["C1:20.1", "C1:20.2"]);
  });

  it("takes everything when the node names no claim reaction", async () => {
    expect(
      await takenAfterPolling(
        [
          {
            ts: "20.1",
            reactions: [{ name: "eyes", count: 1, users: [PERSON] }],
          },
        ],
        undefined,
      ),
    ).toEqual(["C1:20.1"]);
  });
});
