import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { describe, expect, it } from "vitest";

import { createHubSpotEmailPreview } from "./hubspot-email-preview.js";

function text(node: DefaultTreeAdapterTypes.Node): string {
  if (node.nodeName === "#text")
    return (node as DefaultTreeAdapterTypes.TextNode).value;
  return "childNodes" in node ? node.childNodes.map(text).join("") : "";
}

describe("HubSpot sample email preview", () => {
  it("handles quoted closing delimiters and preserves literal placeholder text", () => {
    const result = createHubSpotEmailPreview(
      `<p>ANHUBL0TOKEN ANHUBL1TOKEN {{ personalization_token('contact.firstname', 'Hi }} there') }}</p>`,
    );
    expect(text(parse(result.html))).toBe(
      "ANHUBL0TOKEN ANHUBL1TOKEN Hi }} there",
    );
    expect(result.preview.unresolvedTokens).toEqual([]);
    expect(result.preview.substitutedTokens).toEqual([
      "{{ personalization_token('contact.firstname', 'Hi }} there') }}",
    ]);
  });

  it("reports an unclosed interpolation", () => {
    expect(() =>
      createHubSpotEmailPreview("<p>{{ contact.firstname</p>"),
    ).toThrowError(
      expect.objectContaining({
        errorCode: "invalid_hubspot_email",
        statusCode: 422,
      }),
    );
  });

  it("rejects unclosed control tags without repeatedly scanning unmatched openers", () => {
    const start = performance.now();
    expect(() => createHubSpotEmailPreview("{%".repeat(40_000))).toThrowError(
      expect.objectContaining({
        errorCode: "invalid_hubspot_email",
        statusCode: 422,
      }),
    );
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  it("bounds the source before rendering a sample preview", () => {
    expect(() => createHubSpotEmailPreview("a".repeat(1_000_001))).toThrowError(
      expect.objectContaining({
        errorCode: "invalid_hubspot_email",
        statusCode: 422,
      }),
    );
  });

  it("keeps delimiters inside quoted arguments within their containing token", () => {
    const control = `{% if contact.name == 'Hi %} {{ there' %}`;
    const result = createHubSpotEmailPreview(
      `<p>${control}{{ personalization_token('contact.firstname', 'Hello {% there') }}{% endif %}</p>`,
    );
    expect(text(parse(result.html))).toBe(
      `${control}Hello {% there{% endif %}`,
    );
    expect(result.preview.unresolvedTokens).toEqual([control, "{% endif %}"]);
  });

  it("renders fake company values and literal contact defaults without interpreting HTML", () => {
    const source = `<p>{{ site_settings.company_name|escape_html }}</p><p>{{ contact.firstname|default('<strong>Friend</strong>', true)|escape_html }}</p><a title="{{ personalization_token('contact.company', 'A & B')|escape_attr }}">Open</a>`;
    const result = createHubSpotEmailPreview(source);
    expect(text(parse(result.html))).toBe(
      "Example Company<strong>Friend</strong>Open",
    );
    expect(result.html).toContain("&lt;strong&gt;Friend&lt;/strong&gt;");
    expect(result.html).toContain('title="A &amp; B"');
    expect(result.preview).toMatchObject({
      mode: "hubspot-email",
      sampleValues: true,
      unresolvedTokens: [],
    });
    expect(result.preview.substitutedTokens).toHaveLength(3);
    expect(source).toContain("{{ site_settings.company_name|escape_html }}");
  });

  it("escapes attribute defaults and parses a literal pipe without treating it as a filter", () => {
    const result = createHubSpotEmailPreview(
      `<a title="{{ contact.name|default('Friend & <Guest> " onmouseover="alert(1)') }}" href="{{ contact.url|default('https://example.com?a=1|b=2') }}">Go</a>`,
    );
    const document = parse(result.html);
    const html = document.childNodes.find(
      (node) => "tagName" in node && node.tagName === "html",
    ) as DefaultTreeAdapterTypes.Element;
    const body = html.childNodes.find(
      (node) => "tagName" in node && node.tagName === "body",
    ) as DefaultTreeAdapterTypes.Element;
    const anchor = body.childNodes[0] as DefaultTreeAdapterTypes.Element;
    expect(anchor.attrs).toEqual([
      {
        name: "title",
        value: 'Friend & <Guest> " onmouseover="alert(1)',
      },
      { name: "href", value: "https://example.com?a=1|b=2" },
    ]);
    expect(body.childNodes).toHaveLength(1);
    expect(result.html).toContain('href="https://example.com?a=1|b=2"');
    expect(result.preview.unresolvedTokens).toEqual([]);
  });

  it("retains unknown expressions and control tags and reports them as unresolved", () => {
    const expressions = [
      "{{ invented_variable }}",
      "{{ contact.firstname }}",
      "{{ contact.name|default(other.value) }}",
      "{{ site_settings.company_name + other }}",
      "{% if contact.vip %}",
      "{% endif %}",
    ];
    const result = createHubSpotEmailPreview(`<p>${expressions.join(" ")}</p>`);
    for (const expression of expressions)
      expect(text(parse(result.html))).toContain(expression);
    expect(result.preview.unresolvedTokens).toEqual(expressions);
    expect(result.preview.substitutedTokens).toEqual([]);
  });

  it("keeps template tokens in script/style contexts unresolved", () => {
    const result = createHubSpotEmailPreview(
      "<style>/* {{ site_settings.company_name }} */</style><script>const name = \"{{ contact.name|default('Example') }}\";</script>",
    );
    expect(result.preview.substitutedTokens).toEqual([]);
    expect(result.preview.unresolvedTokens).toHaveLength(2);
    expect(result.html).toContain("{{ site_settings.company_name }}");
  });

  it("uses recipient samples in text and URL attributes while retaining omitted defaults", () => {
    const source = `<p>{{ personalization_token('contact.firstname', 'there') }}</p><a href="{{ personalization_token('contact.website', 'https://example.com/default') }}">Open</a>`;
    expect(text(parse(createHubSpotEmailPreview(source).html))).toBe(
      "thereOpen",
    );
    for (const name of [
      "Alex",
      "A".repeat(500),
      '<strong>Alex & "Guest"</strong>',
    ]) {
      const result = createHubSpotEmailPreview(source, [
        { field: "contact.firstname", value: name },
        {
          field: "contact.website",
          value: 'https://example.com/sample?a=1&b=" onmouseover="alert(1)',
        },
      ]);
      expect(text(parse(result.html))).toBe(`${name}Open`);
      expect(result.html).toContain("&quot; onmouseover=&quot;alert(1)");
      expect(result.preview.usedContactFields).toEqual([
        "contact.firstname",
        "contact.website",
      ]);
      expect(result.preview.unresolvedTokens).toEqual([]);
    }
  });

  it.each(
    [
      [{ field: "contact.unknown", value: "Alex" }],
      [{ field: "company.name", value: "Example" }],
      [{ field: "contact.firstname", value: "A".repeat(501) }],
      Array.from({ length: 9 }, (_, i) => ({
        field: `contact.field${i}`,
        value: "Example",
      })),
      [
        { field: "contact.firstname", value: "Alex" },
        { field: "contact.firstname", value: "Other" },
      ],
    ].map((samples) => [samples]),
  )(
    "rejects unused, duplicate or invalid recipient samples (%s)",
    (samples) => {
      expect(() =>
        createHubSpotEmailPreview(
          "<p>{{ personalization_token('contact.firstname', 'there') }}</p>",
          samples,
        ),
      ).toThrowError(
        expect.objectContaining({
          errorCode: "invalid_hubspot_preview_samples",
        }),
      );
    },
  );
});
