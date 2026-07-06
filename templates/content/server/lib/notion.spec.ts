import crypto from "node:crypto";

import { mockEvent, getCookie } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/oauth-tokens", () => ({
  deleteOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: vi.fn(),
  resolveSecret: vi.fn(),
  runWithRequestContext: vi.fn((_context, fn) => fn()),
}));

import {
  deleteOAuthTokens,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { getSession, resolveSecret } from "@agent-native/core/server";

import { canonicalizeNfm } from "../../shared/nfm";
import {
  normalizeNfmForStorage,
  parseNfmForEditor,
} from "../../shared/notion-markdown";
import {
  addNotionComment,
  buildNotionAuthUrl,
  createNotionPageWithMarkdown,
  getNotionConnectionForOwner,
  listNotionComments,
  notionFetch,
  NotionApiError,
  resolveNotionMarkdownResponse,
  saveNotionTokensForOwner,
  type NotionPageMarkdown,
} from "./notion";

describe("normalizeNfmForStorage", () => {
  it("upgrades legacy toggle marker syntax into details blocks", () => {
    expect(
      normalizeNfmForStorage("▶ Product ideas\n  Ship docs\n  - Follow up"),
    ).toBe(
      [
        "<details>",
        "<summary>Product ideas</summary>",
        "\tShip docs",
        "\t- Follow up",
        "</details>",
      ].join("\n"),
    );
  });

  it("does not capture same-indent siblings inside legacy toggles", () => {
    expect(
      normalizeNfmForStorage("▶ agents doing\nFramework share skills"),
    ).toBe(
      [
        "<details>",
        "<summary>agents doing</summary>",
        "</details>",
        "Framework share skills",
      ].join("\n"),
    );
  });

  it("keeps sibling legacy toggles as separate details blocks", () => {
    expect(normalizeNfmForStorage("▶ one\n▶ two")).toBe(
      [
        "<details>",
        "<summary>one</summary>",
        "</details>",
        "<details>",
        "<summary>two</summary>",
        "</details>",
      ].join("\n"),
    );
  });

  it("normalizes visual indents without touching fenced code", () => {
    expect(
      normalizeNfmForStorage(
        ["Parent", "\u00A0\u00A0Child", "```ts", "  const x = 1;", "```"].join(
          "\n",
        ),
      ),
    ).toBe(["Parent", "\tChild", "```ts", "  const x = 1;", "```"].join("\n"));
  });
});

describe("buildNotionAuthUrl", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(resolveSecret).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.mocked(getSession).mockReset();
    vi.mocked(resolveSecret).mockReset();
  });

  it("treats missing OAuth app credentials as expected setup state", async () => {
    await expect(
      buildNotionAuthUrl({} as any, "/sources"),
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage:
        "Notion OAuth credentials are not configured. Save NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in settings.",
    });
  });

  describe("with credentials configured", () => {
    const originalSecret = process.env.BETTER_AUTH_SECRET;

    beforeEach(() => {
      process.env.BETTER_AUTH_SECRET = "test-state-secret";
      vi.mocked(resolveSecret).mockImplementation(async (key: string) =>
        key === "NOTION_CLIENT_ID" ? "client-id" : "client-secret",
      );
    });

    afterEach(() => {
      if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = originalSecret;
    });

    it("sets an HttpOnly CSRF nonce cookie whose value matches state.n", async () => {
      const event = mockEvent("http://localhost/api/notion/auth-url");

      const url = await buildNotionAuthUrl(event, "/page/abc123");

      const setCookieHeader = event.res.headers.get("set-cookie");
      expect(setCookieHeader).toBeTruthy();
      expect(setCookieHeader).toContain("notion_oauth_state=");
      expect(setCookieHeader).toContain("HttpOnly");

      const cookieValue = getCookie(
        mockEvent("http://localhost/", {
          headers: { cookie: setCookieHeader!.split(";")[0] },
        }),
        "notion_oauth_state",
      );

      const stateParam = new URL(url).searchParams.get("state")!;
      const state = JSON.parse(Buffer.from(stateParam, "base64url").toString());

      expect(state.n).toBe(cookieValue);
    });

    it("signs redirectPath so the callback's HMAC verification accepts it", async () => {
      const event = mockEvent("http://localhost/api/notion/auth-url");
      const url = await buildNotionAuthUrl(event, "/page/abc123");

      const stateParam = new URL(url).searchParams.get("state")!;
      const state = JSON.parse(Buffer.from(stateParam, "base64url").toString());

      expect(state.redirectPath).toBe("/page/abc123");
      expect(typeof state.sig).toBe("string");

      // Mirrors callback.get.ts's verifyStateSignature exactly.
      const expected = crypto
        .createHmac("sha256", "test-state-secret")
        .update(`redirectPath:${state.redirectPath}`)
        .digest("base64url");
      expect(state.sig).toBe(expected);
    });

    it("omits sig (falls back to '/') when no state secret is configured", async () => {
      delete process.env.BETTER_AUTH_SECRET;
      delete process.env.NOTION_STATE_SECRET;
      delete process.env.AUTH_SECRET;
      const event = mockEvent("http://localhost/api/notion/auth-url");

      const url = await buildNotionAuthUrl(event, "/page/abc123");
      const stateParam = new URL(url).searchParams.get("state")!;
      const state = JSON.parse(Buffer.from(stateParam, "base64url").toString());

      expect(state.sig).toBeUndefined();
    });

    it("does not mark the CSRF cookie Secure on a plain-http origin (n17)", async () => {
      // Browsers (Safari even on http://localhost) silently drop Secure
      // cookies set over plain http, which previously made the CSRF-binding
      // cookie never arrive and broke Connect Notion in http dev entirely.
      const event = mockEvent("http://localhost/api/notion/auth-url");

      await buildNotionAuthUrl(event, "/page/abc123");

      const setCookieHeader = event.res.headers.get("set-cookie");
      expect(setCookieHeader).toBeTruthy();
      expect(setCookieHeader).not.toContain("Secure");
      expect(setCookieHeader).toContain("SameSite=Lax");
    });

    it("marks the CSRF cookie Secure when x-forwarded-proto is https (n17)", async () => {
      const event = mockEvent("http://localhost/api/notion/auth-url", {
        headers: { "x-forwarded-proto": "https" },
      });

      await buildNotionAuthUrl(event, "/page/abc123");

      const setCookieHeader = event.res.headers.get("set-cookie");
      expect(setCookieHeader).toContain("Secure");
    });

    it("marks the CSRF cookie Secure when the origin header is https (n17)", async () => {
      const event = mockEvent("http://localhost/api/notion/auth-url", {
        headers: { origin: "https://example.com" },
      });

      await buildNotionAuthUrl(event, "/page/abc123");

      const setCookieHeader = event.res.headers.get("set-cookie");
      expect(setCookieHeader).toContain("Secure");
    });
  });
});

describe("resolveNotionMarkdownResponse", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("hydrates unknown block ids into the first matching placeholder", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: "page_markdown",
          id: "child-block",
          markdown: '<callout icon="💡">\n\tRecovered subtree\n</callout>',
          truncated: false,
          unknown_block_ids: [],
        } satisfies NotionPageMarkdown),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await resolveNotionMarkdownResponse("token", {
      object: "page_markdown",
      id: "page-id",
      markdown:
        '# Imported\n\n<unknown url="https://notion.so/x" alt="embed"/>',
      truncated: true,
      unknown_block_ids: ["child-block"],
    });

    expect(result.markdown).toContain('<callout icon="💡">');
    expect(result.markdown).not.toContain("<unknown");
    expect(result.warnings).toContain(
      "This Notion page exceeded the markdown API block limit. The importer fetched additional subtrees where possible and preserved any remaining gaps as <unknown /> blocks.",
    );
  });

  it("preserves inaccessible unknown blocks and records a warning", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "object_not_found",
          message: "Could not find block",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await resolveNotionMarkdownResponse("token", {
      object: "page_markdown",
      id: "page-id",
      markdown: '<unknown url="https://notion.so/hidden" alt="child_page"/>',
      truncated: true,
      unknown_block_ids: ["hidden-block"],
    });

    expect(result.markdown).toContain("<unknown");
    expect(result.warnings).toContain(
      "Some child Notion blocks could not be loaded because the integration does not have access to them.",
    );
    expect(result.warnings).toContain(
      "One Notion block is still preserved as <unknown /> because it is unsupported or inaccessible.",
    );
  });

  it("hydrates unknown-block subtrees into canonical content", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: "page_markdown",
          id: "child-block",
          markdown: "- notion doc\n- access: amplitude, fullstory, sigma, jira",
          truncated: false,
          unknown_block_ids: [],
        } satisfies NotionPageMarkdown),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await resolveNotionMarkdownResponse("token", {
      object: "page_markdown",
      id: "page-id",
      markdown: 'michael onboarding\n\t<unknown id="child-block"/>',
      truncated: false,
      unknown_block_ids: ["child-block"],
    });

    // The hydrated subtree is present and the result is already canonical
    // (re-canonicalizing is a no-op — no drift).
    expect(result.markdown).toContain("- notion doc");
    expect(result.markdown).toContain(
      "- access: amplitude, fullstory, sigma, jira",
    );
    expect(result.markdown).toContain("michael onboarding");
    expect(result.markdown).not.toContain("<unknown");
    expect(canonicalizeNfm(result.markdown)).toBe(result.markdown);
  });

  it("hydrates indented toggle subtrees without creating code-block HTML", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: "page_markdown",
          id: "child-block",
          markdown:
            "<details>\n<summary>agents doing</summary>\n\tChild\n</details>",
          truncated: false,
          unknown_block_ids: [],
        } satisfies NotionPageMarkdown),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await resolveNotionMarkdownResponse("token", {
      object: "page_markdown",
      id: "page-id",
      markdown: 'Skill functionality\n\t<unknown id="child-block"/>',
      truncated: false,
      unknown_block_ids: ["child-block"],
    });
    const editorMarkdown = parseNfmForEditor(result.markdown);

    expect(result.markdown).toContain("\t<details>");
    expect(editorMarkdown).toContain('<details data-nfm-indent="1">');
    expect(editorMarkdown).toContain("<summary>agents doing</summary>");
    expect(editorMarkdown).not.toMatch(/^\t<details/m);
    expect(editorMarkdown).not.toMatch(/^ {4}<details/m);
  });
});

describe("notionFetch", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("throws immediately on a 429 whose Retry-After exceeds the cap, without sleeping", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "120", "Content-Type": "application/json" },
      }),
    );

    const promise = notionFetch("/pages/x", "token").catch((e) => e);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeInstanceOf(NotionApiError);
    expect((result as InstanceType<typeof NotionApiError>).status).toBe(429);
    // Only the single initial call — never slept/retried for the huge value.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries after a short Retry-After and then succeeds", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "retry-after": "2", "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "page-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const promise = notionFetch("/pages/x", "token");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ id: "page-1" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("treats a non-numeric (e.g. HTTP-date) Retry-After as the 1s default and retries", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: {
            "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT",
            "Content-Type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "page-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const promise = notionFetch("/pages/x", "token");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ id: "page-1" });
  });

  it("passes an AbortSignal so a hung request cannot block forever", async () => {
    vi.mocked(global.fetch).mockImplementation(async (_url, init) => {
      expect((init as RequestInit)?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await notionFetch("/pages/x", "token");
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe("getNotionConnectionForOwner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not expose a deploy-level NOTION_API_KEY as a user connection", async () => {
    vi.stubEnv("NOTION_API_KEY", "deploy-notion-key");
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValueOnce([]);

    await expect(
      getNotionConnectionForOwner("alice@example.com"),
    ).resolves.toBe(null);
    expect(listOAuthAccountsByOwner).toHaveBeenCalledWith(
      "notion",
      "alice@example.com",
    );
  });

  it("returns only the owner-scoped OAuth token when one is connected", async () => {
    vi.stubEnv("NOTION_API_KEY", "deploy-notion-key");
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValueOnce([
      {
        accountId: "alice-workspace",
        displayName: "Alice Workspace",
        tokens: {
          access_token: "alice-token",
          workspace_id: "workspace-a",
          workspace_name: "Alice Workspace",
        },
      },
    ]);

    await expect(
      getNotionConnectionForOwner("alice@example.com"),
    ).resolves.toMatchObject({
      accountId: "alice-workspace",
      accessToken: "alice-token",
      workspaceId: "workspace-a",
      workspaceName: "Alice Workspace",
    });
  });
});

describe("saveNotionTokensForOwner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes other Notion accounts for the same owner, keeping single-connection semantics", async () => {
    vi.mocked(saveOAuthTokens).mockResolvedValue(undefined as any);
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValueOnce([
      { accountId: "workspace-a", displayName: null, tokens: {} } as any,
      { accountId: "workspace-b", displayName: null, tokens: {} } as any,
    ]);
    vi.mocked(deleteOAuthTokens).mockResolvedValue(1);

    await saveNotionTokensForOwner("alice@example.com", {
      access_token: "new-token",
      workspace_id: "workspace-b",
    });

    expect(saveOAuthTokens).toHaveBeenCalledWith(
      "notion",
      "workspace-b",
      expect.objectContaining({ access_token: "new-token" }),
      "alice@example.com",
    );
    // The just-saved account must NOT be deleted; the other one must be.
    expect(deleteOAuthTokens).toHaveBeenCalledWith("notion", "workspace-a");
    expect(deleteOAuthTokens).not.toHaveBeenCalledWith("notion", "workspace-b");
  });
});

describe("createNotionPageWithMarkdown", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("sends canonical Notion-flavored markdown (toggles, lists, dividers)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "new-page",
          url: "https://www.notion.so/new-page",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const content = [
      "<details>",
      "<summary>→ → team mtg guidance on hackathon</summary>",
      "\tInside the toggle",
      "</details>",
      "- parent",
      "\t- child",
      "above",
      "---",
      "below",
    ].join("\n");

    await createNotionPageWithMarkdown({
      accessToken: "token",
      parentPageId: "parent-page",
      title: "Builder Todo",
      content,
    });

    const request = vi.mocked(global.fetch).mock.calls[0];
    expect(request[0]).toBe("https://api.notion.com/v1/pages");
    const body = JSON.parse(String(request[1]?.body));
    // The pushed markdown is exactly the canonical form — and canonical content
    // is already a fixpoint, so this push will round-trip without drift.
    expect(body.markdown).toBe(canonicalizeNfm(content));
    expect(canonicalizeNfm(body.markdown)).toBe(body.markdown);
    expect(body.markdown).toContain("- parent\n\t- child");
    expect(body.markdown).toContain(
      "<summary>→ → team mtg guidance on hackathon</summary>",
    );
  });
});

describe("listNotionComments", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("follows has_more/next_cursor to collect comments across pages", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "c1",
                rich_text: [{ plain_text: "first" }],
                created_time: "t",
                created_by: { id: "u1" },
              },
            ],
            has_more: true,
            next_cursor: "cursor-2",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "c2",
                rich_text: [{ plain_text: "second" }],
                created_time: "t",
                created_by: { id: "u1" },
              },
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const comments = await listNotionComments("page-1", "token");

    expect(comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    const secondRequestUrl = String(vi.mocked(global.fetch).mock.calls[1]?.[0]);
    expect(secondRequestUrl).toContain("start_cursor=cursor-2");
  });

  it("rethrows a 401 instead of returning an empty list", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(listNotionComments("page-1", "token")).rejects.toBeInstanceOf(
      NotionApiError,
    );
  });

  it("rethrows a 403 (missing capability) instead of returning an empty list", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(listNotionComments("page-1", "token")).rejects.toBeInstanceOf(
      NotionApiError,
    );
  });
});

describe("addNotionComment", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("rethrows a 401 instead of returning null", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      addNotionComment("page-1", "hello", "token"),
    ).rejects.toBeInstanceOf(NotionApiError);
  });

  it("still returns the created comment id on success", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ id: "comment-1", discussion_id: "discussion-1" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(addNotionComment("page-1", "hello", "token")).resolves.toEqual(
      { id: "comment-1", discussionId: "discussion-1" },
    );
  });

  it("sends parent (not discussion_id) for a new top-level comment", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ id: "comment-1", discussion_id: "discussion-1" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await addNotionComment("page-1", "hello", "token");

    const request = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(request[1]?.body));
    expect(body).toEqual({
      parent: { page_id: "page-1" },
      rich_text: [{ text: { content: "hello" } }],
    });
  });

  it("sends discussion_id (not parent) for a reply, so it threads under the existing discussion", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ id: "comment-2", discussion_id: "discussion-1" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await addNotionComment(
      "page-1",
      "a reply",
      "token",
      "discussion-1",
    );

    const request = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(String(request[1]?.body));
    expect(body).toEqual({
      discussion_id: "discussion-1",
      rich_text: [{ text: { content: "a reply" } }],
    });
    expect(body.parent).toBeUndefined();
    expect(result).toEqual({ id: "comment-2", discussionId: "discussion-1" });
  });
});
