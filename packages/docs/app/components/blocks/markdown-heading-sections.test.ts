import { describe, expect, it } from "vitest";

import { splitMarkdownHeadingSections } from "./markdown-heading-sections";

describe("splitMarkdownHeadingSections", () => {
  it("splits on ### headings outside of code fences", () => {
    const sections = splitMarkdownHeadingSections(
      ["### First", "", "Body one.", "", "### Second", "", "Body two."].join(
        "\n",
      ),
    );

    expect(sections).toEqual([
      { title: "First", body: "Body one." },
      { title: "Second", body: "Body two." },
    ]);
  });

  it("does not split on ### that appears inside a fenced code block", () => {
    const sections = splitMarkdownHeadingSections(
      [
        "### Writing headings",
        "",
        "Use `###` for a level-3 heading, for example:",
        "",
        "```md",
        "### Not a real section",
        "some body text",
        "```",
        "",
        "### Next item",
        "",
        "Body.",
      ].join("\n"),
    );

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Writing headings");
    expect(sections[0].body).toContain("### Not a real section");
    expect(sections[1].title).toBe("Next item");
    expect(sections[1].body).toBe("Body.");
  });

  it("does not close a 4-backtick fence on a 3-backtick line inside it", () => {
    const sections = splitMarkdownHeadingSections(
      [
        "### Writing headings",
        "",
        "````md",
        "```md",
        "### Not a real section",
        "```",
        "````",
        "",
        "### Next item",
        "",
        "Body.",
      ].join("\n"),
    );

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Writing headings");
    expect(sections[0].body).toContain("### Not a real section");
    expect(sections[1].title).toBe("Next item");
    expect(sections[1].body).toBe("Body.");
  });

  it("does not close a backtick fence on a tilde line inside it", () => {
    const sections = splitMarkdownHeadingSections(
      [
        "### Writing headings",
        "",
        "```md",
        "~~~",
        "### Not a real section",
        "~~~",
        "```",
        "",
        "### Next item",
        "",
        "Body.",
      ].join("\n"),
    );

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Writing headings");
    expect(sections[0].body).toContain("### Not a real section");
    expect(sections[1].title).toBe("Next item");
    expect(sections[1].body).toBe("Body.");
  });

  it("does not close a fence on a shorter run of the same character", () => {
    const sections = splitMarkdownHeadingSections(
      [
        "### Writing headings",
        "",
        "````md",
        "some code",
        "```",
        "### Not a real section",
        "````",
        "",
        "### Next item",
        "",
        "Body.",
      ].join("\n"),
    );

    expect(sections).toHaveLength(2);
    expect(sections[0].body).toContain("### Not a real section");
    expect(sections[1].title).toBe("Next item");
  });

  it("parses an item with a genuinely empty body", () => {
    const sections = splitMarkdownHeadingSections(
      ["### First", "", "Body.", "", "### Last"].join("\n"),
    );

    expect(sections).toEqual([
      { title: "First", body: "Body." },
      { title: "Last", body: "" },
    ]);
  });

  it("round-trips serialize -> parse for an empty-body last item", () => {
    // Mirrors what `serializeAccordionToMarkdown` (and its Steps/Cards/
    // Comparison siblings) produce for `{ title: "Last", body: "" }`:
    // `### Last\n\n` with nothing after — this used to get silently
    // dropped because the old regex required a literal `\n` after the title.
    const serialized = "### First\n\nBody.\n\n### Last\n\n";

    expect(splitMarkdownHeadingSections(serialized)).toEqual([
      { title: "First", body: "Body." },
      { title: "Last", body: "" },
    ]);
  });
});
