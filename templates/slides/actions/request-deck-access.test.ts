import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requesterEmail: "requester@example.com" as string | null,
  requesterName: "Requester" as string | null,
  deck: {
    id: "deck-1",
    title: "Quarterly Review",
    ownerEmail: "owner@example.com",
    visibility: "private" as "private" | "org" | "public",
  } as
    | {
        id: string;
        title: string;
        ownerEmail: string | null;
        visibility: "private" | "org" | "public";
      }
    | undefined,
  access: null as { role?: string } | null,
  emailConfigured: true,
  inAppNotification: true,
  emailNotification: true,
  insertConflict: false,
  updateConflict: false,
  previousRequests: [] as { id: string; payload: string | null }[],
  insertedRows: [] as Record<string, unknown>[],
  updatedPayload: null as string | null,
  rateLimitCount: 0,
}));

const limitSelect = vi.hoisted(() =>
  vi.fn(async () => (state.deck ? [state.deck] : [])),
);
const insertValues = vi.hoisted(() =>
  vi.fn((row: Record<string, unknown>) => {
    if ("requestCount" in row) {
      return {
        onConflictDoUpdate: () => ({
          returning: async () => {
            if (state.rateLimitCount >= 5) return [];
            state.rateLimitCount += 1;
            return [{ requestCount: state.rateLimitCount }];
          },
        }),
      };
    }
    state.insertedRows.push(row);
    return {
      onConflictDoNothing: () => ({
        returning: async () =>
          state.insertConflict ? [] : [{ id: row.id as string }],
      }),
    };
  }),
);
const updateSet = vi.hoisted(() =>
  vi.fn((values: Record<string, unknown>) => {
    return {
      where: vi.fn((conditions: unknown) => ({
        returning: async () => {
          if (state.updateConflict) return [];
          const conditionList = Array.isArray(conditions)
            ? conditions
            : [conditions];
          const idCondition = conditionList.find(
            (condition) =>
              (condition as { column?: unknown }).column === "deck_events.id",
          ) as { value?: unknown } | undefined;
          const payloadCondition = conditionList.find(
            (condition) =>
              (condition as { column?: unknown }).column ===
              "deck_events.payload",
          ) as { value?: unknown } | undefined;
          const id = idCondition?.value;
          const payload = payloadCondition?.value;
          const row = [...state.previousRequests, ...state.insertedRows].find(
            (candidate) =>
              candidate.id === id &&
              (payloadCondition === undefined || candidate.payload === payload),
          );
          if (!row) return [];
          if (state.previousRequests.includes(row)) {
            row.payload = values.payload;
          }
          state.updatedPayload = values.payload as string;
          return [{ id }];
        },
      })),
    };
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

const notifyWithDelivery = vi.hoisted(() =>
  vi.fn(async (input: { channels?: string[] }) => {
    const deliveredChannels = (input.channels ?? []).filter((channel) =>
      channel === "inbox"
        ? state.inAppNotification
        : channel === "email"
          ? state.emailNotification
          : false,
    );
    return {
      notification: deliveredChannels.includes("inbox")
        ? { id: "notification-1" }
        : undefined,
      deliveredChannels,
    };
  }),
);
const sendEmail = vi.hoisted(() =>
  vi.fn(async () => {
    if (!state.emailNotification) throw new Error("email failed");
  }),
);
const signScopedAgentAccessToken = vi.hoisted(() =>
  vi.fn(() => "approval-token"),
);
const verifyScopedAgentAccessToken = vi.hoisted(() =>
  vi.fn(() => ({ ok: true as const, viewerEmail: undefined })),
);

vi.mock("../server/db/index.js", () => ({
  getDb: () => db,
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      ownerEmail: "decks.owner_email",
      visibility: "decks.visibility",
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
    deckAccessRequestLimits: {
      deckId: "deck_access_request_limits.deck_id",
      windowStartedAt: "deck_access_request_limits.window_started_at",
      requestCount: "deck_access_request_limits.request_count",
    },
  },
}));

vi.mock("@agent-native/core/server", () => ({
  isEmailConfigured: () => Promise.resolve(state.emailConfigured),
  emailStrong: (value: string) => `<strong>${value}</strong>`,
  renderEmail: () => ({ html: "<html />", text: "email" }),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  signScopedAgentAccessToken: (...args: unknown[]) =>
    signScopedAgentAccessToken(...args),
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    verifyScopedAgentAccessToken(...args),
}));

vi.mock("@agent-native/core/notifications", () => ({ notifyWithDelivery }));

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
  getSlidesAppUrl: () => "https://slides.example",
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
    visibility: "private",
  };
  state.access = null;
  state.emailConfigured = true;
  state.inAppNotification = true;
  state.emailNotification = true;
  state.insertConflict = false;
  state.updateConflict = false;
  state.previousRequests = [];
  state.insertedRows = [];
  state.updatedPayload = null;
  state.rateLimitCount = 0;
});

afterEach(() => {
  vi.useRealTimers();
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
      inAppNotified: false,
      emailNotified: false,
    });
    expect(JSON.parse(state.updatedPayload as string)).toMatchObject({
      notifiedOwner: true,
      inAppNotified: true,
      emailNotified: true,
    });
    expect(notifyWithDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Deck access requested",
        channels: ["inbox"],
        metadata: expect.objectContaining({
          deckId: "deck-1",
        }),
      }),
      { owner: "owner@example.com" },
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        replyTo: "requester@example.com",
        templateId: "slides.deck-access-request",
      }),
    );
  });

  it("preserves the owner email casing used by notification reads", async () => {
    state.deck = {
      id: "deck-1",
      title: "Quarterly Review",
      ownerEmail: "Owner@Example.com",
      visibility: "private",
    };

    await action.run({ deckId: "deck-1" });

    expect(notifyWithDelivery).toHaveBeenCalledWith(expect.anything(), {
      owner: "Owner@Example.com",
    });
    expect(notifyWithDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ deckId: "deck-1" }),
      }),
      { owner: "Owner@Example.com" },
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "Owner@Example.com" }),
    );
  });

  it("keeps the durable request and in-app notice when owner email fails", async () => {
    state.emailNotification = false;

    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      notifiedOwner: true,
      requestId: expect.stringMatching(/^access-request-[a-f0-9]{64}$/),
    });
    expect(state.insertedRows).toHaveLength(1);
    expect(JSON.parse(state.updatedPayload as string)).toMatchObject({
      inAppNotified: true,
      emailNotified: false,
      notifiedOwner: true,
    });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("does not record access requests for non-private decks", async () => {
    state.deck = {
      id: "deck-1",
      title: "Quarterly Review",
      ownerEmail: "owner@example.com",
      visibility: "org",
    };

    await expect(action.run({ deckId: "deck-1" })).resolves.toEqual({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: false,
      notifiedOwner: false,
      message: "Access requests are only available for private decks.",
    });
    expect(state.insertedRows).toHaveLength(0);
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("retries only the notification channel that failed", async () => {
    state.emailNotification = false;

    const firstResult = await action.run({ deckId: "deck-1" });
    const requestId = firstResult.requestId as string;
    expect(firstResult).toMatchObject({ notifiedOwner: true, requestId });

    state.previousRequests = [
      {
        id: requestId,
        payload: state.updatedPayload as string,
      },
    ];
    state.emailNotification = true;

    await expect(action.run({ deckId: "deck-1" })).resolves.toMatchObject({
      alreadyRequested: true,
      notifiedOwner: true,
      requestId,
    });
    expect(notifyWithDelivery).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("retries owner notification after a previous attempt failed", async () => {
    state.inAppNotification = false;
    state.emailNotification = false;

    const firstResult = await action.run({ deckId: "deck-1" });
    const requestId = firstResult.requestId as string;
    expect(firstResult).toMatchObject({ notifiedOwner: false, requestId });

    state.previousRequests = [
      {
        id: requestId,
        payload: state.updatedPayload as string,
      },
    ];
    state.inAppNotification = true;
    state.emailNotification = true;

    await expect(action.run({ deckId: "deck-1" })).resolves.toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: true,
      notifiedOwner: true,
      requestId,
      message: "Access request sent to the deck owner.",
    });
    expect(notifyWithDelivery).toHaveBeenCalledTimes(2);
    expect(state.updatedPayload).toBeTruthy();
    expect(JSON.parse(state.updatedPayload as string)).toMatchObject({
      notifiedOwner: true,
      inAppNotified: true,
      emailNotified: true,
    });
  });

  it("does not send a concurrent retry after another request claims delivery", async () => {
    state.previousRequests = [
      {
        id: "access-request-existing",
        payload: JSON.stringify({
          requesterEmail: "REQUESTER@example.com",
          inAppNotified: false,
          emailNotified: false,
          notifiedOwner: false,
        }),
      },
    ];
    state.updateConflict = true;

    await expect(action.run({ deckId: "deck-1" })).resolves.toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      alreadyRequested: true,
      notifiedOwner: false,
      requestId: "access-request-existing",
    });
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("renews a notification claim while delivery is still in flight", async () => {
    vi.useFakeTimers();
    let resolveDelivery!: (value: {
      notification: { id: string };
      deliveredChannels: string[];
    }) => void;
    const pendingDelivery = new Promise<{
      notification: { id: string };
      deliveredChannels: string[];
    }>((resolve) => {
      resolveDelivery = resolve;
    });
    notifyWithDelivery.mockImplementationOnce(() => pendingDelivery);
    const requestId = "access-request-existing";
    state.previousRequests = [
      {
        id: requestId,
        payload: JSON.stringify({
          requesterEmail: "REQUESTER@example.com",
          inAppNotified: false,
          emailNotified: false,
          notifiedOwner: false,
        }),
      },
    ];

    const firstRequest = action.run({ deckId: "deck-1" });
    await vi.waitFor(() => expect(notifyWithDelivery).toHaveBeenCalledOnce());
    const firstClaim = JSON.parse(state.previousRequests[0].payload as string);

    await vi.advanceTimersByTimeAsync(6 * 60_000);

    const renewedClaim = JSON.parse(
      state.previousRequests[0].payload as string,
    );
    expect(renewedClaim.notificationClaimToken).toBe(
      firstClaim.notificationClaimToken,
    );
    expect(Date.parse(renewedClaim.notificationClaimedAt)).toBeGreaterThan(
      Date.parse(firstClaim.notificationClaimedAt),
    );
    await expect(action.run({ deckId: "deck-1" })).resolves.toMatchObject({
      alreadyRequested: true,
      notifiedOwner: false,
      requestId,
    });
    expect(notifyWithDelivery).toHaveBeenCalledOnce();

    resolveDelivery({
      notification: { id: "notification-1" },
      deliveredChannels: ["inbox", "email"],
    });
    await expect(firstRequest).resolves.toMatchObject({
      alreadyRequested: true,
      notifiedOwner: true,
      requestId,
    });
    const completedPayload = JSON.parse(
      state.previousRequests[0].payload as string,
    );
    expect(completedPayload.notificationClaimedAt).toBeUndefined();
    expect(completedPayload.notificationClaimToken).toBeUndefined();
  });

  it("reports a durable request when delivery status cannot be persisted", async () => {
    state.updateConflict = true;

    await expect(action.run({ deckId: "deck-1" })).resolves.toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      notifiedOwner: false,
      message: "Access request recorded for the deck owner.",
    });
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
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
    expect(notifyWithDelivery).not.toHaveBeenCalled();
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
    expect(notifyWithDelivery).not.toHaveBeenCalled();
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
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("records an anonymous request for the supplied email", async () => {
    state.requesterEmail = null;

    const result = await action.run({
      deckId: "deck-1",
      accessRequestToken: "request-token",
      requesterEmail: "guest@example.com",
    });

    expect(result).toMatchObject({
      ok: true,
      alreadyHasAccess: false,
      notifiedOwner: true,
    });
    expect(JSON.parse(state.insertedRows[0].payload as string)).toMatchObject({
      requesterEmail: "guest@example.com",
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "guest@example.com" }),
    );
  });

  it("requires an email for an anonymous requester", async () => {
    state.requesterEmail = null;

    await expect(
      action.run({ deckId: "deck-1", accessRequestToken: "request-token" }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(state.insertedRows).toHaveLength(0);
  });

  it("requires the signed capability for anonymous requests", async () => {
    state.requesterEmail = null;

    await expect(
      action.run({
        deckId: "deck-1",
        requesterEmail: "guest@example.com",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(state.insertedRows).toHaveLength(0);
  });

  it("limits anonymous requests with the durable per-deck bucket", async () => {
    state.requesterEmail = null;

    for (let index = 0; index < 5; index += 1) {
      await action.run({
        deckId: "deck-1",
        accessRequestToken: "request-token",
        requesterEmail: `guest-${index}@example.com`,
      });
    }

    await expect(
      action.run({
        deckId: "deck-1",
        accessRequestToken: "request-token",
        requesterEmail: "guest-5@example.com",
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
  });
});
