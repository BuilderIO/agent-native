import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRows = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  verifyScopedAgentAccessToken: vi.fn(() => ({ ok: false })),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { query: Record<string, unknown> }) => event.query,
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("../../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mockRows.current,
        }),
      }),
    }),
  }),
  schema: {
    decks: {
      id: "id_col",
      title: "title_col",
      data: "data_col",
      visibility: "visibility_col",
      designSystemId: "design_system_id_col",
      createdAt: "created_at_col",
      updatedAt: "updated_at_col",
    },
  },
}));

import handler from "./deck-agent-context.json.get";

const launchContent =
  '<div class="fmd-slide"><h1>Launch</h1><div class="text-box"><p>One</p><p>Two</p></div></div>';

describe("deck agent context", () => {
  beforeEach(() => {
    mockRows.current = [
      {
        id: "deck-1",
        title: "Launch",
        data: JSON.stringify({
          slides: [
            {
              id: "slide-1",
              content: launchContent,
              animations: [
                {
                  id: "anim-ok",
                  elementIndex: 0,
                  elementPath: [1, 0],
                  type: "fade",
                },
                {
                  id: "anim-gone",
                  elementIndex: 0,
                  elementPath: [9],
                  type: "fade",
                },
              ],
            },
          ],
        }),
        visibility: "public",
        designSystemId: null,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ];
  });

  it("reports each slide's reveal issues under its stored position", async () => {
    const result = (await handler({
      query: { id: "deck-1" },
    } as any)) as { slides: Array<{ animationIssues?: unknown }> };

    expect(result.slides[0]?.animationIssues).toEqual([
      { index: 1, id: "anim-gone", code: "stale-path" },
    ]);
  });
});
