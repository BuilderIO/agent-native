import { describe, expect, it } from "vitest";

import { buildDocumentExport } from "./document-export";
import {
  linkCardBlockRaw,
  linkCardDataFromRaw,
  linkCardsAsPlainLinks,
} from "./link-card-block";
import { docToNfm, nfmToDoc } from "./nfm";
import { parseRegistryBlockData } from "./nfm-registry";

const PLAIN = "https://design.example.test/design/launch_1";
const QUERY = "https://slides.example.test/deck/q3?slide=4&mode=view";

describe("link card source", () => {
  it.each([PLAIN, QUERY])(
    "stores only the app and the link, and reads back from %s",
    async (url) => {
      const raw = linkCardBlockRaw("link-card-1", { app: "design", url });
      expect(raw).not.toMatch(/title|summary/);
      expect(linkCardDataFromRaw(raw)).toEqual({ app: "design", url });
      await expect(parseRegistryBlockData(raw)).resolves.toMatchObject({
        type: "link-card",
        data: { app: "design", url },
      });
    },
  );

  it("round-trips through the page body unchanged", () => {
    const raw = linkCardBlockRaw("link-card-1", { app: "clips", url: QUERY });
    const doc = nfmToDoc(`Intro\n\n${raw}\n\nAfter`);
    expect(
      doc.content.find((node) => node.type === "registryBlock")?.attrs
        ?.blockType,
    ).toBe("link-card");
    const saved = docToNfm(doc);
    expect(saved).toContain(raw);
    expect(docToNfm(nfmToDoc(saved))).toBe(saved);
  });

  it("reads no card from another tag, an unknown app, or a non-web link", () => {
    expect(linkCardDataFromRaw('<ClipEmbed recordingId="abc" />')).toBeNull();
    expect(
      linkCardDataFromRaw(`<LinkCard id="x" app="mail" url="${PLAIN}" />`),
    ).toBeNull();
    expect(
      linkCardDataFromRaw(
        '<LinkCard id="x" app="content" url="https://content.example.test/page/launch" />',
      ),
    ).toBeNull();
    expect(
      linkCardDataFromRaw(
        '<LinkCard id="x" app="design" url={"javascript:alert(1)"} />',
      ),
    ).toBeNull();
  });
});

describe("a card's link", () => {
  it.each([
    "https://clips.example.test/share/rec_1?agent_access=fake",
    "https://clips.example.test/share/rec_1?t=90&token=fake",
    "https://clips.example.test/share/rec_1#access_token=fake",
    "https://user:fake@design.example.test/design/launch_1",
    "https://design.example.test/design/launch 1",
    "https://design.example.test/design/\nlaunch_1",
  ])("is refused when it carries a credential or a space: %s", async (url) => {
    const raw = linkCardBlockRaw("link-card-1", { app: "clips", url });
    expect(linkCardDataFromRaw(raw)).toBeNull();
    expect(linkCardsAsPlainLinks(raw)).toBe(raw);
  });
});

describe("link cards outside the editor", () => {
  const body = [
    "Intro",
    "",
    linkCardBlockRaw("link-card-1", { app: "design", url: PLAIN }),
    "",
    linkCardBlockRaw("link-card-2", { app: "slides", url: QUERY }),
    "",
    "```mdx",
    linkCardBlockRaw("link-card-3", { app: "design", url: PLAIN }),
    "```",
  ].join("\n");

  it("turns each card into its plain link and leaves code alone", () => {
    expect(linkCardsAsPlainLinks(body)).toBe(
      [
        "Intro",
        "",
        `[${PLAIN}](${PLAIN})`,
        "",
        `[${QUERY}](${QUERY})`,
        "",
        "```mdx",
        linkCardBlockRaw("link-card-3", { app: "design", url: PLAIN }),
        "```",
      ].join("\n"),
    );
  });

  it("reads a card's attributes in each MDX form, and nothing after the tag", () => {
    for (const tag of [
      `<LinkCard id='x' app='design' url='${PLAIN}' />`,
      `<LinkCard id="x" app={"design"} url={"${PLAIN}"} />`,
      `<LinkCard id="x" app="design" url="${PLAIN}" url="https://example.test/other" />`,
    ]) {
      expect(linkCardDataFromRaw(tag)).toEqual({ app: "design", url: PLAIN });
    }
    expect(
      linkCardDataFromRaw(
        `<LinkCard id="x" app="design" url="${PLAIN}" /> and more`,
      ),
    ).toBeNull();
    expect(
      linkCardDataFromRaw(`<LinkCards id="x" app="design" url="${PLAIN}" />`),
    ).toBeNull();
  });

  it("reads a card written over several lines, at any tab indent", () => {
    const tag = [
      "<LinkCard",
      '  id="link-card-6"',
      '  app="design"',
      `  url="${PLAIN}"`,
      "/>",
    ];
    const link = `[${PLAIN}](${PLAIN})`;
    expect(
      linkCardsAsPlainLinks(["Intro", ...tag, "", "After"].join("\n")),
    ).toBe(["Intro", link, "", "After"].join("\n"));
    expect(
      linkCardsAsPlainLinks(tag.map((line) => `\t\t${line}`).join("\n")),
    ).toBe(`\t\t${link}`);
    expect(linkCardsAsPlainLinks(`${tag.join("\r\n")}\r\nAfter`)).toBe(
      `${link}\nAfter`,
    );
    const doc = nfmToDoc(tag.join("\n"));
    expect(linkCardDataFromRaw(doc.content[0]?.attrs?.__raw)).toEqual({
      app: "design",
      url: PLAIN,
    });
  });

  it("leaves an unfinished tag as written, and what follows it", () => {
    const body = ["<LinkCard", '  app="design"', "", "# After", PLAIN].join(
      "\n",
    );
    expect(linkCardsAsPlainLinks(body)).toBe(body);
    expect(linkCardsAsPlainLinks(`${body}\n`)).toBe(`${body}\n`);
  });

  it("leaves a tag indented with spaces as written, as the page does", () => {
    const card = linkCardBlockRaw("link-card-7", { app: "design", url: PLAIN });
    for (const line of [`    ${card}`, ` ${card}`, `\t ${card}`]) {
      expect(linkCardsAsPlainLinks(line)).toBe(line);
      expect(
        nfmToDoc(line).content.some((node) => node.type === "registryBlock"),
      ).toBe(false);
    }
  });

  it("leaves a tag in a sentence, inline code, or any fence as written", () => {
    const card = linkCardBlockRaw("link-card-4", { app: "design", url: PLAIN });
    const untouched = [
      `See \`${card}\` for the source`,
      `A card: ${card}`,
      "~~~",
      "```",
      card,
      "~~~",
      "````md",
      "```",
      card,
      "````",
    ].join("\n");
    expect(linkCardsAsPlainLinks(untouched)).toBe(untouched);
    expect(linkCardsAsPlainLinks(`\t${card}`)).toBe(`\t[${PLAIN}](${PLAIN})`);
  });

  it("exports a card as a plain link in Markdown and HTML", () => {
    const markdown = buildDocumentExport({
      id: "doc_1",
      title: "Launch",
      content: body,
      format: "markdown",
    }).content;
    expect(markdown).toContain(`[${PLAIN}](${PLAIN})`);
    expect(markdown.split("<LinkCard").length).toBe(2);
    const html = buildDocumentExport({
      id: "doc_1",
      title: "Launch",
      content: body,
      format: "html",
    }).content;
    expect(html).toContain(`<a href="${PLAIN}">${PLAIN}</a>`);
  });

  it.each(["?filters[]=active", "?at=(1)", "?q=a\\b"])(
    "keeps a link with %s clickable in HTML exports",
    (suffix) => {
      const url = `${PLAIN}${suffix}`;
      const html = buildDocumentExport({
        id: "doc_1",
        title: "Launch",
        content: linkCardBlockRaw("link-card-8", { app: "design", url }),
        format: "html",
      }).content;
      const href = /<a href="([^"]+)">https[^<]+<\/a>/.exec(html)?.[1] ?? "";
      expect(decodeURIComponent(href)).toBe(url);
      expect(html).not.toContain("](");
    },
  );

  it("keeps the underscores in a card's link in HTML exports", () => {
    const url = "https://design.example.test/design/launch_1_b";
    const html = buildDocumentExport({
      id: "doc_1",
      title: "Launch",
      content: linkCardBlockRaw("link-card-5", { app: "design", url }),
      format: "html",
    }).content;
    expect(html).toContain(`<a href="${url}">${url}</a>`);
    expect(html).not.toContain("<em>");
  });
});
