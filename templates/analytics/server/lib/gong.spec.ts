import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./credentials", () => ({
  resolveCredential: vi.fn(async () => null),
}));

vi.mock("./credentials-context", () => ({
  requireRequestCredentialContext: vi.fn(() => ({
    userEmail: "gong-test@example.test",
  })),
  scopedCredentialCacheKey: vi.fn((key: string) => `gong-test:${key}`),
}));

vi.mock("./provider-credentials", () => ({
  resolveAnalyticsGongCredentials: vi.fn(async () => ({
    accessKey: "fake-access-key",
    accessSecret: "fake-access-secret",
    sources: [],
  })),
}));

import {
  buildGongSearchResult,
  getAllCalls,
  gongSearchVariants,
  matchesGongCallQuery,
  searchCallsForQueries,
  type GongCall,
} from "./gong";
import {
  DEFAULT_GONG_CALL_LIMIT,
  MAX_GONG_CALL_LIMIT,
  limitGongCalls,
  normalizeGongCallLimit,
  type GongCallLike,
} from "./gong-limits";

function call(id: string, started: string): GongCallLike {
  return { id, started };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("Gong call limits", () => {
  it("defaults to a small analysis batch", () => {
    expect(normalizeGongCallLimit(undefined)).toBe(DEFAULT_GONG_CALL_LIMIT);
    expect(normalizeGongCallLimit(Number.NaN)).toBe(DEFAULT_GONG_CALL_LIMIT);
  });

  it("clamps explicit limits to the supported range", () => {
    expect(normalizeGongCallLimit(0)).toBe(1);
    expect(normalizeGongCallLimit(100)).toBe(100);
    expect(normalizeGongCallLimit(MAX_GONG_CALL_LIMIT + 1)).toBe(
      MAX_GONG_CALL_LIMIT,
    );
    expect(normalizeGongCallLimit(7.9)).toBe(7);
  });

  it("returns the newest calls first and reports truncation", () => {
    const result = limitGongCalls(
      [
        call("old", "2026-05-01T10:00:00Z"),
        call("new", "2026-05-03T10:00:00Z"),
        call("middle", "2026-05-02T10:00:00Z"),
      ],
      2,
    );

    expect(result.calls.map((c) => c.id)).toEqual(["new", "middle"]);
    expect(result.limit).toBe(2);
    expect(result.truncated).toBe(true);
  });
});

describe("Gong call search matching", () => {
  it("follows the cursor for exhaustive unfiltered call lists", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requests.push(url);
        const hasCursor = url.includes("cursor=next-page");
        return new Response(
          JSON.stringify(
            hasCursor
              ? {
                  records: {},
                  calls: [
                    {
                      id: "c2",
                      title: "Quarterly planning",
                      started: "2026-05-04T10:00:00Z",
                    },
                  ],
                }
              : {
                  records: { cursor: "next-page", totalRecords: 2 },
                  calls: [
                    {
                      id: "c1",
                      title: "Edmunds discovery",
                      started: "2026-05-03T10:00:00Z",
                    },
                  ],
                },
          ),
          { status: 200 },
        );
      }),
    );

    const result = await getAllCalls({
      fromDateTime: "2026-04-18T00:00:00.000Z",
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain(
      "/calls?fromDateTime=2026-04-18T00%3A00%3A00.000Z",
    );
    expect(requests[1]).toContain("cursor=next-page");
    expect(result.calls.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(result.pages).toBe(2);
    expect(result.cursor).toBeUndefined();
    expect(result.totalRecords).toBe(2);
  });

  it("rejects oversized exhaustive unfiltered lists before paging the cohort", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requests.push(url);
        return new Response(
          JSON.stringify({
            records: { totalRecords: 501, cursor: "next-page" },
            calls: [],
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      getAllCalls({ fromDateTime: "2026-04-19T00:00:00.000Z" }),
    ).rejects.toThrow("Use provider-api-request with stageAs and pagination");
    expect(requests).toHaveLength(1);
  });

  it("rejects a 500-record exhaustive list before returning it to the agent", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requests.push(url);
        return new Response(
          JSON.stringify({
            records: { totalRecords: 500, cursor: "next-page" },
            calls: [],
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      getAllCalls({ fromDateTime: "2026-04-20T00:00:00.000Z" }),
    ).rejects.toThrow("500 records");
    expect(requests).toHaveLength(1);
  });

  it("rejects when the provider omits totalRecords but the page reaches the cap", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requests.push(url);
        return new Response(
          JSON.stringify({
            records: {},
            calls: Array.from({ length: 500 }, (_, index) => ({
              id: `call-${index}`,
              started: "2026-05-03T10:00:00Z",
            })),
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      getAllCalls({ fromDateTime: "2026-04-21T00:00:00.000Z" }),
    ).rejects.toThrow("reached 500 records");
    expect(requests).toHaveLength(1);
  });

  it("stops before fetching when an exhaustive deadline has already expired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getAllCalls(
        { fromDateTime: "2026-04-22T00:00:00.000Z" },
        { deadlineAt: Date.now() - 1 },
      ),
    ).rejects.toThrow("60-second runtime budget");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation into an in-flight Gong request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit): Promise<Response> =>
        new Promise((_, reject) => {
          if (init?.signal?.aborted) {
            reject(new Error("request aborted"));
            return;
          }
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("request aborted")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = getAllCalls(
      { fromDateTime: "2026-04-23T00:00:00.000Z" },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toThrow("request aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("generates Fusion-style account variants from deal names and domains", () => {
    expect(gongSearchVariants("The Knot Worldwide - New Deal")).toEqual(
      expect.arrayContaining(["the knot worldwide", "the knot", "@the."]),
    );
    expect(gongSearchVariants("theknotww.com")).toEqual(
      expect.arrayContaining(["theknotww.com", "@theknotww.com"]),
    );
  });

  it("matches company queries across title, participant email, and stop-word-light terms", () => {
    const call = {
      id: "call-1",
      started: "2026-05-03T10:00:00Z",
      title: "Renewal with Knot Worldwide",
      parties: [
        {
          name: "Jane Buyer",
          emailAddress: "jane@theknot.com",
          affiliation: "External",
        },
      ],
    } satisfies GongCall;

    expect(matchesGongCallQuery(call, "The Knot")).toBe(true);
    expect(matchesGongCallQuery(call, "theknot.com")).toBe(true);
    expect(matchesGongCallQuery(call, "Jane Buyer")).toBe(true);
    expect(matchesGongCallQuery(call, "Unrelated Account")).toBe(false);
  });

  it("uses the date-filtered extensive endpoint once per cursor page", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("https://api.gong.io/v2/calls/extensive");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        requests.push(body);
        if (!body.cursor) {
          return new Response(
            JSON.stringify({
              records: { cursor: "next-page" },
              calls: [
                {
                  metaData: {
                    id: "c1",
                    title: "Edmunds discovery",
                    started: "2026-05-03T10:00:00Z",
                    scope: "External",
                  },
                  parties: [],
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            records: {},
            calls: [
              {
                id: "c2",
                title: "Quarterly planning",
                started: "2026-05-04T10:00:00Z",
                scope: "External",
                parties: [
                  {
                    name: "Buyer",
                    emailAddress: "buyer@edmunds.com",
                    affiliation: "External",
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const result = await searchCallsForQueries(["Edmunds"], 90, 8, {
      exhaustive: true,
      fromDateTime: "2026-04-18T00:00:00.000Z",
      toDateTime: "2026-07-12T23:59:59.999Z",
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual({
      filter: {
        fromDateTime: "2026-04-18T00:00:00.000Z",
        toDateTime: "2026-07-12T23:59:59.999Z",
      },
      contentSelector: { exposedFields: { parties: true } },
    });
    expect(requests[1]).toEqual({
      filter: {
        fromDateTime: "2026-04-18T00:00:00.000Z",
        toDateTime: "2026-07-12T23:59:59.999Z",
      },
      contentSelector: { exposedFields: { parties: true } },
      cursor: "next-page",
    });
    expect(result.calls.map((item) => item.id)).toEqual(["c2", "c1"]);
    expect(result.searchedCallCount).toBe(2);
    expect(result.coverageTruncated).toBe(false);
  });

  it("routes oversized exhaustive scans to the checkpointed corpus workflow", async () => {
    const requests: Array<Record<string, any>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            records: { totalRecords: 501, cursor: "next-page" },
            calls: [],
          }),
          { status: 200 },
        );
      }),
    );

    await expect(
      searchCallsForQueries(["Edmunds"], 90, 8, { exhaustive: true }),
    ).rejects.toThrow(
      "Use provider-corpus-job with staged call IDs for searches with 500 or more records",
    );
    expect(requests).toHaveLength(1);
  });
});

describe("buildGongSearchResult", () => {
  const matched = [
    { id: "a", started: "2026-05-01T10:00:00Z" },
    { id: "b", started: "2026-05-03T10:00:00Z" },
    { id: "c", started: "2026-05-02T10:00:00Z" },
  ] as (GongCall & { matchedQueries?: string[] })[];

  it("caps to the newest `limit` and flags truncation when not exhaustive", () => {
    const result = buildGongSearchResult(matched, 2, {
      searchedCallCount: 50,
      queryCount: 1,
      cursor: "next-page",
      exhaustive: false,
    });

    expect(result.calls.map((c) => c.id)).toEqual(["b", "c"]);
    expect(result.truncated).toBe(true);
    expect(result.coverageTruncated).toBe(true);
    expect(result.matchedCallCount).toBe(3);
  });

  it("returns every match newest-first and flags an incomplete exhaustive page cap", () => {
    const result = buildGongSearchResult(matched, 2, {
      searchedCallCount: 50,
      queryCount: 1,
      cursor: "next-page",
      exhaustive: true,
    });

    // All three returned despite limit=2 and a remaining cursor.
    expect(result.calls.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(result.calls).toHaveLength(3);
    expect(result.limit).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.coverageTruncated).toBe(true);
    expect(result.matchedCallCount).toBe(3);
  });
});
