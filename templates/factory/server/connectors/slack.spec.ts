import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authTest,
  findUserByEmail,
  getMessagePermalink,
  getUserInfo,
  postChannelMessage,
  SlackWriteError,
} from "./slack";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("authTest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the authenticated Slack bot id when available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          user_id: "U-agent-native",
          user: "agent-native",
          team_id: "T1",
          team: "Builder",
          bot_id: "B-agent-native",
        }),
      ),
    );

    await expect(
      authTest("primary", async () => "xoxb-auth-test"),
    ).resolves.toEqual({
      userId: "U-agent-native",
      userName: "agent-native",
      teamId: "T1",
      teamName: "Builder",
      botId: "B-agent-native",
    });
  });
});

describe("getUserInfo cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reuse a cached profile across Slack credentials", async () => {
    const fetchSpy = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const auth =
          init &&
          typeof init.headers === "object" &&
          !Array.isArray(init.headers)
            ? (init.headers as Record<string, string>).Authorization
            : undefined;
        if (auth === "Bearer xoxb-org-a") {
          return jsonResponse({
            ok: true,
            user: {
              id: "U-shared",
              name: "orga",
              profile: { display_name: "Org A" },
            },
          });
        }
        return jsonResponse({
          ok: true,
          user: {
            id: "U-shared",
            name: "orgb",
            profile: { display_name: "Org B" },
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetchSpy);

    const first = await getUserInfo(
      "primary",
      "U-shared",
      async () => "xoxb-org-a",
    );
    const second = await getUserInfo(
      "primary",
      "U-shared",
      async () => "xoxb-org-b",
    );

    expect(first.displayName).toBe("Org A");
    expect(second.displayName).toBe("Org B");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reuses a cached profile for the same credential", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        ok: true,
        user: {
          id: "U-cached",
          name: "same",
          profile: { display_name: "Same Org" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const first = await getUserInfo(
      "primary",
      "U-cached",
      async () => "xoxb-same",
    );
    const second = await getUserInfo(
      "primary",
      "U-cached",
      async () => "xoxb-same",
    );

    expect(first.displayName).toBe("Same Org");
    expect(second.displayName).toBe("Same Org");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("getUserInfo bot flag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["a person", { id: "U1" }, false],
    ["a bot user", { id: "U2", is_bot: true }, true],
    ["an app user", { id: "U3", is_app_user: true }, true],
  ])("reads %s", async (_name, user, isBot) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          user: { ...user, name: `n-${user.id}`, profile: {} },
        }),
      ),
    );

    const info = await getUserInfo(
      "primary",
      user.id,
      async () => `xoxb-flag-${user.id}`,
    );

    expect(info.isBot).toBe(isBot);
  });
});

describe("Slack message write delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies HTTP 429 as rejected and captures Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("rate_limited", {
            status: 429,
            headers: { "Retry-After": "7" },
          }),
      ),
    );

    await expect(
      postChannelMessage("primary", "C123", "report", async () => "token"),
    ).rejects.toMatchObject({
      name: "SlackWriteError",
      delivery: "rejected",
      retryAfterSeconds: 7,
    } satisfies Partial<SlackWriteError>);
  });

  it.each([400, 401])("classifies HTTP %s as rejected", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid_request", { status })),
    );

    await expect(
      postChannelMessage("primary", "C123", "report", async () => "token"),
    ).rejects.toMatchObject({
      name: "SlackWriteError",
      delivery: "rejected",
      retryAfterSeconds: null,
    } satisfies Partial<SlackWriteError>);
  });

  it("keeps server errors ambiguous", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 500 })),
    );

    await expect(
      postChannelMessage("primary", "C123", "report", async () => "token"),
    ).rejects.toMatchObject({
      name: "SlackWriteError",
      delivery: "unknown",
      retryAfterSeconds: null,
    } satisfies Partial<SlackWriteError>);
  });

  it("keeps transport failures ambiguous", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(
      postChannelMessage("primary", "C123", "report", async () => "token"),
    ).rejects.toMatchObject({
      name: "SlackWriteError",
      delivery: "unknown",
      retryAfterSeconds: null,
    } satisfies Partial<SlackWriteError>);
  });
});

describe("findUserByEmail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves an email to a member id", async () => {
    const fetchSpy = vi.fn(async (_url: RequestInfo | URL) =>
      jsonResponse({
        ok: true,
        user: { id: "U0ADA", is_bot: false, deleted: false },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      findUserByEmail("primary", " ada@example.test ", async () => "xoxb-find"),
    ).resolves.toEqual({ id: "U0ADA", isBot: false, deleted: false });
    const url = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/users.lookupByEmail");
    expect(url.searchParams.get("email")).toBe("ada@example.test");
  });

  it("answers null only when Slack looked and found no one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: false, error: "users_not_found" })),
    );

    await expect(
      findUserByEmail(
        "primary",
        "nobody@example.test",
        async () => "xoxb-none",
      ),
    ).resolves.toBeNull();
  });

  it("throws when it could not ask, instead of answering null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: false, error: "missing_scope" })),
    );

    await expect(
      findUserByEmail("primary", "ada@example.test", async () => "xoxb-scope"),
    ).rejects.toThrow("missing_scope");
  });

  it("flags a deactivated member and a bot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          user: { id: "U0OLD", is_bot: true, deleted: true },
        }),
      ),
    );

    await expect(
      findUserByEmail("primary", "old@example.test", async () => "xoxb-old"),
    ).resolves.toEqual({ id: "U0OLD", isBot: true, deleted: true });
  });
});

describe("getMessagePermalink", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the permalink, and fails when Slack sends none", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            ok: true,
            permalink: "https://example.slack.com/archives/C1/p1",
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true })),
    );

    await expect(
      getMessagePermalink("primary", "C1", "1.1", async () => "xoxb-link"),
    ).resolves.toBe("https://example.slack.com/archives/C1/p1");
    await expect(
      getMessagePermalink("primary", "C1", "2.2", async () => "xoxb-link"),
    ).rejects.toThrow("missing the link");
  });
});
