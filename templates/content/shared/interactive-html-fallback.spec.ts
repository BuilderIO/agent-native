import { describe, expect, it } from "vitest";

import { contentBlockLinkPath } from "./block-link.js";
import { visitBlocksFieldBlocks } from "./blocks-field-identity.js";
import {
  builderBlocksToReadableMarkdown,
  builderMdxBodyToBuilderBlocks,
} from "./builder-mdx.js";
import {
  interactiveHtmlAsLinks,
  interactiveHtmlForNotion,
  keepInteractiveHtml,
} from "./interactive-html-fallback.js";
import {
  canonicalizeNotionNfm,
  docToNfm,
  nfmToDoc,
  notionMarkdownToNfm,
  soleLinkHref,
} from "./nfm.js";

const urlOf = (blockId: string | null) =>
  `https://content.example.com${contentBlockLinkPath("doc-1", blockId, { fullScreen: true })}`;
const url = ({ path }: { path: string }) => urlOf(`block-${path}`);

const block = (code: string) => `\`\`\`html interactive\n${code}\n\`\`\``;
const titled = (title: string) => block(`<title>${title}</title>`);

const COUNTER = "<title>Tap counter</title>\n<button>0</button>";

const BODY = [
  'Intro with **bold** and <mention-page url="https://www.notion.so/abc">A Page</mention-page>.',
  block(COUNTER),
  "```html",
  "<title>Plain code</title>",
  "```",
  '<callout icon="💡">',
  "\t```html interactive",
  "\t<p>Untitled</p>",
  "\t```",
  "</callout>",
  "- item",
].join("\n");

function linksByPath(markdown: string) {
  const links: Record<string, unknown> = {};
  visitBlocksFieldBlocks(nfmToDoc(markdown), (node, { path }) => {
    const href = soleLinkHref(node);
    if (href) links[path] = href;
  });
  return links;
}

describe("a body where blocks can't run", () => {
  it("has each block's caption linked to the block, and the rest untouched", () => {
    expect(interactiveHtmlAsLinks(BODY, url)).toBe(
      BODY.replace(
        block(COUNTER),
        `[Open “Tap counter”](${urlOf("block-1")})`,
      ).replace(
        "\t```html interactive\n\t<p>Untitled</p>\n\t```",
        `\t[Open the interactive block](${urlOf("block-3.0")})`,
      ),
    );
  });

  it("is the same body when it holds no block", () => {
    const body = "One\n\n```html\n<p>html interactive</p>\n```";

    expect(interactiveHtmlAsLinks(body, url)).toBe(body);
  });

  it("leaves a fence written inside another code block as text", () => {
    const body = ["````md", block(COUNTER), "````"].join("\n");

    expect(interactiveHtmlAsLinks(body, url)).toBe(body);
  });

  it("captions a block in plain words when its title reads as Markdown", () => {
    const linked = interactiveHtmlAsLinks(
      titled("[a](b) *c* snake_case `d` e\\f"),
      url,
    );

    expect(linked).toBe(
      `[Open “(a)(b) c snake case d e f”](${urlOf("block-0")})`,
    );
  });

  it("keeps a block's source whatever characters it uses", () => {
    const body = block("<p>\u{E000}0\u{E000}\u{E000}\u{E000}1\u{E000}</p>");
    const ids = { "0": "block-0" };
    const linked = interactiveHtmlAsLinks(`${body}\n\u{E000}`, url);

    expect(
      keepInteractiveHtml({
        local: body,
        incoming: linked,
        documentId: "doc-1",
        blockIds: ids,
      }),
    ).toBe(`${body}\n\u{E000}`);
  });

  it("reads a fence that never closes to the end", () => {
    expect(interactiveHtmlAsLinks("a\n```html interactive\n<p>", url)).toBe(
      `a\n[Open the interactive block](${urlOf("block-1")})`,
    );
  });

  it("finds a block indented with spaces under a list item", () => {
    const linked = interactiveHtmlAsLinks(
      [
        "- item",
        "  ```html interactive",
        "  <title>Nested</title>",
        "  ```",
        titled("After"),
      ].join("\n"),
      url,
    );

    expect(linked).not.toContain("html interactive");
    expect(linksByPath(linked)).toEqual({
      "0.0.1": urlOf("block-0.0.1"),
      "1": urlOf("block-1"),
    });
  });
});

describe("interactive HTML in Notion", () => {
  const pushed = interactiveHtmlForNotion(canonicalizeNotionNfm(BODY), url);
  const note = `<!-- Runs in Content: ${urlOf("block-1")} -->`;
  const link = `[Open “Tap counter”](${urlOf("block-1")})`;

  it("is its code, saying where it runs, with its link below", () => {
    expect(pushed).toContain(
      `\`\`\`html\n${note}\n${COUNTER}\n\`\`\`\n${link}`,
    );
    expect(pushed).not.toContain("html interactive");
  });

  it("comes back as the block", () => {
    expect(notionMarkdownToNfm(pushed)).toBe(canonicalizeNotionNfm(BODY));
    expect(notionMarkdownToNfm(pushed.replace(/&full/g, "&amp;full"))).toBe(
      canonicalizeNotionNfm(BODY),
    );
  });

  it("keeps what was edited in Notion", () => {
    expect(
      notionMarkdownToNfm(pushed.replace("<button>0<", "<button>1<")),
    ).toBe(canonicalizeNotionNfm(BODY.replace("<button>0<", "<button>1<")));
    expect(notionMarkdownToNfm(pushed.replace(link, "Text"))).toContain(
      `${block(COUNTER)}\nText`,
    );
  });

  it("stays code once it no longer says where it runs", () => {
    expect(notionMarkdownToNfm(pushed.replace(`${note}\n`, ""))).toContain(
      `\`\`\`html\n${COUNTER}\n\`\`\`\n${link}`,
    );
  });

  it.each(["- item", "1. item"])(
    "comes back inside the list item %s, indented with spaces",
    (item) => {
      const body = `${item}\n   ${block("<p>").split("\n").join("\n   ")}\nAfter`;
      const sent = interactiveHtmlForNotion(body, url);

      expect(notionMarkdownToNfm(canonicalizeNotionNfm(sent))).toBe(
        canonicalizeNotionNfm(body),
      );
    },
  );

  it("comes back once when part of its caption is bold", () => {
    const bold = link.replace("Tap counter", "**Tap** counter");

    expect(notionMarkdownToNfm(pushed.replace(link, bold))).toBe(
      canonicalizeNotionNfm(BODY),
    );
  });

  it("drops no link but its own", () => {
    const code = `\`\`\`html\n${note}\n${COUNTER}\n\`\`\``;
    const other = `[Open “Tap counter”](${urlOf("block-2")})`;

    expect(notionMarkdownToNfm(`${code}\n${other}`)).toBe(
      `${block(COUNTER)}\n${other}`,
    );
    expect(notionMarkdownToNfm(`${code}\nText\n${link}`)).toBe(
      `${block(COUNTER)}\nText\n${link}`,
    );
  });

  it("leaves code someone else wrote as code, whatever it links to", () => {
    const written = `\`\`\`html\n<p>\n\`\`\`\n${link}`;

    expect(notionMarkdownToNfm(written)).toBe(written);
  });
});

describe("a body read back from a service that keeps only the link", () => {
  const ids = { "1": "block-1", "3.0": "block-3.0" };
  const keep = (
    local: string,
    incoming: string,
    blockIds: Record<string, string>,
    documentId = "doc-1",
  ) => keepInteractiveHtml({ local, incoming, documentId, blockIds });

  it("has its blocks again wherever their links stand", () => {
    const linked = interactiveHtmlAsLinks(BODY, url);

    expect(keep(BODY, linked, ids)).toBe(BODY);
    expect(keep(BODY, linked.replace(/&full/g, "&amp;full"), ids)).toBe(BODY);
    expect(
      keep(
        BODY,
        `New first line\n${linked.replace("- item", "- changed")}`,
        ids,
      ),
    ).toBe(`New first line\n${BODY.replace("- item", "- changed")}`);
  });

  it("has its blocks again when Content is served under a path", () => {
    const linked = interactiveHtmlAsLinks(BODY, url);
    const underPath = linked.split("/page/").join("/apps/content/page/");

    expect(underPath).not.toBe(linked);
    expect(keep(BODY, underPath, ids)).toBe(BODY);
  });

  describe("with two blocks of the same title", () => {
    const first = block("<title>T</title>1");
    const second = block("<title>T</title>2");
    const local = `${first}\n${second}`;
    const twinIds = { "0": "block-0", "1": "block-1" };
    const linked = interactiveHtmlAsLinks(local, url).split("\n");

    it("gives each link its own block", () => {
      expect(keep(local, linked.join("\n"), twinIds)).toBe(local);
      expect(keep(local, [...linked].reverse().join("\n"), twinIds)).toBe(
        `${second}\n${first}`,
      );
      expect(keep(local, linked[1] ?? "", twinIds)).toBe(second);
    });

    it("guesses at neither when their links name no block", () => {
      const unnamed = interactiveHtmlAsLinks(local, () => urlOf(null));

      expect(keep(local, unnamed, twinIds)).toBe(unnamed);
    });
  });

  it("has a block again whose caption was reworded", () => {
    const caption = `[Try it](${urlOf("block-0")})`;

    expect(keep(block(COUNTER), caption, { "0": "block-0" })).toBe(
      block(COUNTER),
    );
  });

  it("finds a block by its caption when its ID is new or missing", () => {
    const local = `${block(COUNTER)}\n${titled("Other")}`;
    const linked = interactiveHtmlAsLinks(local, url);

    expect(keep(local, linked, {})).toBe(local);
    expect(keep(local, linked, { "0": "new-0", "1": "new-1" })).toBe(local);
  });

  it("has one copy of a block whose link was copied", () => {
    const caption = interactiveHtmlAsLinks(block(COUNTER), url);

    expect(
      keep(block(COUNTER), `${caption}\n${caption}`, { "0": "block-0" }),
    ).toBe(`${block(COUNTER)}\n${caption}`);
  });

  it("leaves a link inside a code example, or among other words, as it is", () => {
    const caption = interactiveHtmlAsLinks(block(COUNTER), url);
    const written = `\`\`\`md\n${caption}\n\`\`\`\nSee ${caption}`;

    expect(keep(block(COUNTER), written, { "0": "block-0" })).toBe(written);
    expect(
      keep(block(COUNTER), `${written}\n${caption}`, { "0": "block-0" }),
    ).toBe(`${written}\n${block(COUNTER)}`);
  });

  it.each([
    ["a quote", "> LINK"],
    ["a heading", "## LINK"],
    ["a list", "- LINK"],
    ["bold", "**LINK**"],
    ["a quote's lines", "> Before\n>\n> LINK\n>\n> After"],
  ])("has a block again whose caption became %s", (_place, written) => {
    const caption = interactiveHtmlAsLinks(block(COUNTER), url);
    const kept = keep(block(COUNTER), written.replace("LINK", caption), {
      "0": "block-0",
    });

    expect(kept).toContain(block(COUNTER));
    expect(kept).not.toContain("full=1");
    expect(docToNfm(nfmToDoc(kept))).toContain(block(COUNTER));
  });

  it("has a block again whose caption is partly bold", () => {
    const href = urlOf("block-0");

    for (const caption of [
      `[**Try** it](${href})`,
      `[**Try**](${href})[ it](${href})`,
    ]) {
      expect(keep(block(COUNTER), caption, { "0": "block-0" })).toBe(
        block(COUNTER),
      );
    }
  });

  it("leaves out a block whose link was deleted, and another page's link", () => {
    expect(keep(BODY, "Only text", ids)).toBe("Only text");
    const other = interactiveHtmlAsLinks(block(COUNTER), url);
    expect(keep(block(COUNTER), other, { "0": "block-0" }, "doc-2")).toBe(
      other,
    );
  });
});

describe("a body published to Builder", () => {
  const nestedUrl = ({ path }: { path: string }) =>
    urlOf(`docBlock_a_${path.replace(/\./g, "_")}`);
  const publish = async (body: string) =>
    builderMdxBodyToBuilderBlocks(interactiveHtmlAsLinks(body, nestedUrl), {});
  const readBack = async (body: string, blocks: unknown[]) => {
    const blockIds = Object.fromEntries(
      ["0", "1", "0.0.1", "0.1", "1.1"].map((path) => [
        path,
        `docBlock_a_${path.replace(/\./g, "_")}`,
      ]),
    );
    return keepInteractiveHtml({
      local: body,
      incoming: await builderBlocksToReadableMarkdown(blocks),
      documentId: "doc-1",
      blockIds,
    });
  };

  it.each([
    ["on its own", block(COUNTER), "1"],
    ["titled with brackets", titled("Pick [A] or _B_"), "1"],
    [
      "in a list",
      "- item\n\t```html interactive\n\t<p>1</p>\n\t```\n- next",
      "1.0.1",
    ],
    [
      "in a callout",
      '<callout icon="💡">\n\tTip\n\t```html interactive\n\t<p>1</p>\n\t```\n</callout>',
      "1.1",
    ],
  ])("links a block %s and has its source again", async (_name, body, path) => {
    const page = `Intro\n\n${body}`;
    const blocks = await publish(page);
    const stored = JSON.stringify(blocks);

    expect(stored).toContain(
      `<a href=\\"${nestedUrl({ path }).replace(/&/g, "&amp;")}\\">Open`,
    );
    expect(await readBack(page, blocks)).toContain("```html interactive\n");
  });
});
