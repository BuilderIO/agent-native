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

const NOT_FOUND = "https://api.x.com/2/problems/resource-not-found";
const USAGE_CAPPED = "https://api.x.com/2/problems/usage-capped";

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
      return new Response(
        typeof body === "string" ? body : JSON.stringify(body),
        { status },
      );
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
      repost_count: 3,
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

  it("looks up accounts by username with the app's Bearer token, telling accounts X lacks from ones it held back", async () => {
    const requests = serve(() => ({
      body: {
        data: [{ id: "111", username: "builderio", name: "Builder.io" }],
        errors: [
          { value: "nobody_here", title: "Not Found Error", type: NOT_FOUND },
          {
            value: "suspended_one",
            title: "Forbidden",
            type: "https://api.x.com/2/problems/resource-unavailable",
          },
        ],
      },
    }));
    expect(
      await lookupXUsers("test-token", [
        "BuilderIO",
        "nobody_here",
        "suspended_one",
      ]),
    ).toEqual({
      users: [{ id: "111", username: "builderio" }],
      returned: 1,
      missing: ["nobody_here"],
      unavailable: ["suspended_one"],
      problem: null,
    });
    expect(requests).toHaveLength(1);
    expect(first(requests).url.origin).toBe("https://api.x.com");
    expect(first(requests).url.pathname).toBe("/2/users/by");
    expect(first(requests).url.searchParams.get("usernames")).toBe(
      "BuilderIO,nobody_here,suspended_one",
    );
    expect(first(requests).authorization).toBe("Bearer test-token");
  });

  it("asks a timeline for a page without reposts or replies, from a since_id or a start time and up to an until_id", async () => {
    const requests = serve(() => ({
      body: {
        data: [rawPost("9"), rawPost("8")],
        meta: { result_count: 2, next_token: "page-2" },
      },
    }));
    expect(
      await listXUserPostsPage("test-token", "111", { sinceId: "4" }, 100),
    ).toEqual(
      expect.objectContaining({
        returned: 2,
        newestId: "9",
        oldestId: "8",
        oldestAt: "2026-11-20T12:00:00.000Z",
        more: true,
        problem: null,
      }),
    );
    await listXUserPostsPage(
      "test-token",
      "111",
      { startTime: "2026-10-27T00:00:00Z", untilId: "10" },
      33,
    );

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/2/users/111/tweets",
      "/2/users/111/tweets",
    ]);
    expect(
      requests.map(({ url }) => Object.fromEntries(url.searchParams)),
    ).toEqual([
      {
        max_results: "100",
        exclude: "retweets,replies",
        "post.fields": "created_at,public_metrics,entities,note_post",
        since_id: "4",
      },
      {
        max_results: "33",
        exclude: "retweets,replies",
        "post.fields": "created_at,public_metrics,entities,note_post",
        start_time: "2026-10-27T00:00:00Z",
        until_id: "10",
      },
    ]);
  });

  it("drops posts outside the asked range but counts them as read", async () => {
    serve(() => ({
      body: {
        data: [rawPost("12"), rawPost("10"), rawPost("9"), rawPost("4")],
        meta: { result_count: 4 },
      },
    }));
    const page = await listXUserPostsPage(
      "test-token",
      "111",
      { sinceId: "4", untilId: "10" },
      100,
    );
    expect(page.posts.map((post) => post.id)).toEqual(["9"]);
    expect(page.returned).toBe(4);
    expect(page.newestId).toBe("9");
    expect(page.oldestId).toBe("4");
    expect(page.more).toBe(false);
  });

  it("reads a page size of 5 to 100 posts only", async () => {
    const requests = serve(() => ({ body: { meta: { result_count: 0 } } }));
    for (const size of [4, 101, 7.5]) {
      await expect(
        listXUserPostsPage("test-token", "111", { sinceId: "4" }, size),
      ).rejects.toMatchObject({ errorCode: "x_page_size_invalid", billed: 0 });
    }
    expect(requests).toEqual([]);
  });

  it("tells a confirmed empty timeline from an answer with neither posts nor a count, and names an account X lacks or holds back", async () => {
    serve(() => ({ body: { meta: { result_count: 0 } } }));
    expect(
      await listXUserPostsPage("test-token", "111", { sinceId: "4" }, 100),
    ).toEqual({
      posts: [],
      returned: 0,
      newestId: null,
      oldestId: null,
      oldestAt: null,
      more: false,
      problem: null,
    });
    serve(() => ({ body: {} }));
    await expect(
      listXUserPostsPage("test-token", "111", { sinceId: "4" }, 100),
    ).rejects.toMatchObject({ errorCode: "x_unexpected_response", billed: 0 });
    serve(() => ({
      body: {
        errors: [
          {
            resource_id: "111",
            title: "Not Found Error",
            detail: "Could not find user with id: [111].",
            type: NOT_FOUND,
          },
        ],
      },
    }));
    await expect(
      listXUserPostsPage("test-token", "111", { sinceId: "4" }, 100),
    ).rejects.toMatchObject({ errorCode: "x_account_not_found", billed: 0 });
    serve(() => ({
      body: {
        errors: [
          {
            resource_id: "111",
            title: "Authorization Error",
            type: "https://api.x.com/2/problems/not-authorized-for-resource",
          },
        ],
      },
    }));
    await expect(
      listXUserPostsPage("test-token", "111", { sinceId: "4" }, 100),
    ).rejects.toMatchObject({ errorCode: "x_account_unavailable", billed: 0 });
  });

  it("keeps the posts of a page that came with X's spending limit and hands the limit back", async () => {
    serve(() => ({
      body: {
        data: [rawPost("9")],
        errors: [{ title: "Usage capped", type: USAGE_CAPPED }],
        meta: { result_count: 1 },
      },
    }));
    const page = await listXUserPostsPage(
      "test-token",
      "111",
      { sinceId: "4" },
      100,
    );
    expect(page.posts.map((post) => post.id)).toEqual(["9"]);
    expect(page.problem).toMatchObject({
      errorCode: "x_spending_limit_reached",
      billed: 1,
    });
  });

  it("fails visibly, naming post.fields, when posts lack the fields it asks for", async () => {
    serve(() => ({
      body: {
        data: [rawPost("9"), { id: "8", text: "No metrics" }],
        meta: { result_count: 2 },
      },
    }));
    const failure = listXUserPostsPage(
      "test-token",
      "111",
      { sinceId: "4" },
      100,
    );
    await expect(failure).rejects.toMatchObject({
      errorCode: "x_fields_missing",
      billed: 2,
    });
    await expect(failure).rejects.toThrow(
      "post.fields=created_at,public_metrics,entities,note_post",
    );
  });

  it("reads a long post's note_post text and a link that only the note carries, and either name for reposts", () => {
    expect(
      parseXPost(
        rawPost("1", {
          text: "The first 280 characters of a long post…",
          note_post: {
            text: "The whole long post, with the write-up at https://t.co/b",
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
      text: "The whole long post, with the write-up at https://t.co/b",
      links: [
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
        note_tweet: { text: "Older note name" },
        public_metrics: { retweet_count: 7 },
      }),
    ).toEqual(
      expect.objectContaining({
        text: "Older note name",
        metrics: expect.objectContaining({ reposts: 7, views: null }),
      }),
    );
    expect(parseXPost({ id: "3", text: "No created_at" })).toBeNull();
  });

  it("looks posts up by id, telling posts X reports gone from ones it held back", async () => {
    const requests = serve(() => ({
      body: {
        data: [rawPost("1")],
        errors: [
          { resource_id: "2", title: "Not Found Error", type: NOT_FOUND },
          {
            resource_id: "3",
            title: "Authorization Error",
            type: "https://api.x.com/2/problems/not-authorized-for-resource",
          },
        ],
      },
    }));
    const result = await lookupXPosts("test-token", ["1", "2", "3", "4"]);
    expect(result.returned).toBe(1);
    expect(result.posts.map((post) => post.id)).toEqual(["1"]);
    expect(result.gone).toEqual(["2"]);
    expect(result.unavailable).toEqual(["3", "4"]);
    expect(result.problem).toBeNull();
    expect(first(requests).url.pathname).toBe("/2/tweets");
    expect(first(requests).url.searchParams.get("ids")).toBe("1,2,3,4");
    expect(first(requests).url.searchParams.get("post.fields")).toBe(
      "created_at,public_metrics,entities,note_post",
    );
  });

  it("keeps the posts of a lookup that came with X's spending limit, and fails one with nothing to show", async () => {
    serve(() => ({
      body: {
        data: [rawPost("1")],
        errors: [{ title: "Usage capped", type: USAGE_CAPPED }],
      },
    }));
    const result = await lookupXPosts("test-token", ["1", "2"]);
    expect(result.posts.map((post) => post.id)).toEqual(["1"]);
    expect(result.problem).toMatchObject({
      errorCode: "x_spending_limit_reached",
      billed: 1,
    });
    serve(() => ({ body: {} }));
    await expect(lookupXPosts("test-token", ["1"])).rejects.toMatchObject({
      errorCode: "x_unexpected_response",
      billed: 0,
    });
  });

  it("stops a lookup of more posts than one request takes", async () => {
    serve(() => ({ body: {} }));
    await expect(
      lookupXPosts(
        "test-token",
        Array.from({ length: 101 }, (_, index) => String(index)),
      ),
    ).rejects.toMatchObject({ errorCode: "x_too_many_posts", billed: 0 });
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
      billed: 0,
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

  it("leaves what a request cost unknown when X's answer can't be read or X failed", async () => {
    serve(() => ({ status: 503, body: { title: "Service Unavailable" } }));
    await expect(lookupXPosts("test-token", ["1"])).rejects.toMatchObject({
      errorCode: "x_request_failed",
      billed: null,
    });
    serve(() => ({ body: "<html>upstream reset</html>" }));
    await expect(lookupXPosts("test-token", ["1"])).rejects.toMatchObject({
      errorCode: "x_unexpected_response",
      billed: null,
    });
    serve(() => ({ body: { data: { id: "1" } } }));
    await expect(lookupXPosts("test-token", ["1"])).rejects.toMatchObject({
      errorCode: "x_unexpected_response",
      billed: null,
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
