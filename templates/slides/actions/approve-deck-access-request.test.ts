import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  defineAction: vi.fn((options: unknown) => options),
  getRequestUserEmail: vi.fn(),
  getRequestOrgId: vi.fn(),
  resolveAccess: vi.fn(),
  verifyScopedAgentAccessToken: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => mocks.defineAction(options),
}));

vi.mock("@agent-native/core/server", () => ({
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mocks.verifyScopedAgentAccessToken(...args),
}));

vi.mock("@agent-native/core/server/poll", () => ({
  invalidateCollabAccessCache: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: (...args: unknown[]) =>
    mocks.getRequestUserEmail(...args),
  getRequestOrgId: (...args: unknown[]) => mocks.getRequestOrgId(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      visibility: "decks.visibility",
    },
    deckEvents: {
      deckId: "deck_events.deck_id",
      type: "deck_events.type",
      payload: "deck_events.payload",
    },
    deckShares: {
      id: "deck_shares.id",
      resourceId: "deck_shares.resource_id",
      principalType: "deck_shares.principal_type",
      principalId: "deck_shares.principal_id",
      role: "deck_shares.role",
      createdBy: "deck_shares.created_by",
      createdAt: "deck_shares.created_at",
    },
  },
}));

import approveDeckAccessRequest from "./approve-deck-access-request.js";

function createDb(
  deckRows: unknown[],
  requestRows: unknown[],
  shareRows: unknown[],
  insertConflict = false,
) {
  const rowsBySelect = [deckRows, requestRows, shareRows];
  let selectIndex = 0;
  const db = {
    select: vi.fn(() => {
      const rows = rowsBySelect[selectIndex++] ?? [];
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => rows),
        then: (
          resolve: (value: unknown[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((row: { id: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => (insertConflict ? [] : [{ id: row.id }]),
        }),
      })),
    })),
  };
  return db;
}

function privateDeck() {
  return {
    id: "deck-1",
    title: "Private demo",
    visibility: "private",
  };
}

function accessRequest() {
  return {
    payload: JSON.stringify({ requesterEmail: "VIEWER@example.com" }),
  };
}

describe("approve-deck-access-request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("OWNER@example.com");
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.resolveAccess.mockResolvedValue({ role: "owner", resource: {} });
    mocks.verifyScopedAgentAccessToken.mockReturnValue({
      ok: true,
      viewerEmail: "viewer@example.com",
    });
  });

  it("adds the requester as a normalized viewer in the deck share table", async () => {
    const db = createDb([privateDeck()], [accessRequest()], []);
    mocks.getDb.mockReturnValue(db);

    await expect(
      (approveDeckAccessRequest as any).run({
        deckId: "deck-1",
        approvalToken: "approval-token",
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyAllowed: false,
      requesterEmail: "viewer@example.com",
      shareId: expect.stringMatching(/^deck-share-[a-f0-9]{64}$/),
    });

    expect(mocks.resolveAccess).toHaveBeenCalledWith("deck", "deck-1", {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it("is idempotent when the requester is already shared", async () => {
    const db = createDb(
      [privateDeck()],
      [accessRequest()],
      [{ id: "existing-share" }],
    );
    mocks.getDb.mockReturnValue(db);

    await expect(
      (approveDeckAccessRequest as any).run({
        deckId: "deck-1",
        approvalToken: "approval-token",
      }),
    ).resolves.toMatchObject({
      ok: true,
      alreadyAllowed: true,
      shareId: "existing-share",
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects invalid tokens before reading the deck", async () => {
    const db = createDb([privateDeck()], [accessRequest()], []);
    mocks.getDb.mockReturnValue(db);
    mocks.verifyScopedAgentAccessToken.mockReturnValue({ ok: false });

    await expect(
      (approveDeckAccessRequest as any).run({
        deckId: "deck-1",
        approvalToken: "expired-token",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
  });

  it("does not let a viewer use the approval link", async () => {
    const db = createDb([privateDeck()], [accessRequest()], []);
    mocks.getDb.mockReturnValue(db);
    mocks.resolveAccess.mockResolvedValue({ role: "viewer", resource: {} });

    await expect(
      (approveDeckAccessRequest as any).run({
        deckId: "deck-1",
        approvalToken: "approval-token",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects approval after a private deck becomes organization-visible", async () => {
    const db = createDb(
      [{ ...privateDeck(), visibility: "org" }],
      [accessRequest()],
      [],
    );
    mocks.getDb.mockReturnValue(db);

    await expect(
      (approveDeckAccessRequest as any).run({
        deckId: "deck-1",
        approvalToken: "approval-token",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
