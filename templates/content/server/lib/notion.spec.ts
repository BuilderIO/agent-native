import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/oauth-tokens", () => ({
  deleteOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: vi.fn(),
}));

import {
  createNotionPageWithMarkdown,
  getNotionConnectionForOwner,
  resolveNotionMarkdownResponse,
  type NotionPageMarkdown,
} from "./notion";
import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { canonicalizeNfm } from "../../shared/nfm";
import {
  normalizeNfmForStorage,
  parseNfmForEditor,
} from "../../shared/notion-markdown";

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
