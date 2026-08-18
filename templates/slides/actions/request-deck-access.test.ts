import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requesterEmail: "requester@example.com" as string | null,
  requesterName: "Requester" as string | null,
  deck: {
    id: "deck-1",
    title: "Quarterly Review",
    ownerEmail: "owner@example.com",
  } as { id: string; title: string; ownerEmail: string | null } | undefined,
  access: null as { role?: string } | null,
  emailConfigured: true,
  inAppNotification: true,
  insertConflict: false,
  previousRequests: [] as { id: string; payload: string | null }[],
  insertedRows: [] as Record<string, unknown>[],
  updatedPayload: null as string | null,
}));

const limitSelect = vi.hoisted(() =>
  vi.fn(async () => (state.deck ? [state.deck] : [])),
);
const insertValues = vi.hoisted(() =>
  vi.fn((row: Record<string, unknown>) => {
    state.insertedRows.push(row);
    return {
      onConflictDoNothing: () => ({
        returning: async () =>
          state.insertConflict ? [] : [{ id: row.id as string }],
      }),
    };
  }),
);
const updateWhere = vi.hoisted(() => vi.fn(async () => undefined));
const updateSet = vi.hoisted(() =>
  vi.fn((values: Record<string, unknown>) => {
    state.updatedPayload = values.payload as string;
    return { where: updateWhere };
  }),
);
const db = vi.hoisted(() => ({
  select: vi.fn((selection: Record<string, unknown>) => ({
    from: vi.fn(() => ({
      where: vi.fn(() =>
        selection.payload
          ? Promise.resolve(state.previousRequests)
          : { limit: limitSelect },
      ),
    })),
  })),
  insert: vi.fn(() => ({ values: insertValues })),
  update: vi.fn(() => ({ set: updateSet })),
}));

const sendEmail = vi.hoisted(() => vi.fn(async () => undefined));
const notify = vi.hoisted(() =>
  vi.fn(async () =>
    state.inAppNotification ? { id: "notification-1" } : undefined,
  ),
);
const renderEmail = vi.hoisted(() =>
  vi.fn(() => ({ html: "<p>request</p>", text: "request" })),
);

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      ownerEmail: "decks.owner_email",
    },
    deckEvents: {
      id: "deck_events.id",
      deckId: "deck_events.deck_id",
      type: "deck_events.type",
      message: "deck_events.message",
      payload: "deck_events.payload",
      createdBy: "deck_events.created_by",
      createdAt: "deck_events.created_at",
    },
  },
}));

vi.mock("@agent-native/core/server", () => ({
  emailStrong: (value: string) => value,
  isEmailConfigured: () => Promise.resolve(state.emailConfigured),
  renderEmail,
  sendEmail,
}));

vi.mock("@agent-native/core/notifications", () => ({ notify }));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => state.requesterEmail,
  getRequestUserName: () => state.requesterName,
}));

vi.mock("@agent-native/core/sharing", () => ({
  currentAccess: () => ({ userEmail: state.requesterEmail }),
  resolveAccess: vi.fn(async () => state.access),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

vi.mock("./_app-url.js", () => ({
  getDeckUrl: (deckId: string) => `https://slides.example/deck/${deckId}`,
}));

import action from "./request-deck-access";

beforeEach(() => {
  vi.clearAllMocks();
  state.requesterEmail = "requester@example.com";
  state.requesterName = "Requester";
  state.deck = {
    id: "deck-1",
    title: "Quarterly Review",
    ownerEmail: "owner@example.com",
  };
  state.access = null;
  state.emailConfigured = true;
  state.inAppNotification = true;
  state.insertConflict = false;
  state.previousRequests = [];
  state.insertedRows = [];
  state.updatedPayload = null;
});

describe("request-deck-access", () => {
  it("records a request and notifies the owner", async () => {
    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      notifiedOwner: true,
      requestId: expect.stringMatching(/^access-request-[a-f0-9]{64}$/),
    });
    expect(state.insertedRows).toHaveLength(1);
    expect(state.insertedRows[0]).toMatchObject({
      id: expect.stringMatching(/^access-request-[a-f0-9]{64}$/),
      deckId: "deck-1",
      type: "deck.access_requested",
      createdBy: "human",
    });
    expect(JSON.parse(state.insertedRows[0].payload as string)).toMatchObject({
      requestId: expect.stringMatching(/^access-request-[a-f0-9]{64}$/),
      requesterEmail: "requester@example.com",
      requesterName: "Requester",
      notifiedOwner: false,
    });
    expect(JSON.parse(state.updatedPayload as string)).toMatchObject({
      notifiedOwner: true,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        subject: expect.stringContaining("requested access"),
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Deck access requested",
        metadata: expect.objectContaining({ deckId: "deck-1" }),
      }),
      { owner: "owner@example.com" },
    );
    expect(renderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        cta: {
          label: "Open deck",
          url: "https://slides.example/deck/deck-1",
        },
      }),
    );
  });

  it("preserves the owner email casing used by notification reads", async () => {
    state.deck = {
      id: "deck-1",
      title: "Quarterly Review",
      ownerEmail: "Owner@Example.com",
    };

    await action.run({ deckId: "deck-1" });

    expect(notify).toHaveBeenCalledWith(expect.anything(), {
      owner: "Owner@Example.com",
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "Owner@Example.com" }),
    );
  });

  it("keeps the durable request and in-app notice when owner email fails", async () => {
    sendEmail.mockRejectedValueOnce(new Error("SMTP unavailable"));

    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      notifiedOwner: true,
      requestId: expect.stringMatching(/^access-request-[a-f0-9]{64}$/),
    });
    expect(state.insertedRows).toHaveLength(1);
  });

  it("retries owner notification after a previous attempt failed", async () => {
    state.inAppNotification = false;
    sendEmail.mockRejectedValueOnce(new Error("SMTP unavailable"));

    const firstResult = await action.run({ deckId: "deck-1" });
    const requestId = firstResult.requestId as string;
    expect(firstResult).toMatchObject({ notifiedOwner: false, requestId });

    state.previousRequests = [
      {
        id: requestId,
        payload: state.insertedRows[0].payload as string,
      },
    ];
    state.inAppNotification = true;

    await expect(action.run({ deckId: "deck-1" })).resolves.toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: true,
      notifiedOwner: true,
      requestId,
      message: "Access request sent to the deck owner.",
    });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(state.updatedPayload).toBeTruthy();
    expect(JSON.parse(state.updatedPayload as string)).toMatchObject({
      notifiedOwner: true,
    });
  });

  it("does not duplicate a request already recorded for this requester", async () => {
    state.previousRequests = [
      {
        id: "access-request-existing",
        payload: JSON.stringify({
          requesterEmail: "REQUESTER@example.com",
          notifiedOwner: true,
        }),
      },
    ];

    await expect(action.run({ deckId: "deck-1" })).resolves.toEqual({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: true,
      notifiedOwner: true,
      requestId: "access-request-existing",
      message: "Your access request is already with the deck owner.",
    });
    expect(state.insertedRows).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not notify twice when concurrent requests collide", async () => {
    state.insertConflict = true;

    await expect(action.run({ deckId: "deck-1" })).resolves.toEqual({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: true,
      notifiedOwner: false,
      message: "Your access request is already with the deck owner.",
    });
    expect(notify).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not create a request for a viewer who already has access", async () => {
    state.access = { role: "viewer" };

    await expect(action.run({ deckId: "deck-1" })).resolves.toEqual({
      ok: true,
      alreadyHasAccess: true,
      notifiedOwner: false,
      message: "You already have access. Refreshing the deck...",
    });
    expect(state.insertedRows).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("requires a signed-in requester", async () => {
    state.requesterEmail = null;

    await expect(action.run({ deckId: "deck-1" })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(state.insertedRows).toHaveLength(0);
  });
});
