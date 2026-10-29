import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  approverEmail: "OWNER@example.com" as string | null,
  resolveAccess: vi.fn(),
  verifyScopedAgentAccessToken: vi.fn(),
  deckRows: [] as unknown[],
  requestRows: [] as unknown[],
}));

vi.mock("@agent-native/core/server", () => ({
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mocks.verifyScopedAgentAccessToken(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.approverEmail,
  getRequestOrgId: () => "org-1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: (selection: Record<string, unknown>) => ({
      from: () => ({
        where: () =>
          "payload" in selection
            ? Promise.resolve(mocks.requestRows)
            : { limit: async () => mocks.deckRows },
      }),
    }),
  }),
  schema: {
    decks: { id: "decks.id", title: "decks.title" },
    deckEvents: { id: "deck_events.id", payload: "deck_events.payload" },
  },
}));

import getDeckAccessRequest from "./get-deck-access-request.js";

const run = () =>
  (
    getDeckAccessRequest as unknown as {
      run: (input: Record<string, string>) => Promise<unknown>;
    }
  ).run({
    deckId: "deck-1",
    approvalToken: "approval-token",
  });

function requestRow(payload: Record<string, unknown>) {
  return {
    id: "request-1",
    payload: JSON.stringify({
      requesterEmail: "viewer@example.com",
      approvalTokenHash: createHash("sha256")
        .update("approval-token")
        .digest("hex"),
      ...payload,
    }),
  };
}

describe("get-deck-access-request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.approverEmail = "OWNER@example.com";
    mocks.resolveAccess.mockResolvedValue({ role: "owner" });
    mocks.verifyScopedAgentAccessToken.mockReturnValue({
      ok: true,
      viewerEmail: "Viewer@example.com",
    });
    mocks.deckRows = [{ title: "Launch review" }];
    mocks.requestRows = [
      requestRow({ requestedRole: "editor", note: "For the launch" }),
    ];
  });

  it("shows the owner who asked, for what role, and their note", async () => {
    await expect(run()).resolves.toEqual({
      deckId: "deck-1",
      deckTitle: "Launch review",
      requesterEmail: "viewer@example.com",
      requesterName: null,
      note: "For the launch",
      requestedRole: "editor",
      granted: false,
    });
    expect(mocks.resolveAccess).toHaveBeenCalledWith("deck", "deck-1", {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
  });

  it("reads a request recorded before roles as a view request", async () => {
    mocks.requestRows = [requestRow({})];

    await expect(run()).resolves.toMatchObject({ requestedRole: "viewer" });
  });

  it("does not show the request to someone who cannot manage the deck", async () => {
    mocks.resolveAccess.mockResolvedValue({ role: "editor" });

    await expect(run()).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects a link whose token is not the one on record", async () => {
    mocks.requestRows = [requestRow({ approvalTokenHash: "other" })];

    await expect(run()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("asks a signed-out visitor to sign in", async () => {
    mocks.approverEmail = null;

    await expect(run()).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
  });
});
