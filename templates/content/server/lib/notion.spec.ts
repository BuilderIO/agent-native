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
  resolveNotionMarkdownResponse,
  type NotionPageMarkdown,
} from "./notion";
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

  it("hydrates indented list subtrees without creating code-block indentation", async () => {
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
    const editorMarkdown = parseNfmForEditor(result.markdown);

    expect(result.markdown).toContain("\t- notion doc");
    expect(editorMarkdown).toContain("> - notion doc");
    expect(editorMarkdown).toContain(
      "> - access: amplitude, fullstory, sigma, jira",
    );
    expect(editorMarkdown).not.toMatch(/^ {4,}- /m);
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

  it("sends Notion-normalized markdown for toggles, lists, and dividers", async () => {
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

    await createNotionPageWithMarkdown({
      accessToken: "token",
      parentPageId: "parent-page",
      title: "Builder Todo",
      content: [
        '<details open="" data-heading-level="2">',
        "<summary>→ → team mtg guidance on hackathon</summary>",
        "</details>",
        "",
        "- parent",
        "    - child",
        "above",
        "---",
        "below",
      ].join("\n"),
    });

    const request = vi.mocked(global.fetch).mock.calls[0];
    expect(request[0]).toBe("https://api.notion.com/v1/pages");
    const body = JSON.parse(String(request[1]?.body));
    expect(body.markdown).toContain(
      [
        "<details>",
        "<summary>→ → team mtg guidance on hackathon</summary>",
        "\t<empty-block/>",
        "</details>",
      ].join("\n"),
    );
    expect(body.markdown).toContain("- parent\n\t- child");
    expect(body.markdown).toContain("above\n\n---\n\nbelow");
    expect(body.markdown).not.toContain("data-heading-level");
    expect(body.markdown).not.toContain("open=");
  });
});
