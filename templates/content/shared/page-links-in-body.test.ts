import { describe, expect, it } from "vitest";

import {
  mayHoldPageLinks,
  notionPageLinkTarget,
  PAGE_LINKS_MAX_PER_PAGE,
  pageIdFromHref,
  pageLinkReferencesInBody,
} from "./page-links-in-body";

const NOTION_KEY = "0123456789abcdef0123456789abcdef";

const NOTION_TARGET = notionPageLinkTarget(NOTION_KEY);

const DASHED = `${NOTION_KEY.slice(0, 8)}-${NOTION_KEY.slice(8, 12)}-${NOTION_KEY.slice(12, 16)}-${NOTION_KEY.slice(16, 20)}-${NOTION_KEY.slice(20)}`;

function targets(body: string | null | undefined): string[] {
  return pageLinkReferencesInBody(body).map((reference) => reference.target);
}

describe("pageIdFromHref", () => {
  it.each([
    ["/page/target", "target"],
    ["/page/target/", "target"],
    ["/p/target", "target"],
    ["https://content.example.test/page/target", "target"],
    ["https://content.example.test/workspace/page/target?view=1", "target"],
    ["/page/with%20space", "with space"],
    ["/_agent-native/open?documentId=target", "target"],
    ["/_agent-native/open?app=content&documentId=target", "target"],
  ])("reads %s as %s", (href, id) => {
    expect(pageIdFromHref(href)).toBe(id);
  });

  it.each([
    "//other.example.test/page/target",
    "page/target",
    "mailto:someone@example.test",
    "https://content.example.test/pages",
    "/_agent-native/open?app=mail&documentId=target",
    "/page/%E0%A4%A",
    "",
  ])("names no page in %s", (href) => {
    expect(pageIdFromHref(href)).toBeNull();
  });

  it("names no page for a value that isn't text", () => {
    expect(pageIdFromHref(undefined)).toBeNull();
    expect(pageIdFromHref(42)).toBeNull();
  });
});

describe("pageLinkReferencesInBody", () => {
  it("finds links, sub-page and link-to-page blocks, and page mentions, once each", () => {
    const body = [
      "# Notes",
      "See [the plan](/page/plan) and [the plan again](https://content.example.test/page/plan).",
      '<page id="child">Child</page>',
      `Ask <mention-page url="https://www.notion.so/Imported-${NOTION_KEY}">Imported</mention-page> too.`,
      "- [a list item](/p/published)",
    ].join("\n\n");

    expect(targets(body).sort()).toEqual(
      ["child", NOTION_TARGET, "plan", "published"].sort(),
    );
  });

  it("reads Notion links as Notion page ids, in either form", () => {
    const body = [
      `See [the plan](https://www.notion.so/team/The-Plan-${NOTION_KEY}).`,
      `And [the site](https://team.notion.site/${DASHED}).`,
      "[Not Notion](https://example.test/0123456789abcdef0123456789abcdef)",
    ].join("\n\n");

    expect(targets(body)).toEqual([NOTION_TARGET]);
  });

  it("reads Notion links whatever the host's case or port", () => {
    const body = [
      `[Plan](https://WWW.NOTION.SO/team/Plan-${NOTION_KEY})`,
      `[Site](https://Team.Notion.Site:443/${DASHED})`,
    ].join("\n\n");

    expect(mayHoldPageLinks(body)).toBe(true);
    expect(targets(body)).toEqual([NOTION_TARGET]);
  });

  it("keeps a page id that looks like a Notion id as the page's own id", () => {
    const body = [
      `[Page](/page/${DASHED})`,
      `<page data-agent-native-document-id="${NOTION_KEY}">Child</page>`,
    ].join("\n\n");

    expect(targets(body)).toEqual([DASHED, NOTION_KEY]);
  });

  it("reads a sub-page block's id as a page id and as a Notion page id", () => {
    expect(targets(`<page id="${DASHED}">Child</page>`)).toEqual([
      DASHED,
      NOTION_TARGET,
    ]);
  });

  it("marks the ids that only a full URL names", () => {
    const body = [
      "[Relative](/page/relative)",
      "[Elsewhere](https://blog.example.test/p/post)",
      "[Both](https://content.example.test/page/both) and [both](/page/both)",
      '<mention-page url="https://content.example.test/page/mentioned">M</mention-page>',
      `[Notion](https://www.notion.so/${NOTION_KEY})`,
    ].join("\n\n");

    expect(pageLinkReferencesInBody(body)).toEqual([
      { target: "relative", outside: false },
      { target: "post", outside: true },
      { target: "both", outside: false },
      { target: "mentioned", outside: false },
      { target: NOTION_TARGET, outside: false },
    ]);
  });

  it("leaves out page paths that aren't links", () => {
    const body = [
      "The path `/page/in-code` is only text.",
      "```",
      "[not a link](/page/in-fence)",
      "```",
    ].join("\n\n");

    expect(targets(body)).toEqual([]);
  });

  it("finds nothing in a body with no page links", () => {
    expect(targets("Plain [web](https://example.test) link")).toEqual([]);
    expect(targets("")).toEqual([]);
    expect(targets(null)).toEqual([]);
  });

  it("keeps at most the per-page limit", () => {
    const body = Array.from(
      { length: PAGE_LINKS_MAX_PER_PAGE + 5 },
      (_, index) => `[p${index}](/page/p${index})`,
    ).join("\n\n");

    expect(targets(body)).toHaveLength(PAGE_LINKS_MAX_PER_PAGE);
  });
});

describe("mayHoldPageLinks", () => {
  it("is false for a body that can't hold a page link", () => {
    expect(mayHoldPageLinks("No links here")).toBe(false);
    expect(mayHoldPageLinks(undefined)).toBe(false);
  });

  it("is true for each kind of page link", () => {
    for (const body of [
      "[a](/page/a)",
      "[a](/p/a)",
      "[a](/_agent-native/open?documentId=a)",
      '<page id="a">A</page>',
      '<mention-page url="x">A</mention-page>',
      "[a](https://www.notion.so/a)",
      "[a](https://team.notion.site/a)",
      "[a](https://WWW.NOTION.SO/a)",
    ]) {
      expect(mayHoldPageLinks(body)).toBe(true);
    }
  });
});
