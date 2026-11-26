import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credential = vi.hoisted(() => ({ token: "test-token" as string | null }));

vi.mock("./credentials", () => ({
  resolveCredential: async () => credential.token,
}));
vi.mock("./credentials-context", () => ({
  requireRequestCredentialContext: () => ({ email: "alice@example.test" }),
}));

const {
  listXUserPostsPage,
  lookupXPosts,
  lookupXUsers,
  parseXPost,
  testXBearerToken,
  xBearerToken,
} = await import("./x-api");

type Handler = (url: URL) => { status?: number; body: unknown };

function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error("expected at least one item");
  return item;
}

function serve(handler: Handler) {
  const requests: Array<{ url: URL; authorization: string | null }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL, init?: RequestInit) => {
      const url = new URL(input);
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const { status = 200, body } = handler(url);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return requests;
}

function rawPost(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    text: `Post ${id}`,
    created_at: "2026-11-20T12:00:00.000Z",
    public_metrics: {
      impression_count: 1000,
      like_count: 10,
      retweet_count: 3,
      reply_count: 2,
      quote_count: 1,
      bookmark_count: 4,
    },
    ...extra,
  };
}

describe("X API client", () => {
  beforeEach(() => {
    credential.token = "test-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("looks up accounts by username with the app's Bearer token and names the ones X lacks", async () => {
    const requests = serve(() => ({
      body: {
        data: [{ id: "111", username: "builderio", name: "Builder.io" }],
        errors: [{ value: "nobody_here", title: "Not Found Error" }],
      },
    }));
    expect(
      await lookupXUsers("test-token", ["BuilderIO", "nobody_here"]),
    ).toEqual({
      users: [{ id: "111", username: "builderio", name: "Builder.io" }],
      missing: ["nobody_here"],
    });
    expect(requests).toHaveLength(1);
    expect(first(requests).url.origin).toBe("https://api.x.com");
    expect(first(requests).url.pathname).toBe("/2/users/by");
    expect(first(requests).url.searchParams.get("usernames")).toBe(
      "BuilderIO,nobody_here",
    );
    expect(first(requests).authorization).toBe("Bearer test-token");
  });

  it("asks a timeline for 100 posts a page without reposts or replies, from a since_id or a start time", async () => {
    const requests = serve((url) => ({
      body: url.searchParams.get("pagination_token")
        ? { data: [rawPost("5")], meta: { result_count: 1 } }
        : {
            data: [rawPost("9"), rawPost("8")],
            meta: { result_count: 2, next_token: "page-2" },
          },
    }));
    const first = await listXUserPostsPage(
      "test-token",
      "111",
      { sinceId: "4" },
      undefined,
    );
    expect(first.returned).toBe(2);
    expect(first.nextToken).toBe("page-2");
    expect(first.posts.map((post) => post.id)).toEqual(["9", "8"]);
    const second = await listXUserPostsPage(
      "test-token",
      "111",
      { sinceId: "4" },
      "page-2",
    );
    expect(second.nextToken).toBeNull();
    await listXUserPostsPage(
      "test-token",
      "111",
      { startTime: "2026-10-27T00:00:00Z" },
      undefined,
    );

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/2/users/111/tweets",
      "/2/users/111/tweets",
      "/2/users/111/tweets",
    ]);
    expect(
      requests.map(({ url }) => Object.fromEntries(url.searchParams)),
    ).toEqual([
      {
        max_results: "100",
        exclude: "retweets,replies",
        "tweet.fields": "created_at,public_metrics,entities,note_tweet",
        since_id: "4",
      },
      {
        max_results: "100",
        exclude: "retweets,replies",
        "tweet.fields": "created_at,public_metrics,entities,note_tweet",
        since_id: "4",
        pagination_token: "page-2",
      },
      {
        max_results: "100",
        exclude: "retweets,replies",
        "tweet.fields": "created_at,public_metrics,entities,note_tweet",
        start_time: "2026-10-27T00:00:00Z",
      },
    ]);
  });

  it("reads a long post's full text and links, and either name for reposts", () => {
    expect(
      parseXPost(
        rawPost("1", {
          text: "Short version https://t.co/a",
          entities: {
            urls: [
              {
                url: "https://t.co/a",
                expanded_url: "https://www.builder.io/blog/x",
                display_url: "builder.io/blog/x",
              },
            ],
          },
          note_tweet: {
            text: "The whole long post https://t.co/b",
            entities: {
              urls: [
                {
                  url: "https://t.co/b",
                  expanded_url: "https://agent-native.com/docs",
                  unwound_url: "https://agent-native.com/docs/start",
                },
              ],
            },
          },
        }),
      ),
    ).toEqual({
      id: "1",
      createdAt: "2026-11-20T12:00:00.000Z",
      text: "The whole long post https://t.co/b",
      links: [
        {
          url: "https://t.co/a",
          expandedUrl: "https://www.builder.io/blog/x",
          unwoundUrl: null,
          displayUrl: "builder.io/blog/x",
        },
        {
          url: "https://t.co/b",
          expandedUrl: "https://agent-native.com/docs",
          unwoundUrl: "https://agent-native.com/docs/start",
          displayUrl: null,
        },
      ],
      metrics: {
        views: 1000,
        likes: 10,
        reposts: 3,
        replies: 2,
        quotes: 1,
        bookmarks: 4,
      },
    });
    expect(
      parseXPost({
        id: "2",
        created_at: "2026-11-20T12:00:00.000Z",
        note_post: { text: "Renamed note" },
        public_metrics: { repost_count: 7 },
      }),
    ).toEqual(
      expect.objectContaining({
        text: "Renamed note",
        metrics: expect.objectContaining({ reposts: 7, views: null }),
      }),
    );
  });

  it("looks posts up by id and names the ones X reports gone", async () => {
    const requests = serve(() => ({
      body: {
        data: [rawPost("1")],
        errors: [{ resource_id: "2", title: "Not Found Error" }],
      },
    }));
    const result = await lookupXPosts("test-token", ["1", "2", "3"]);
    expect(result.returned).toBe(1);
    expect(result.posts.map((post) => post.id)).toEqual(["1"]);
    expect(result.missing).toEqual(["2"]);
    expect(first(requests).url.pathname).toBe("/2/tweets");
    expect(first(requests).url.searchParams.get("ids")).toBe("1,2,3");
    expect(first(requests).url.searchParams.get("tweet.fields")).toBe(
      "created_at,public_metrics,entities,note_tweet",
    );
  });

  it("stops a lookup of more posts than one request takes", async () => {
    serve(() => ({ body: {} }));
    await expect(
      lookupXPosts(
        "test-token",
        Array.from({ length: 101 }, (_, index) => String(index)),
      ),
    ).rejects.toMatchObject({ errorCode: "x_too_many_posts" });
  });

  it("names a missing token as not set up", async () => {
    credential.token = null;
    await expect(xBearerToken()).rejects.toMatchObject({
      errorCode: "x_bearer_token_missing",
      statusCode: 424,
    });
  });

  it("tells a spending limit apart from a rejected token and a rate limit", async () => {
    serve(() => ({
      status: 402,
      body: { title: "Payment Required", detail: "Spend cap reached." },
    }));
    await expect(lookupXPosts("test-token", ["1"])).rejects.toMatchObject({
      errorCode: "x_spending_limit_reached",
    });
    serve(() => ({
      status: 429,
      body: {
        title: "UsageCapExceeded",
        type: "https://api.twitter.com/2/problems/usage-capped",
        detail: "Usage cap exceeded.",
      },
    }));
    await expect(lookupXPosts("test-token", ["1"])).rejects.toMatchObject({
      errorCode: "x_spending_limit_reached",
    });
    serve(() => ({ status: 429, body: { title: "Too Many Requests" } }));
    await expect(lookupXPosts("test-token", ["1"])).rejects.toMatchObject({
      errorCode: "x_rate_limited",
    });
    serve(() => ({ status: 401, body: { title: "Unauthorized" } }));
    await expect(lookupXPosts("test-token", ["1"])).rejects.toMatchObject({
      errorCode: "x_token_rejected",
    });
  });

  it("tests a token against the usage endpoint, which returns no posts", async () => {
    const requests = serve(() => ({
      body: { data: { project_usage: "0", project_cap: "3000000" } },
    }));
    await testXBearerToken("test-token");
    expect(requests).toHaveLength(1);
    expect(first(requests).url.pathname).toBe("/2/usage/tweets");
    expect(first(requests).url.searchParams.get("days")).toBe("1");
    serve(() => ({ status: 401, body: { title: "Unauthorized" } }));
    await expect(testXBearerToken("bad-token")).rejects.toMatchObject({
      errorCode: "x_token_rejected",
    });
  });
});
