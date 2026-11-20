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
        '<LinkCard id="x" app="design" url={"javascript:alert(1)"} />',
      ),
    ).toBeNull();
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
});
