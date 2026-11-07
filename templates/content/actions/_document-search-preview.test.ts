import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db/index.js", () => ({ schema: {} }));

const { documentSearchPreview, findSearchMatch } =
  await import("./_document-search-preview.js");

const filler = (length: number) => "x".repeat(length);

describe("findSearchMatch", () => {
  it("finds one word's first occurrence, whatever its case", () => {
    expect(findSearchMatch("One TWO two", ["two"])).toEqual({
      position: 4,
      needle: "two",
    });
  });

  it("returns nothing when no word is on the page", () => {
    expect(findSearchMatch("one two", ["three", "four"])).toBeNull();
  });

  it("prefers a later passage with every word over an earlier one with some", () => {
    const body = `alpha ${filler(1000)} beta ${filler(1000)} alpha beta`;

    expect(findSearchMatch(body, ["alpha", "beta"])?.position).toBe(
      body.lastIndexOf("alpha"),
    );
  });

  it("finds words together in any order", () => {
    const body = `${filler(50)} beta and alpha`;

    expect(findSearchMatch(body, ["alpha", "beta"])).toEqual({
      position: body.indexOf("beta"),
      needle: "beta",
    });
  });

  it("finds a passage however many times its words appear alone before it", () => {
    const body = `${"alpha ".repeat(3000)}${filler(500)} beta ${filler(500)} alpha beta`;

    expect(findSearchMatch(body, ["alpha", "beta"])?.position).toBe(
      body.lastIndexOf("alpha"),
    );
  });

  it("takes the earliest passage when none has every word", () => {
    const body = `${filler(10)} alpha ${filler(500)} beta ${filler(500)} gamma`;

    expect(findSearchMatch(body, ["gamma", "beta", "alpha"])).toEqual({
      position: 11,
      needle: "alpha",
    });
  });

  it("keeps words further apart than a passage out of it", () => {
    const body = `alpha ${filler(241)} beta`;

    expect(findSearchMatch(body, ["beta", "alpha"])).toEqual({
      position: 0,
      needle: "alpha",
    });
  });

  it("names the word earliest in the query when two start at one place", () => {
    expect(findSearchMatch("alphabet", ["alphabet", "alpha"])?.needle).toBe(
      "alphabet",
    );
    expect(findSearchMatch("alphabet", ["alpha", "alphabet"])?.needle).toBe(
      "alpha",
    );
  });

  it("matches a phrase across any whitespace", () => {
    const body = "start exact\n\n  phrase end";

    expect(findSearchMatch(body, ["exact phrase"])?.position).toBe(6);
  });

  it("reads a phrase too long for a regular expression literally", () => {
    const phrase = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(" ");

    expect(findSearchMatch(`start ${phrase}`, [phrase])?.position).toBe(6);
  });

  it("treats text a query could read as a pattern literally", () => {
    expect(findSearchMatch("costs a.b c and axb c", ["a.b c"])?.position).toBe(
      6,
    );
  });

  it("keeps positions in the page when lower case changes a character's length", () => {
    const body = "İİİ alpha";

    expect(findSearchMatch(body, ["alpha"])?.position).toBe(4);
  });
});

describe("documentSearchPreview", () => {
  it("shows the top of the page without a match", () => {
    const preview = documentSearchPreview("Just the first line.", []);

    expect(preview).toEqual({
      snippet: "Just the first line.",
      contentLength: 20,
    });
  });

  it("shows the passage around a match deep in a page", () => {
    const body = `${"lead ".repeat(4000)}the deep marker here${" tail".repeat(4000)}`;

    const { snippet, contentLength } = documentSearchPreview(body, ["marker"]);

    expect(snippet).toContain("the deep marker here");
    expect(snippet.startsWith("...")).toBe(true);
    expect(snippet.endsWith("...")).toBe(true);
    expect(contentLength).toBe(body.length);
  });

  it("counts characters the way Array.from does, and never splits one", () => {
    const emoji = "🙂";
    const body = `${emoji.repeat(500)} marker ${emoji.repeat(500)}`;

    const { snippet, contentLength } = documentSearchPreview(body, ["marker"]);

    expect(contentLength).toBe(Array.from(body).length);
    expect(snippet).toContain("marker");
    expect(snippet).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(snippet).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });

  it("drops the rest of a comment the match window starts inside", () => {
    const comment = `<!-- private ${filler(1000)} -->`;
    const body = `${comment}\n\nPublic words with marker here.`;

    const { snippet } = documentSearchPreview(body, ["marker"]);

    expect(snippet).toContain("words with marker here.");
    expect(snippet).not.toContain("private");
  });

  it("counts a comment marker too far back to read as one", () => {
    const body = `<!-- ${filler(30_000)} marker`;

    expect(documentSearchPreview(body, ["marker"]).snippet).toBe("");
  });

  it("ignores a comment that closed before the match", () => {
    const body = `<!-- closed -->${filler(1000)} marker words`;

    expect(documentSearchPreview(body, ["marker"]).snippet).toContain(
      "marker words",
    );
  });
});
