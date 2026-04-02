import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveNotionMarkdownResponse,
  type NotionPageMarkdown,
} from "./notion";
import { normalizeNfmForStorage } from "../../shared/notion-markdown";

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
});
