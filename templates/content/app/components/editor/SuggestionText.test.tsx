// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { SuggestionText } from "./SuggestionText";

function renderedText(content: string): string {
  const document = new DOMParser().parseFromString(
    renderToStaticMarkup(<SuggestionText content={content} />),
    "text/html",
  );
  return document.body.textContent ?? "";
}

it("renders unsupported image content as escaped NFM without loading it", () => {
  const html = renderToStaticMarkup(
    <SuggestionText content="![alt](https://example.test/image.png)" />,
  );
  expect(html).toContain("![alt](https://example.test/image.png)");
  expect(html).not.toContain("<img");
});

it("preserves trailing spaces after marked content", () => {
  expect(
    renderToStaticMarkup(<SuggestionText content="**Echo**  " />),
  ).toContain("<strong>Echo</strong>  </span>");
});

it("renders an exact fragment using its enclosing source marks", () => {
  const source = "**Prefix Upper**<br>**Lower suffix.**";
  const from = source.indexOf("Upper");
  const to = source.indexOf("Lower") + "Lower".length;
  expect(
    renderToStaticMarkup(
      <SuggestionText
        content={source.slice(from, to)}
        context={{ source, from, to }}
      />,
    ),
  ).toContain("<strong>Upper</strong>↵<strong>Lower</strong>");
});

it("marks invalid source context unavailable without rendering raw delimiters", () => {
  const html = renderToStaticMarkup(
    <SuggestionText
      content="Upper**"
      context={{ source: "**Upper**", from: 2, to: 7 }}
    />,
  );
  expect(html).toContain('data-suggestion-text-unavailable="true"');
  expect(html).toContain("Preview unavailable");
  expect(html).not.toContain("Upper**");
});

it("keeps a valid empty source fragment distinct from unavailable context", () => {
  const html = renderToStaticMarkup(
    <SuggestionText content="" context={{ source: "", from: 0, to: 0 }} />,
  );
  expect(html).not.toContain('data-suggestion-text-unavailable="true"');
  expect(html).not.toContain("Preview unavailable");
});

it("renders contextual whitespace-only changes with visible markers", () => {
  expect(
    renderToStaticMarkup(
      <SuggestionText
        content={" \t"}
        context={{ source: "a \tb", from: 1, to: 3 }}
      />,
    ),
  ).toContain("·⇥");
});

it("renders contextual marked newlines with visible markers", () => {
  const source = "`Ec<br>ho`";
  const html = renderToStaticMarkup(
    <SuggestionText
      content={source}
      context={{ source, from: 0, to: source.length }}
    />,
  );
  expect(html).toContain("<code ");
  expect(html).toContain("Ec↵ho</code>");
});

it.each([
  ["**Echo**", "<strong>Echo</strong>"],
  ["*Echo*", "<em>Echo</em>"],
  ["~~Echo~~", "<s>Echo</s>"],
  ['<span underline="true">Echo</span>', "<u>Echo</u>"],
])("renders supported formatting %j visibly", (content, expected) => {
  expect(renderToStaticMarkup(<SuggestionText content={content} />)).toContain(
    expected,
  );
});
it("renders code and hard breaks without executing markup", () => {
  const html = renderToStaticMarkup(
    <SuggestionText content="`code` Ec<br>ho" />,
  );
  expect(html).toContain("<code ");
  expect(html).toContain("code</code>");
  expect(html).toContain("Ec↵ho");
  expect(renderToStaticMarkup(<SuggestionText content={"\\<br>"} />)).toContain(
    "&lt;br&gt;",
  );
  expect(renderToStaticMarkup(<SuggestionText content="`<br>`" />)).toContain(
    "&lt;br&gt;",
  );
});
it("renders link destinations as plain text that inherits the summary color", () => {
  const before = renderToStaticMarkup(
    <SuggestionText content="[Echo](https://example.test/old)" />,
  );
  const after = renderToStaticMarkup(
    <span className="proposal-color">
      <SuggestionText content="[Echo](https://example.test/new)" />
    </span>,
  );
  expect(before).toContain("https://example.test/old");
  expect(after).toContain("<span> (https://example.test/new)</span>");
  expect(after).toContain('class="proposal-color"');
  expect(after).not.toContain("href=");
  expect(after).not.toContain("text-muted-foreground");
});

it.each([
  ["# heading", "# heading"],
  ["> quote", "> quote"],
  ["- one\n- two", "- one↵- two"],
  ["- [ ] task", "- [ ] task"],
  ["```ts\nconst x = 1;\n```", "```ts↵const x = 1;↵```"],
])("renders block-leading fragment %j literally", (content, expected) => {
  expect(renderedText(content)).toBe(expected);
});
