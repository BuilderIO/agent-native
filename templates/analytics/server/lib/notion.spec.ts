import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./credentials-context", () => ({
  credentialCacheScope: vi.fn(() => "notion-test-scope"),
  requireRequestCredentialContext: vi.fn(() => ({
    userEmail: "notion-test@example.test",
  })),
  scopedCredentialCacheKey: vi.fn((key: string) => `notion-test:${key}`),
}));

vi.mock("./provider-credentials", () => ({
  resolveAnalyticsProviderCredential: vi.fn(async () => ({
    value: "fake-notion-token",
    source: "workspace_connection",
  })),
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Notion content calendar", () => {
  it("discovers the matching database by schema instead of using a template-specific id", async () => {
    const fetchMock = vi.fn(async (rawUrl: string, init?: RequestInit) => {
      const url = new URL(rawUrl);
      if (url.pathname === "/v1/search") {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          results: [
            {
              id: "portable-content-db",
              title: [{ plain_text: "Content Calendar" }],
              properties: {
                Topic: { type: "title" },
                Status: { type: "status" },
                "Publish Date": { type: "date" },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }
      if (url.pathname === "/v1/databases/portable-content-db/query") {
        return jsonResponse({
          results: [],
          has_more: false,
          next_cursor: null,
        });
      }
      throw new Error(`Unexpected Notion path: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getContentCalendar } = await import("./notion");

    await expect(getContentCalendar()).resolves.toEqual([]);
    expect(
      fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toEqual(["/v1/search", "/v1/databases/portable-content-db/query"]);
  });

  it("uses an explicit database id without discovery when supplied", async () => {
    const fetchMock = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      expect(url.pathname).toBe("/v1/databases/explicit-db");
      return jsonResponse({
        properties: {
          Topic: { type: "title" },
          Status: { type: "status" },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getContentCalendarSchema } = await import("./notion");

    await expect(getContentCalendarSchema("explicit-db")).resolves.toEqual([
      { name: "Topic", type: "title" },
      { name: "Status", type: "status" },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
