import { describe, expect, it } from "vitest";

import { designBriefsFromData, designBriefsSchema } from "./design-briefs";

const brief = {
  source: "content",
  id: "page-example",
  url: "https://content.example.com/_agent-native/open?documentId=page-example",
} as const;

describe("design briefs", () => {
  it("reads briefs from serialized or parsed design data", () => {
    expect(designBriefsFromData(JSON.stringify({ briefs: [brief] }))).toEqual([
      brief,
    ]);
    expect(designBriefsFromData({ briefs: [brief], other: true })).toEqual([
      brief,
    ]);
  });

  it("drops malformed briefs and links that are not http(s)", () => {
    expect(
      designBriefsFromData({
        briefs: [
          brief,
          { ...brief, url: "javascript:alert(1)" },
          { ...brief, url: "/relative" },
          { ...brief, id: "" },
          "not a brief",
        ],
      }),
    ).toEqual([brief]);
  });

  it("treats missing or unreadable data as no briefs", () => {
    expect(designBriefsFromData(null)).toEqual([]);
    expect(designBriefsFromData("{not json")).toEqual([]);
    expect(designBriefsFromData({ briefs: "nope" })).toEqual([]);
  });

  it("keeps a brief's id and link, never the page title", () => {
    expect(
      designBriefsFromData({ briefs: [{ ...brief, title: "Private plan" }] }),
    ).toEqual([brief]);
  });

  it("caps how many briefs a design records", () => {
    expect(designBriefsSchema.safeParse(Array(6).fill(brief)).success).toBe(
      false,
    );
  });
});
