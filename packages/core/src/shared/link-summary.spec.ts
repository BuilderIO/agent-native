import { describe, expect, it } from "vitest";

import {
  LINK_SUMMARY_PARAM_CHARS,
  linkSummaryItemFromPath,
  linkSummaryItemFromUrl,
  linkSummaryResultSchema,
  parseLinkSummaryUrl,
} from "./link-summary.js";

describe("linkSummaryItemFromPath", () => {
  it.each([
    ["design", "/design/abc_123", "design"],
    ["design", "/present/abc_123", "present"],
    ["design", "/visual-edit/abc_123", "visual-edit"],
    ["slides", "/deck/deck-1-x", "deck"],
    ["slides", "/deck/deck-1-x/present", "deck"],
    ["slides", "/p/deck-1-x", "p"],
    ["clips", "/r/rec_1", "r"],
    ["clips", "/share/rec_1", "share"],
    ["clips", "/embed/rec_1", "embed"],
    ["content", "/page/Ixq7NbGOAI4w", "page"],
  ] as const)("reads a %s item from %s", (app, path, route) => {
    expect(linkSummaryItemFromPath(app, path)).toEqual({
      app,
      id: path.split("/")[2],
      route,
    });
  });

  it.each([
    ["design", "/settings"],
    ["design", "/design"],
    ["design", "/deck/abc"],
    ["design", "/design/abc/extra"],
    ["slides", "/deck/abc/edit"],
    ["slides", "/p/abc/present"],
    ["clips", "/r/a%2Fb"],
    ["content", "/p/abc"],
    ["content", "/page/abc/edit"],
    ["content", "/_agent-native/open"],
    ["clips", "/r/../share"],
    ["clips", `/r/${"x".repeat(129)}`],
  ] as const)("names no %s item for %s", (app, path) => {
    expect(linkSummaryItemFromPath(app, path)).toBeNull();
  });
});

describe("linkSummaryItemFromUrl", () => {
  const appUrls = {
    design: ["https://design.example.com"],
    slides: ["https://workspace.example.com/slides"],
    clips: ["http://localhost:8094"],
  };

  it("routes a link by its app's origin and mount path", () => {
    expect(
      linkSummaryItemFromUrl("https://design.example.com/design/d1", appUrls),
    ).toEqual({ app: "design", id: "d1", route: "design" });
    expect(
      linkSummaryItemFromUrl(
        "https://workspace.example.com/slides/deck/k1?slide=2#top",
        appUrls,
      ),
    ).toEqual({ app: "slides", id: "k1", route: "deck" });
    expect(
      linkSummaryItemFromUrl("http://localhost:8094/share/c1", appUrls),
    ).toEqual({ app: "clips", id: "c1", route: "share" });
  });

  it("names nothing outside the apps, their mounts, or their item pages", () => {
    for (const link of [
      "https://evil.example.com/design/d1",
      "https://workspace.example.com/deck/k1",
      "https://workspace.example.com/slidesx/deck/k1",
      "https://design.example.com/templates",
      "javascript:alert(1)",
      "https://user:pass@design.example.com/design/d1",
      "not a link",
    ]) {
      expect(linkSummaryItemFromUrl(link, appUrls)).toBeNull();
    }
  });
});

describe("parseLinkSummaryUrl", () => {
  it("takes http(s) links without credentials only", () => {
    expect(parseLinkSummaryUrl(" https://a.example.com/x ")?.href).toBe(
      "https://a.example.com/x",
    );
    expect(parseLinkSummaryUrl("ftp://a.example.com/x")).toBeNull();
    expect(parseLinkSummaryUrl("https://u@a.example.com/x")).toBeNull();
    expect(
      parseLinkSummaryUrl(`https://a.example.com/${"x".repeat(2048)}`),
    ).toBeNull();
  });
});

describe("a link that may let its holder in", () => {
  const clip = "https://clips.example.com/share/c1";

  it.each([
    "?agent_access=fake",
    "?t=90&agent_access=fake",
    "?token=fake",
    "?accessToken=fake",
    "?X-Amz-Signature=fake",
    "?sig=fake",
    "?password=fake",
    "?api-key=fake",
    "?code=fake",
    "?session=fake",
    "?ticket=fake",
    "?content_grant=fake",
    "#access_token=fake",
    "#/view?token=fake",
    `?t=${"x".repeat(LINK_SUMMARY_PARAM_CHARS + 1)}`,
    `?${"x".repeat(LINK_SUMMARY_PARAM_CHARS + 1)}`,
    `#${"x".repeat(LINK_SUMMARY_PARAM_CHARS + 1)}`,
  ])("is no link to summarize: %s", (suffix) => {
    expect(parseLinkSummaryUrl(`${clip}${suffix}`)).toBeNull();
    expect(
      linkSummaryItemFromUrl(`${clip}${suffix}`, {
        clips: ["https://clips.example.com"],
      }),
    ).toBeNull();
  });

  it.each([
    "?t=1m30s&panel=comments",
    "?screen=pay&zoom=80&selection=node_1&editorView=single&tool=move",
    "?slide=4&mode=view&presenter=1",
    "?design=launch",
    "#top",
  ])("keeps the view settings these apps put in a link: %s", (suffix) => {
    expect(parseLinkSummaryUrl(`${clip}${suffix}`)?.href).toBe(
      `${clip}${suffix}`,
    );
  });
});

describe("linkSummaryResultSchema", () => {
  const summaryOf = (app: string, kind: string) => ({
    status: "available",
    app,
    kind,
    title: "Launch brief",
    url: `https://${app}.example.com/item/i1`,
  });

  it.each([
    ["design", "design"],
    ["slides", "deck"],
    ["clips", "recording"],
    ["content", "page"],
  ])("takes a %s answer about a %s", (app, kind) => {
    const result = { summaries: [summaryOf(app, kind)] };
    expect(linkSummaryResultSchema.parse(result)).toEqual(result);
  });

  it.each([
    ["mail", "page"],
    ["content", "email"],
    ["", "page"],
    ["content", ""],
  ])("refuses an answer from app %j about kind %j", (app, kind) => {
    expect(
      linkSummaryResultSchema.safeParse({ summaries: [summaryOf(app, kind)] })
        .success,
    ).toBe(false);
  });

  it("refuses an unavailable answer that carries anything else", () => {
    expect(
      linkSummaryResultSchema.safeParse({
        summaries: [{ status: "unavailable", title: "Private plan" }],
      }).success,
    ).toBe(false);
  });

  it("refuses an available answer with extra fields", () => {
    expect(
      linkSummaryResultSchema.safeParse({
        summaries: [
          {
            status: "available",
            app: "design",
            kind: "design",
            title: "Launch page",
            url: "https://design.example.com/design/d1",
            owner: "someone@example.com",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
