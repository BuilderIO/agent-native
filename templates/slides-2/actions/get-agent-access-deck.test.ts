import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyScopedAgentAccessToken: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, details: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), details);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mocks.verifyScopedAgentAccessToken(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    decks: { id: "id", title: "title", data: "data" },
  },
}));

import { DECK_AGENT_RESOURCE_KIND } from "../shared/agent-readable.js";
import action from "./get-agent-access-deck.js";

describe("get-agent-access-deck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyScopedAgentAccessToken.mockReturnValue({ ok: true });
    mocks.limit.mockResolvedValue([
      {
        title: "Private deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              id: "slide-1",
              content: '<div class="fmd-slide"><h1>Title</h1></div>',
              notes: "private speaker notes",
            },
          ],
        }),
      },
    ]);
    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({ limit: mocks.limit }),
      }),
    });
  });

  it("returns a presentation-safe deck after verifying its scoped token", async () => {
    const result = await action.run({ id: "deck-1", token: "short-lived" });

    expect(mocks.verifyScopedAgentAccessToken).toHaveBeenCalledWith(
      "short-lived",
      { resourceKind: DECK_AGENT_RESOURCE_KIND, resourceId: "deck-1" },
    );
    expect(result).toMatchObject({
      title: "Private deck",
      slides: [{ id: "slide-1", notes: "" }],
    });
    expect(JSON.stringify(result)).not.toContain("private speaker notes");
  });

  it("rejects an invalid token before querying the deck", async () => {
    mocks.verifyScopedAgentAccessToken.mockReturnValue({ ok: false });

    await expect(
      action.run({ id: "deck-1", token: "invalid" }),
    ).rejects.toMatchObject({
      errorCode: "agent_access_token_invalid",
      statusCode: 403,
    });
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
