import { describe, expect, it } from "vitest";

import {
  clipSuggestionPresentation,
  suggestionAnchorText,
  suggestionLinkDestinations,
  suggestionTextForDisplay,
  type SuggestionPresentationNode,
  suggestionTextPresentation,
  suggestionTextPresentationForSource,
} from "./suggestion-text";

function presentationText(nodes: SuggestionPresentationNode[]): string {
  return nodes
    .map((node) =>
      node.type === "lineBreak"
        ? "\n"
        : node.type === "text" ||
            node.type === "indent" ||
            node.type === "block"
          ? node.value
          : presentationText(node.children),
    )
    .join("");
}

describe("suggestion structural text", () => {
  it("renders supported NFM indentation explicitly", () => {
    expect(
      suggestionTextPresentationForSource("\t**Echo**", {
        source: "\t**Echo**",
        from: 0,
        to: 9,
      }),
    ).toEqual([
      { type: "indent", value: "⇥" },
      { type: "strong", children: [{ type: "text", value: "Echo" }] },
    ]);
  });
  it("presents an exact unbalanced source fragment with its enclosing marks", () => {
    const source = "**Prefix Upper**<br>**Lower suffix.**";
    const from = source.indexOf("Upper");
    const to = source.indexOf("Lower") + "Lower".length;
    expect(
      suggestionTextPresentationForSource(source.slice(from, to), {
        source,
        from,
        to,
      }),
    ).toEqual([
      { type: "strong", children: [{ type: "text", value: "Upper" }] },
      { type: "lineBreak" },
      { type: "strong", children: [{ type: "text", value: "Lower" }] },
    ]);
  });

  it("breaks lines beside text and keeps a lone break visible", () => {
    const source = "Alpha one.\nAlpha two.\n<empty-block/>\n- Item";
    const presentation = (from: number, to: number) =>
      suggestionTextPresentationForSource(source.slice(from, to), {
        source,
        from,
        to,
      });
    const end = "Alpha one.".length;
    expect(presentation(end, source.indexOf("\n<empty"))).toEqual([
      { type: "lineBreak" },
      { type: "text", value: "Alpha two." },
    ]);
    expect(presentation(end, end + 1)).toEqual([{ type: "text", value: "↵" }]);
    expect(
      presentation(source.indexOf("\n<empty"), source.indexOf("\n- ")),
    ).toEqual([
      { type: "text", value: "↵" },
      { type: "block", value: "¶" },
    ]);
    expect(presentation(source.indexOf("\n- "), source.length)).toEqual([
      { type: "lineBreak" },
      { type: "block", value: "- " },
      { type: "text", value: "Item" },
    ]);
  });

  it("fails closed when presentation context does not match its raw fragment", () => {
    expect(
      suggestionTextPresentationForSource("Other", {
        source: "**Echo**",
        from: 2,
        to: 6,
      }),
    ).toBeNull();
  });

  it("keeps aggregate whitespace-only source slices visible without dropping marks", () => {
    expect(
      suggestionTextPresentationForSource(" \t", {
        source: "a \tb",
        from: 1,
        to: 3,
      }),
    ).toEqual([{ type: "text", value: "·⇥" }]);

    const source = '<span underline="true"> \t</span>';
    const from = source.indexOf(">") + 1;
    const to = source.lastIndexOf("<");
    expect(
      suggestionTextPresentationForSource(source.slice(from, to), {
        source,
        from,
        to,
      }),
    ).toEqual([
      {
        type: "underline",
        children: [{ type: "text", value: "·⇥" }],
      },
    ]);
  });

  it("breaks the line between contextual code runs", () => {
    const source = "`Ec`<br>`ho`";
    expect(
      suggestionTextPresentationForSource(source, {
        source,
        from: 0,
        to: source.length,
      }),
    ).toEqual([
      { type: "code", children: [{ type: "text", value: "Ec" }] },
      { type: "lineBreak" },
      { type: "code", children: [{ type: "text", value: "ho" }] },
    ]);
  });

  it("keeps a contextual tag between backticks as text", () => {
    const source = "`Ec<br>ho`";
    expect(
      suggestionTextPresentationForSource(source, {
        source,
        from: 0,
        to: source.length,
      }),
    ).toEqual([
      {
        type: "code",
        children: [{ type: "text", value: "Ec<br>ho" }],
      },
    ]);
  });

  it.each([
    ["<br>", "↵"],
    ["<br/><br>", "↵↵"],
    ["Ec<br>ho", "Ec↵ho"],
    ["\n", "↵"],
    [" \t<br>", "·⇥↵"],
    ["before<br>after\nnext", "before↵after↵next"],
    ["\\<br>", "\\<br>"],
    ["`<br>`", "`<br>`"],
    ["``a`<br>``<br>", "``a`<br>``↵"],
    ["<img src=x>", "<img src=x>"],
  ])("renders %j as %j without changing literal markup", (source, expected) => {
    expect(suggestionTextForDisplay(source)).toBe(expected);
  });
  it("maps semantic breaks to the suggestion-only text offset space", () => {
    expect(suggestionAnchorText("Ec<br/>ho\nagain")).toBe("Ec\nho\nagain");
  });

  it("builds one safe presentation model for supported NFM marks", () => {
    const nodes = suggestionTextPresentation(
      '**Bold** *Italic* ~~Strike~~ `Code` <span underline="true">Underline</span> [Link](https://example.test)',
    );

    expect(
      nodes.filter((node) => node.type !== "text").map((node) => node.type),
    ).toEqual(["strong", "emphasis", "strike", "code", "underline", "link"]);
    expect(nodes[nodes.length - 1]).toMatchObject({
      type: "link",
      url: "https://example.test",
    });
    expect(suggestionTextPresentation("```a``b```")).toEqual([
      {
        type: "code",
        children: [{ type: "text", value: "a``b" }],
      },
    ]);
  });

  it("preserves trailing spaces and unsupported markup as text nodes", () => {
    const nodes = suggestionTextPresentation("**Echo**  ");
    expect(nodes[nodes.length - 1]).toEqual({
      type: "text",
      value: "  ",
    });
    expect(suggestionTextPresentation("<img src=x>")).toEqual([
      { type: "text", value: "<img src=x>" },
    ]);
  });

  it.each([
    ["# heading", "# heading"],
    ["> quote", "> quote"],
    ["- one\n- two", "- one↵- two"],
    ["- [ ] task", "- [ ] task"],
    ["```ts\nconst x = 1;\n```", "```ts↵const x = 1;↵```"],
    ["```ts\nconst x = 1;\n```\n", "```ts↵const x = 1;↵```↵"],
  ])("preserves block-leading fragment %j literally", (content, expected) => {
    expect(presentationText(suggestionTextPresentation(content))).toBe(
      expected,
    );
  });
});

describe("clipped suggestion text", () => {
  it("names a clipped link's destination once", () => {
    const label = "a".repeat(120);
    const clipped = clipSuggestionPresentation(
      suggestionTextPresentation(`[${label}](https://example.test)`),
      { head: 72, tail: 24 },
    );
    expect(presentationText(clipped)).toBe(
      `${"a".repeat(72)}…${"a".repeat(24)}`,
    );
    expect(suggestionLinkDestinations(clipped)).toEqual([
      "https://example.test",
    ]);
  });

  it("keeps the destination of a link that ends inside the clipped middle", () => {
    const clipped = clipSuggestionPresentation(
      suggestionTextPresentation(
        `[${"a".repeat(100)}](https://example.test) ${"b".repeat(100)}`,
      ),
      { head: 72, tail: 24 },
    );
    expect(presentationText(clipped)).toBe(
      `${"a".repeat(72)}…${"b".repeat(24)}`,
    );
    expect(suggestionLinkDestinations(clipped)).toEqual([
      "https://example.test",
    ]);
  });

  it("shortens a long link destination in a clipped card", () => {
    const url = `https://example.test/${"a".repeat(200)}`;
    const nodes = suggestionTextPresentation(`[docs](${url})`);
    const clipped = clipSuggestionPresentation(nodes, { head: 72, tail: 24 });
    expect(clipped).not.toBe(nodes);
    expect(presentationText(clipped)).toBe("docs");
    expect(suggestionLinkDestinations(clipped)).toEqual([
      `${url.slice(0, 40)}…`,
    ]);

    const emojiUrl = `https://example.test/${"a".repeat(18)}😀${"a".repeat(200)}`;
    expect(
      suggestionLinkDestinations(
        clipSuggestionPresentation(
          suggestionTextPresentation(`[docs](${emojiUrl})`),
          { head: 72, tail: 24 },
        ),
      ),
    ).toEqual([`${emojiUrl.slice(0, 39)}…`]);
  });

  it.each([
    [
      "a surrogate pair",
      `${"a".repeat(71)}😀${"b".repeat(100)}😀${"c".repeat(23)}`,
      `${"a".repeat(71)}…${"c".repeat(23)}`,
    ],
    [
      "a joined emoji or an accent",
      `${"a".repeat(70)}👩‍💻${"b".repeat(100)}é${"c".repeat(23)}`,
      `${"a".repeat(70)}…${"c".repeat(23)}`,
    ],
  ])("never splits %s between the head and the tail", (_, text, expected) => {
    expect(
      presentationText(
        clipSuggestionPresentation(suggestionTextPresentation(text), {
          head: 72,
          tail: 24,
        }),
      ),
    ).toBe(expected);
  });
});
