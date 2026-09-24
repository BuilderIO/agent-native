import { describe, expect, it } from "vitest";

import {
  suggestionAnchorText,
  suggestionTextForDisplay,
  type SuggestionPresentationNode,
  suggestionTextPresentation,
  suggestionTextPresentationForSource,
} from "./suggestion-text";

function presentationText(nodes: SuggestionPresentationNode[]): string {
  return nodes
    .map((node) =>
      node.type === "text" || node.type === "indent"
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
      { type: "text", value: "↵" },
      { type: "strong", children: [{ type: "text", value: "Lower" }] },
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

  it("makes contextual newlines visible inside marked text runs", () => {
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
        children: [{ type: "text", value: "Ec↵ho" }],
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
