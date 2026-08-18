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
  insertedRows: [] as Record<string, unknown>[],
}));

const limitSelect = vi.hoisted(() =>
  vi.fn(async () => (state.deck ? [state.deck] : [])),
);
const insertValues = vi.hoisted(() =>
  vi.fn(async (row: Record<string, unknown>) => {
    state.insertedRows.push(row);
  }),
);
const db = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: limitSelect })),
    })),
  })),
  insert: vi.fn(() => ({ values: insertValues })),
}));

const sendEmail = vi.hoisted(() => vi.fn(async () => undefined));
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

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => state.requesterEmail,
  getRequestUserName: () => state.requesterName,
}));

vi.mock("@agent-native/core/sharing", () => ({
  currentAccess: () => ({ userEmail: state.requesterEmail }),
  resolveAccess: vi.fn(async () => state.access),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

vi.mock("nanoid", () => ({ nanoid: () => "abc123" }));

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
  state.insertedRows = [];
});

describe("request-deck-access", () => {
  it("records a request and notifies the owner", async () => {
    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      notifiedOwner: true,
      requestId: "req-abc123",
    });
    expect(state.insertedRows).toHaveLength(1);
    expect(state.insertedRows[0]).toMatchObject({
      id: "req-abc123",
      deckId: "deck-1",
      type: "deck.access_requested",
      createdBy: "human",
    });
    expect(JSON.parse(state.insertedRows[0].payload as string)).toMatchObject({
      requestId: "req-abc123",
      requesterEmail: "requester@example.com",
      requesterName: "Requester",
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        subject: expect.stringContaining("requested access"),
      }),
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

  it("keeps the durable request when owner email delivery fails", async () => {
    sendEmail.mockRejectedValueOnce(new Error("SMTP unavailable"));

    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      notifiedOwner: false,
      requestId: "req-abc123",
    });
    expect(state.insertedRows).toHaveLength(1);
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
