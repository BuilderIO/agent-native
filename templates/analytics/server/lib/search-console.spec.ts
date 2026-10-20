import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const google = vi.hoisted(() => ({
  token: vi.fn(),
  identity: vi.fn(),
}));

vi.mock("./google-analytics", () => ({
  getGoogleServiceAccountToken: google.token,
  readServiceAccountIdentity: google.identity,
}));

import { querySearchAnalytics } from "./search-console";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("querySearchAnalytics", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    google.token.mockResolvedValue("token");
    google.identity.mockResolvedValue({
      status: "ok",
      email: "collector@example-project.iam.gserviceaccount.test",
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pages through results with the Search Console read-only scope", async () => {
    const full = Array.from({ length: 25_000 }, (_, index) => ({
      keys: ["2026-10-10", `https://example.test/blog/${index}`],
      clicks: 1,
      impressions: 2,
    }));
    fetchMock
      .mockResolvedValueOnce(json({ rows: full }))
      .mockResolvedValueOnce(json({ rows: full.slice(0, 3) }));

    const rows = await querySearchAnalytics({
      siteUrl: "sc-domain:example.test",
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      dimensions: ["date", "page"],
      pageRegex: "^https?://[^/]+/blog/",
      maxRows: 100_000,
    });

    expect(rows).toHaveLength(25_003);
    expect(google.token).toHaveBeenCalledWith(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe(
      "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.test/searchAnalytics/query",
    );
    expect(JSON.parse(init.body)).toEqual(
      expect.objectContaining({
        startRow: 25_000,
        dataState: "final",
        dimensionFilterGroups: [
          {
            filters: [
              {
                dimension: "page",
                operator: "includingRegex",
                expression: "^https?://[^/]+/blog/",
              },
            ],
          },
        ],
      }),
    );
  });

  it("names the service account to grant when the property denies access", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { error: { message: "User does not have sufficient permission" } },
        403,
      ),
    );

    await expect(
      querySearchAnalytics({
        siteUrl: "sc-domain:example.test",
        startDate: "2026-10-01",
        endDate: "2026-10-10",
        dimensions: ["date", "page"],
        maxRows: 1000,
      }),
    ).rejects.toMatchObject({
      statusCode: 424,
      errorCode: "search_console_no_access",
      message: expect.stringContaining(
        "collector@example-project.iam.gserviceaccount.test",
      ),
    });
  });

  it("accepts an exact row limit after confirming the next page is empty", async () => {
    const full = Array.from({ length: 25_000 }, () => ({
      keys: ["2026-10-10", "https://example.test/"],
      clicks: 1,
      impressions: 2,
    }));
    fetchMock
      .mockResolvedValueOnce(json({ rows: full }))
      .mockResolvedValueOnce(json({ rows: [] }));
    const rows = await querySearchAnalytics({
      siteUrl: "sc-domain:example.test",
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      dimensions: ["date", "page"],
      maxRows: 25_000,
    });
    expect(rows).toHaveLength(25_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails instead of returning a partial result past the row limit", async () => {
    const full = Array.from({ length: 25_000 }, () => ({
      keys: ["2026-10-10", "https://example.test/"],
      clicks: 0,
      impressions: 1,
    }));
    fetchMock.mockImplementation(async () => json({ rows: full }));

    await expect(
      querySearchAnalytics({
        siteUrl: "sc-domain:example.test",
        startDate: "2026-10-01",
        endDate: "2026-10-10",
        dimensions: ["date", "page"],
        maxRows: 25_000,
      }),
    ).rejects.toThrow("the read would be incomplete");
  });
});
