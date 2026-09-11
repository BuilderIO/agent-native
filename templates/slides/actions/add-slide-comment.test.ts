import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ inserted: {} as Record<string, unknown> }));

vi.mock("@agent-native/core/server", () => ({
  getRequestRunContext: () => ({ browserTabId: "tab-1" }),
  getRequestUserEmail: () => "tiana@example.com",
  getRequestUserName: () => "Tiana",
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => undefined),
}));
vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDeckComment: vi.fn(async () => false),
}));
vi.mock("../server/db/index.js", () => ({
  schema: { slideComments: {} },
  getDb: () => ({
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        state.inserted = value;
      },
    }),
  }),
}));

import action from "./add-slide-comment";

const run = (ctx: ActionRunContext) =>
  (action as any).run(
    { deckId: "deck-1", slideId: "slide-1", content: "Looks good" },
    ctx,
  );

beforeEach(() => {
  state.inserted = {};
});

describe("add-slide-comment authorship", () => {
  it("keeps the authenticated profile name for frontend comments", async () => {
    await run({ caller: "frontend" });

    expect(state.inserted.authorName).toBe("Tiana");
  });

  it("labels agent tool comments separately", async () => {
    await run({ caller: "tool" });

    expect(state.inserted.authorName).toBe("AI Agent");
  });
});
