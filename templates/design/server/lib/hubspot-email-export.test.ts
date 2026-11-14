import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHubSpotEmailHtml } from "../../shared/hubspot-email.js";

const { safeFetch } = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: safeFetch,
}));

import {
  exportHubSpotEmailHtml,
  prepareHubSpotEmailHtml,
} from "./hubspot-email-export.js";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function withContent(content: string, css = ""): string {
  return createHubSpotEmailHtml()
    .replace(
      '<meta name="agent-native:frame-type" content="hubspot-email">',
      "",
    )
    .replace("Your email content goes here.", content)
    .replace("</style>", `${css}</style>`);
}

function findElement(
  html: string,
  id: string,
): DefaultTreeAdapterTypes.Element {
  function find(
    node: DefaultTreeAdapterTypes.Node,
  ): DefaultTreeAdapterTypes.Element | undefined {
    if (
      "tagName" in node &&
      node.attrs.some((attr) => attr.name === "id" && attr.value === id)
    )
      return node;
    if ("childNodes" in node) {
      for (const child of node.childNodes) {
        const found = find(child);
        if (found) return found;
      }
    }
  }
  const element = find(parse(html));
  expect(element).toBeDefined();
  return element!;
}

describe("HubSpot email HTML export", () => {
  beforeEach(() => {
    safeFetch.mockReset();
    safeFetch.mockImplementation(
      async () =>
        new Response(new Uint8Array(PNG_BYTES), {
          headers: { "content-type": "image/png" },
        }),
    );
  });

  it("exports unmarked email HTML with the selector cascade, inline precedence, responsive rules, and literal HubL", async () => {
    const result = await exportHubSpotEmailHtml(
      withContent(
        '<span class="copy" id="greeting" style="font-size:18px;color:navy">{{ personalization_token(\'contact.lastname\', \'friend\') }}</span>',
        "span {font-size:12px;color:black} .copy {font-size:14px;color:green!important} p > span.copy {font-size:16px} #greeting {color:red!important} @media (max-width:400px) { .copy {font-size:20px!important} }",
      ),
    );
    const style = findElement(result.html, "greeting").attrs.find(
      (attr) => attr.name === "style",
    )!.value;
    expect(style).toBe(
      "font-size:12px;color:black;font-size:14px;color:green!important;font-size:16px;color:red!important;font-size:18px;color:navy",
    );
    const contentParagraph = findElement(result.html, "greeting")
      .parentNode as DefaultTreeAdapterTypes.Element;
    const contentCell =
      contentParagraph.parentNode as DefaultTreeAdapterTypes.Element;
    expect(contentCell.tagName).toBe("td");
    expect(
      contentCell.attrs.find((attr) => attr.name === "style")?.value,
    ).toContain("font-family: Arial, sans-serif;");
    expect(result.html).toContain("@media (max-width:400px)");
    expect(result.html).not.toContain("p > span.copy");
    expect(result.html).toContain(
      "{{ personalization_token('contact.lastname', 'friend') }}",
    );
    expect(result.html).toContain('href="{{ unsubscribe_link }}"');
    expect(result.html).toContain(
      "{{ site_settings.company_street_address_1 }}",
    );
    expect(result.imageCount).toBe(0);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("checks deduplicated HTTPS images through the SSRF-safe fetcher without forwarding credentials", async () => {
    const result = await exportHubSpotEmailHtml(
      withContent(
        '<img src="https://images.example.com/banner.png" alt="Announcement" width="600" height="240"><img src="https://images.example.com/banner.png" alt="" width="300" height="120">',
      ),
    );
    expect(result.imageCount).toBe(2);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(safeFetch).toHaveBeenCalledWith(
      "https://images.example.com/banner.png",
      expect.objectContaining({
        method: "GET",
        signal: expect.any(AbortSignal),
        headers: { Accept: "image/png,image/jpeg,image/gif" },
      }),
      { httpsOnly: true, requireDispatcher: true, maxRedirects: 3 },
    );
  });

  it.each([
    ["script", "<script>alert(1)</script>", "Remove <script>"],
    [
      "noscript link",
      '<noscript><a href="javascript:alert(1)">Click</a></noscript>',
      "Remove <noscript>",
    ],
    [
      "noscript image",
      '<noscript><img src="http://images.example.com/a.png"></noscript>',
      "Remove <noscript>",
    ],
    ["Alpine", '<span x-text="message">hello</span>', 'Attribute "x-text"'],
    [
      "embedded frame",
      '<iframe src="https://example.com"></iframe>',
      "Remove <iframe>",
    ],
    [
      "image alt",
      '<img src="https://images.example.com/a.png">',
      "alt attribute",
    ],
    ["relative image", '<img src="/a.png" alt="">', "absolute public HTTPS"],
    [
      "local image",
      '<img src="https://localhost/a.png" alt="">',
      "public HTTPS hostname",
    ],
    [
      "IP image",
      '<img src="https://127.0.0.1/a.png" alt="">',
      "public HTTPS hostname",
    ],
    [
      "data image",
      '<img src="data:image/png;base64,example" alt="">',
      "public HTTPS hostname",
    ],
    [
      "dynamic image",
      '<img src="{{ contact.image }}" alt="">',
      "absolute public HTTPS",
    ],
    [
      "srcset",
      '<img src="https://images.example.com/a.png" srcset="/a.png 2x" alt="">',
      'Attribute "srcset"',
    ],
    [
      "background",
      '<table background="/a.png"></table>',
      'Attribute "background"',
    ],
    ["link", '<a href="javascript:alert(1)">Click</a>', "Link at a"],
  ])(
    "rejects unsupported %s without claiming an export",
    (_, markup, message) => {
      expect(() => prepareHubSpotEmailHtml(withContent(markup))).toThrow(
        message,
      );
    },
  );

  it.each([
    ['height="240"', "width"],
    ['width="600"', "height"],
    ['width="0" height="240"', "width"],
    ['width="600" height="-1"', "height"],
    ['width="100%" height="240"', "width"],
    ['width="600" height="auto"', "height"],
    ['width="600px" height="240"', "width"],
    ['width="600" height="24.5"', "height"],
  ])(
    "rejects missing or invalid explicit image dimensions (%s)",
    (dimensions, dimension) => {
      expect(() =>
        prepareHubSpotEmailHtml(
          withContent(
            `<img id="hero" src="https://images.example.com/a.png" alt="Hero" style="width:600px;height:240px" ${dimensions}>`,
          ),
        ),
      ).toThrow(
        `Image at img#hero needs an explicit positive integer ${dimension} attribute`,
      );
      expect(safeFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["flex", ".email-container {display:flex}", "presentation tables"],
    ["grid", ".email-container {display:grid}", "presentation tables"],
    [
      "CSS asset",
      '.email-container {background:url("/image.png")}',
      "HTTPS <img>",
    ],
    ["import", '@import "https://example.com/a.css";', "@import"],
    ["dynamic selector", ".copy:hover {color:red}", "cannot be inlined"],
    ["nested rules", ".copy { p {color:red} }", "Nested CSS"],
    [
      "font shorthand",
      ".email-footer {font:0/0 Arial}",
      "explicit text styles",
    ],
    ["font reset", ".email-footer {all:unset}", "explicit text styles"],
    [
      "offscreen text",
      ".email-footer {text-indent:-9999px}",
      "explicit text styles",
    ],
    [
      "responsive font shorthand",
      "@media(max-width:620px){.email-footer{font:0/0 Arial!important}}",
      "explicit text styles",
    ],
    [
      "responsive font reset",
      "@media(max-width:620px){.email-footer{all:unset!important}}",
      "explicit text styles",
    ],
    [
      "invalid visibility",
      ".email-footer {visibility:hidden}.email-footer p,.email-footer a {visibility:bogus}",
      "visibility",
    ],
  ])("rejects unsupported %s styles", (_, css, message) => {
    expect(() => prepareHubSpotEmailHtml(withContent("hello", css))).toThrow(
      message,
    );
  });

  it.each([
    'image-set("https://images.example.com/banner.png" 1x)',
    '-webkit-image-set("https://images.example.com/banner.png" 1x)',
  ])(
    "rejects unchecked CSS image functions in stylesheets and inline styles (%s)",
    (value) => {
      for (const html of [
        withContent("Hello", `.email-container{background-image:${value}}`),
        withContent(`<span style='background-image:${value}'>Hello</span>`),
      ])
        expect(() => prepareHubSpotEmailHtml(html)).toThrow("HTTPS <img>");
    },
  );

  it.each([
    ["footer", "{{ site_settings.company_name }}", "", "company_name"],
    [
      "unsubscribe",
      'href="{{ unsubscribe_link }}"',
      'href="https://example.com"',
      "unsubscribe link",
    ],
    [
      "annotation",
      "templateType: email",
      "templateType: page",
      "template annotation",
    ],
    ["preheader", "data-email-preheader", "data-other", "preheader"],
    [
      "fallback",
      "personalization_token('contact.firstname', 'there')",
      "contact.firstname",
      "personalization_token",
    ],
  ])("rejects missing %s requirements", (_, before, after, message) => {
    expect(() =>
      prepareHubSpotEmailHtml(withContent("Hello").replace(before, after)),
    ).toThrow(message);
  });

  it("rejects unmarked browser frames for actual email requirements", () => {
    expect(() =>
      prepareHubSpotEmailHtml("<table><tr><td>Hello</td></tr></table>"),
    ).toThrowError(
      expect.objectContaining({
        errorCode: "invalid_hubspot_email",
        statusCode: 422,
        message: expect.stringContaining("preheader"),
      }),
    );
    expect(() =>
      prepareHubSpotEmailHtml(
        '<script src="https://example.com/app.js"></script>',
      ),
    ).toThrow("Remove <script>");
  });

  it("preserves HubSpot's built-in personalization defaults and rejects a missing default", () => {
    const token = "{{ personalization_token('contact.firstname', 'there') }}";
    expect(prepareHubSpotEmailHtml(withContent(token)).html).toContain(token);
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent("{{ personalization_token('contact.firstname') }}"),
      ),
    ).toThrow("fallback");
  });

  it("preserves double-quoted HubL arguments and quoted defaults in text", () => {
    const urlToken =
      '{{ personalization_token("contact.website", "https://example.com/docs") }}';
    const textToken = `{{ personalization_token('contact.firstname', 'Bob "the builder"') }}`;
    const { html } = prepareHubSpotEmailHtml(
      withContent(`<a id="quoted-token" href="${urlToken}">${textToken}</a>`),
    );
    expect(html).toContain(urlToken);
    expect(html).toContain(textToken);
    expect(
      findElement(
        html.replace(urlToken, "https://example.com/docs"),
        "quoted-token",
      ).attrs,
    ).toContainEqual({ name: "href", value: "https://example.com/docs" });
  });

  it("preserves quoted closing delimiters and literal placeholder text", () => {
    const token =
      "{{ personalization_token('contact.firstname', 'Hi }} there') }}";
    const url =
      "{{ personalization_token('contact.website', 'https://example.com/}}/docs') }}";
    const { html } = prepareHubSpotEmailHtml(
      withContent(`ANHUBL0TOKEN ANHUBL1TOKEN <a href="${url}">${token}</a>`),
    );
    expect(html).toContain(token);
    expect(html).toContain(url);
    expect(html).toContain("ANHUBL0TOKEN ANHUBL1TOKEN");
    expect(html).not.toContain("undefined");
  });

  it("reports unclosed HubL without treating the document as valid", () => {
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent("{{ personalization_token('contact.firstname', 'there')"),
      ),
    ).toThrowError(
      expect.objectContaining({
        errorCode: "invalid_hubspot_email",
        statusCode: 422,
      }),
    );
  });

  it.each([
    '<iframe src="https://example.com"></iframe>',
    '<img src="https://example.com/a.png">',
    '<a href="javascript:alert(1)">Open</a>',
  ])(
    "rejects markup hidden inside a personalization default (%s)",
    (fallback) => {
      expect(() =>
        prepareHubSpotEmailHtml(
          withContent(
            `{{ personalization_token('contact.firstname', '${fallback}') }}`,
          ),
        ),
      ).toThrow("without HTML markup");
    },
  );

  it.each([
    [
      "href",
      String.raw`{{ personalization_token('contact.website', 'https://example.com/" onmouseover="injected') }}`,
    ],
    [
      "href",
      String.raw`{{ personalization_token("contact.website", "https://example.com/\"quoted\"") }}`,
    ],
    [
      "title",
      `{{ personalization_token('contact.firstname', 'Bob "the builder"') }}`,
    ],
  ])(
    "rejects quote-bearing personalization defaults in %s attributes",
    (attribute, token) => {
      const attrs =
        attribute === "href"
          ? `href="${token}"`
          : `href="https://example.com" title="${token}"`;
      expect(() =>
        prepareHubSpotEmailHtml(withContent(`<a ${attrs}>Open</a>`)),
      ).toThrowError(
        expect.objectContaining({
          errorCode: "invalid_hubspot_email",
          statusCode: 422,
          message: expect.stringContaining("literal double quotes"),
        }),
      );
    },
  );

  it.each([
    "{{ contact.firstname|default('there', true) }}",
    "{{ contact.firstname|escape_html }}",
    "{{ personalization_token('contact.firstname', 'there')|escape }}",
    "{{ personalization_token('contact.firstname', 'there')|default('friend') }}",
  ])("rejects email personalization filters (%s)", (token) => {
    expect(() => prepareHubSpotEmailHtml(withContent(token))).toThrow(
      "personalization_token('contact.field', 'fallback') without filters",
    );
  });

  it.each([
    "hidden",
    'style="display:none"',
    'style="visibility:hidden"',
    'style="visibility:collapse"',
    'style="font-size:0px"',
    'style="opacity:0"',
    'class="concealed"',
  ])(
    "rejects hidden footer text including ancestor styles (%s)",
    (attributes) => {
      const html = withContent("Hello", ".concealed { display:none!important }")
        .replace(
          '<td class="email-footer">',
          `<td class="email-footer"><div ${attributes}>`,
        )
        .replace("</a>\n      </td>", "</a></div>\n      </td>");
      expect(() => prepareHubSpotEmailHtml(html)).toThrow("visible footer");
    },
  );

  it.each(["", " &nbsp; ", '<span style="display:none">Unsubscribe</span>'])(
    "rejects an unsubscribe anchor without a visible text label (%s)",
    (label) => {
      expect(() =>
        prepareHubSpotEmailHtml(
          withContent("Hello").replace(">Unsubscribe</a>", `>${label}</a>`),
        ),
      ).toThrow("visible unsubscribe link");
    },
  );

  it("does not count required tokens in a hidden preheader", () => {
    const html = withContent("Hello")
      .replace(
        "A short preview of your email.",
        "{{ site_settings.company_name }}",
      )
      .replace("<p>{{ site_settings.company_name }}<br>", "<p>Company<br>");
    expect(() => prepareHubSpotEmailHtml(html)).toThrow("visible footer");
  });

  it.each(['style="display:none"', 'style="opacity:0%"', 'class="concealed"'])(
    "requires a visible unsubscribe anchor independently of footer text (%s)",
    (attributes) => {
      const html = withContent(
        "Hello",
        ".concealed {visibility:hidden}",
      ).replace(
        'href="{{ unsubscribe_link }}"',
        `href="{{ unsubscribe_link }}" ${attributes}`,
      );
      expect(() => prepareHubSpotEmailHtml(html)).toThrow(
        "visible unsubscribe link",
      );
    },
  );

  it.each([
    '<span title="{{ site_settings.company_name }}">Company</span>',
    "<!-- {{ site_settings.company_name }} -->Company",
  ])(
    "does not count footer tokens outside rendered text (%s)",
    (replacement) => {
      expect(() =>
        prepareHubSpotEmailHtml(
          withContent("Hello").replace(
            "<p>{{ site_settings.company_name }}<br>",
            `<p>${replacement}<br>`,
          ),
        ),
      ).toThrow("visible footer");
    },
  );

  it("respects visibility resets and important declarations while leaving the hidden preheader intact", () => {
    const html = withContent("Hello", ".email-footer {display:block!important}")
      .replace(
        '<td class="email-footer">',
        '<td class="email-footer" style="display:none;font-size:0;visibility:hidden"><div style="font-size:12px;visibility:visible">',
      )
      .replace("</a>\n      </td>", "</a></div>\n      </td>");
    expect(prepareHubSpotEmailHtml(html).html).toContain(
      "data-email-preheader",
    );
  });

  it.each([
    [".email-footer", "display:none!important"],
    ['table[role="presentation"]', "opacity:0%!important"],
    [".email-footer p", "font-size:0px!important"],
    [".email-footer a", "visibility:hidden!important"],
    [".email-footer a", "visibility:collapse!important"],
  ])(
    "rejects responsive visibility changes affecting required content (%s %s)",
    (selector, css) => {
      expect(() =>
        prepareHubSpotEmailHtml(
          withContent("Hello", `@media(max-width:620px){${selector}{${css}}}`),
        ),
      ).toThrow("Responsive CSS may hide required email footer content");
    },
  );

  it("checks each company token and the unsubscribe label independently", () => {
    const html = withContent(
      "<p>{{ unsubscribe_link }}</p>",
      "@media(max-width:620px){.company-name,.email-footer a{display:none!important}}",
    ).replace(
      "{{ site_settings.company_name }}",
      '<span class="company-name">{{ site_settings.company_name }}</span>',
    );
    expect(() => prepareHubSpotEmailHtml(html)).toThrow(
      "site_settings.company_name",
    );
    expect(() =>
      prepareHubSpotEmailHtml(html.replace(".company-name,", "")),
    ).toThrow("unsubscribe_link");
  });

  it.each([["", "display:none!important;display:table-cell!important"]])(
    "respects inline and within-rule precedence for responsive visibility (%s / %s)",
    (inline, css) => {
      const html = withContent(
        "Hello",
        `@media(max-width:620px){.email-footer{${css}}}`,
      ).replace(
        '<td class="email-footer">',
        `<td class="email-footer" style="${inline}">`,
      );
      expect(prepareHubSpotEmailHtml(html).html).toContain("@media");
    },
  );

  it.each([
    ["display:block!important", "display:none!important"],
    ["display:block", "display:none"],
  ])(
    "rejects responsive changes blocked by original inline styles (%s / %s)",
    (inline, css) => {
      const html = withContent(
        "Hello",
        `@media(max-width:620px){.email-footer{${css}}}`,
      ).replace(
        '<td class="email-footer">',
        `<td class="email-footer" style="${inline}">`,
      );
      expect(() => prepareHubSpotEmailHtml(html)).toThrow(
        "would be overridden after inlining",
      );
    },
  );

  it("preserves responsive spacing and unrelated conditional artwork", () => {
    const html = withContent(
      '<div class="art">Decoration</div>',
      "@media(max-width:620px){.email-footer{padding:12px!important;font-size:14px}.art{display:none!important}}",
    );
    expect(prepareHubSpotEmailHtml(html).html).toContain(
      ".art{display:none!important}",
    );
  });

  it("rejects responsive overrides that would lose to newly inlined base styles", () => {
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent(
          '<h2 class="title">Hello</h2>',
          ".title{font-size:32px}@media(max-width:620px){.title{font-size:20px}}",
        ),
      ),
    ).toThrow("would be overridden after inlining");
    expect(
      prepareHubSpotEmailHtml(
        withContent(
          '<h2 class="title">Hello</h2>',
          ".title{font-size:32px}@media(max-width:620px){.title{font-size:20px!important}}",
        ),
      ).html,
    ).toContain("font-size:20px!important");
  });

  it.each([
    [
      '<span class="title" style="font-size:32px">Hello</span>',
      "",
      "font-size:20px",
    ],
    [
      '<span class="title">Hello</span>',
      ".title{padding:0}",
      "padding-left:20px",
    ],
    [
      '<span class="title">Hello</span>',
      ".title{padding-left:0}",
      "padding:20px",
    ],
    [
      '<span class="title">Hello</span>',
      ".title{border:0}",
      "border-left-width:2px",
    ],
  ])(
    "detects responsive property conflicts after inlining (%s / %s / %s)",
    (content, base, mobile) => {
      expect(() =>
        prepareHubSpotEmailHtml(
          withContent(
            content,
            `${base}@media(max-width:620px){.title{${mobile}}}`,
          ),
        ),
      ).toThrow("would be overridden after inlining");
      expect(
        prepareHubSpotEmailHtml(
          withContent(
            content,
            `${base}@media(max-width:620px){.title{${mobile}!important}}`,
          ),
        ).html,
      ).toContain(`${mobile}!important`);
    },
  );

  it("rejects computed opacity instead of guessing whether required footer content is visible", () => {
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent("Hello", ".email-footer{opacity:calc(0)}"),
      ),
    ).toThrow("resolved numeric opacity");
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent("Hello", ".email-footer{opacity:-1}"),
      ),
    ).toThrow("visible footer");
  });

  it.each([
    "clip-path:inset(100%)",
    "-webkit-clip-path:inset(100%)",
    "-webkit-text-fill-color:transparent",
  ])("rejects unsupported legal-text effects (%s)", (declaration) => {
    for (const css of [
      `.email-footer{${declaration}}`,
      `@media(max-width:620px){.email-footer{${declaration}!important}}`,
    ])
      expect(() => prepareHubSpotEmailHtml(withContent("Hello", css))).toThrow(
        "cannot be validated for email text visibility",
      );
  });

  it.each([
    "height:0;overflow:hidden",
    "max-height:0;overflow-y:clip",
    "width:0;overflow:auto",
  ])("rejects footer tokens in a clipped wrapper (%s)", (style) => {
    const html = withContent("Hello").replace(
      "{{ site_settings.company_name }}",
      `<span style="display:block;${style}">{{ site_settings.company_name }}</span>`,
    );
    expect(() => prepareHubSpotEmailHtml(html)).toThrow("visible footer");
  });

  it("allows zero-height wrappers with visible overflow", () => {
    const html = withContent("Hello").replace(
      "{{ site_settings.company_name }}",
      '<span style="display:block;height:0;overflow:visible">{{ site_settings.company_name }}</span>',
    );
    expect(prepareHubSpotEmailHtml(html).html).toContain("height:0");
  });

  it.each(["", "height:200px;"])(
    "requires an unclipped normal-flow legal footer (%s)",
    (parentSize) => {
      const html = withContent("Hello").replace(
        "{{ site_settings.company_name }}",
        `<span style="display:block;${parentSize}overflow:hidden"><span style="display:block;height:0;overflow:visible">{{ site_settings.company_name }}</span></span>`,
      );
      expect(() => prepareHubSpotEmailHtml(html)).toThrow(
        "Footer visibility cannot be validated for zero-size content inside clipping ancestors",
      );
    },
  );

  it.each([
    ["height:0", "overflow:hidden"],
    ["overflow:hidden", "height:0"],
  ])(
    "rejects clipping assembled across base and responsive rules (%s / %s)",
    (base, mobile) => {
      const html = withContent(
        "Hello",
        `.footer-name{display:block;${base}}@media(max-width:620px){.footer-name{${mobile}!important}}`,
      ).replace(
        "{{ site_settings.company_name }}",
        '<span class="footer-name">{{ site_settings.company_name }}</span>',
      );
      expect(() => prepareHubSpotEmailHtml(html)).toThrow(
        "Footer visibility cannot be validated for zero-size content inside clipping ancestors",
      );
    },
  );

  it("preserves explicit font properties, zero indentation, and visibility resets", () => {
    const html = withContent(
      "Hello",
      ".email-footer{font-family:Arial;font-size:14px;text-indent:0px;visibility:hidden}.email-footer p,.email-footer a{visibility:initial}",
    );
    expect(prepareHubSpotEmailHtml(html).html).toContain("text-indent:0px");
  });

  it.each([
    "transparent",
    "#1230",
    "#11223300",
    "rgba(0,0,0,0)",
    "rgb(10 20 30 / 0%)",
    "hsl(210 50% 40% / 0)",
    "color-mix(in srgb, transparent, transparent)",
  ])("rejects invisible footer text colors (%s)", (color) => {
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent("Hello", `.email-footer {color:${color}}`),
      ),
    ).toThrow("visible footer");
  });

  it.each(["inherit", "currentColor", "unset"])(
    "inherits transparent footer text through %s",
    (color) => {
      const html = withContent("Hello", ".email-footer {color:transparent}")
        .replace(
          '<td class="email-footer">',
          `<td class="email-footer"><div style="color:${color}">`,
        )
        .replace("</a>\n      </td>", "</a></div>\n      </td>");
      expect(() => prepareHubSpotEmailHtml(html)).toThrow("visible footer");
    },
  );

  it.each(["#333", "initial"])(
    "allows a visible child color reset (%s)",
    (color) => {
      const html = withContent(
        "Hello",
        `.email-footer {color:transparent}.email-footer p,.email-footer a {color:${color}}`,
      );
      expect(prepareHubSpotEmailHtml(html).html).toContain(`color:${color}`);
    },
  );

  it("requires visible unsubscribe text even when company tokens remain visible", () => {
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent("Hello", ".email-footer a {color:transparent}"),
      ),
    ).toThrow("visible unsubscribe");
  });

  it.each([
    [".email-footer", "transparent"],
    ["body", "rgba(0,0,0,0)"],
    [".email-footer a", "#0000"],
    [".email-footer p", "hsl(0 0% 0% / 0%)"],
  ])(
    "rejects responsive transparent footer colors (%s / %s)",
    (selector, color) => {
      expect(() =>
        prepareHubSpotEmailHtml(
          withContent(
            "Hello",
            `@media(max-width:620px){${selector}{color:${color}!important}}`,
          ),
        ),
      ).toThrow("Responsive CSS may hide required email footer content");
    },
  );

  it("reports responsive colors blocked by original important inline colors", () => {
    const html = withContent(
      "Hello",
      "@media(max-width:620px){.email-footer{color:transparent!important}}",
    ).replace(
      '<td class="email-footer">',
      '<td class="email-footer" style="color:#333!important">',
    );
    expect(() => prepareHubSpotEmailHtml(html)).toThrow(
      "would be overridden after inlining",
    );
  });

  it("allows opaque child colors beneath responsive transparent ancestors", () => {
    const html = withContent(
      "Hello",
      ".email-footer p,.email-footer a{color:#333}@media(max-width:620px){.email-footer{color:transparent!important}}",
    );
    expect(prepareHubSpotEmailHtml(html).html).toContain("color:#333");
  });

  it("rejects a responsive inheritance reset that exposes a transparent ancestor", () => {
    const html = withContent(
      "Hello",
      ".email-footer{color:transparent}.email-footer p,.email-footer a{color:#333}@media(max-width:620px){.email-footer p{color:inherit!important}}",
    );
    expect(() => prepareHubSpotEmailHtml(html)).toThrow(
      "Responsive CSS may hide required email footer content",
    );
  });

  it("accepts an always-visible duplicate footer but rejects mutually conditional copies", () => {
    const html = withContent(
      "Hello",
      "@media(max-width:620px){.email-footer{display:none!important}}",
    );
    const footer = html
      .match(/<td class="email-footer">[\s\S]*?<\/td>/)![0]
      .replace('class="email-footer"', 'class="always-footer"');
    const duplicated = html.replace(
      "</body>",
      `<table role="presentation"><tr>${footer}</tr></table></body>`,
    );
    expect(prepareHubSpotEmailHtml(duplicated).html).toContain("always-footer");
    expect(() =>
      prepareHubSpotEmailHtml(
        duplicated.replace(
          "</style>",
          "@media(min-width:621px){.always-footer{display:none!important}}</style>",
        ),
      ),
    ).toThrow("Responsive CSS may hide required email footer content");
  });

  it("rejects conditional visibility selectors it cannot safely match", () => {
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent(
          "Hello",
          "@media(max-width:620px){.email-footer:not(.keep){display:none!important}}",
        ),
      ),
    ).toThrow("cannot be inlined");
  });

  it("requires the email annotation before document markup, without requiring availability", () => {
    const html = withContent("Hello");
    expect(() =>
      prepareHubSpotEmailHtml(
        html
          .replace("templateType: email", "templateType: page")
          .replace("</body>", "<!-- templateType: email --></body>"),
      ),
    ).toThrow("leading HubSpot template annotation");
    for (const replacement of ["", "isAvailableForNewContent: false"])
      expect(
        prepareHubSpotEmailHtml(
          html.replace("isAvailableForNewContent: true", replacement),
        ).html,
      ).toContain("templateType: email");
    expect(
      prepareHubSpotEmailHtml(
        html.replace(
          /<!--[\s\S]*?-->/,
          "\uFEFF<!-- Ordinary comment -->\n<!-- templateType: email -->",
        ),
      ).html,
    ).toContain("templateType: email");
  });

  it("preserves documented escaping on visible footer and subscription URL variables", () => {
    const html = withContent("Hello")
      .replace(
        "{{ site_settings.company_name }}",
        "{{ site_settings.company_name|escape_html }}",
      )
      .replace("{{ unsubscribe_link }}", "{{ unsubscribe_link|escape_url }}");
    expect(prepareHubSpotEmailHtml(html).html).toContain(
      "{{ site_settings.company_name|escape_html }}",
    );
  });

  it.each([
    "{{ subscription_preferences_url }}",
    "{{ invented_url|default('https://example.com') }}",
    "{{ content.subject }}",
    "{{ unsubscribe_link + '/extra' }}",
    "{{ unsubscribe_link }}?extra=true",
  ])("rejects unsupported HubL URL destinations (%s)", (token) => {
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent(`<a href="${token}">Preferences</a>`),
      ),
    ).toThrowError(
      expect.objectContaining({
        errorCode: "invalid_hubspot_email",
        message: expect.stringContaining("unsupported HubL URL destination"),
      }),
    );
  });

  it.each([
    "{{ unsubscribe_link }}",
    "{{ unsubscribe_link_all }}",
    "{{ unsubscribe_link_single }}",
    "{{ view_as_page_url }}",
    "{{ subscription_confirmation_url }}",
    "{{ content.absolute_url }}",
    "{{ view_as_page_url|escape_url }}",
    "{{ content.absolute_url|default('https://example.com', true)|escape }}",
    "{{ personalization_token('contact.website', 'https://example.com') }}",
  ])("preserves supported HubL URL destinations (%s)", (token) => {
    const { html } = prepareHubSpotEmailHtml(
      withContent(`<a id="destination" href="${token}">Open</a>`),
    );
    expect(
      findElement(html, "destination").attrs.find(
        (attr) => attr.name === "href",
      )?.value,
    ).toBe(token);
  });

  it.each([
    "",
    "there",
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://user:secret@example.com",
    "https://",
    "https:",
    "http:garbage",
    "mailto:",
    "tel:",
  ])(
    "rejects invalid static destinations and contact URL fallbacks (%s)",
    (fallback) => {
      for (const destination of [
        fallback,
        `{{ personalization_token('contact.website', '${fallback}') }}`,
      ])
        expect(() =>
          prepareHubSpotEmailHtml(
            withContent(`<a href="${destination}">CTA</a>`),
          ),
        ).toThrowError(
          expect.objectContaining({ errorCode: "invalid_hubspot_email" }),
        );
    },
  );

  it.each([
    "https://example.com/signup",
    "http://example.com/docs",
    "mailto:hello@example.com",
    "tel:+15555550100",
  ])(
    "preserves valid static destinations and contact URL fallbacks (%s)",
    (fallback) => {
      for (const token of [
        fallback,
        `{{ personalization_token('contact.website', '${fallback}') }}`,
      ]) {
        const { html } = prepareHubSpotEmailHtml(
          withContent(`<a id="cta" href="${token}">CTA</a>`),
        );
        expect(
          findElement(html, "cta").attrs.find((attr) => attr.name === "href")
            ?.value,
        ).toBe(token);
      }
    },
  );

  it.each(["#", "#details"])(
    "preserves static fragments but rejects them as contact URL fallbacks (%s)",
    (fragment) => {
      expect(
        prepareHubSpotEmailHtml(
          withContent(`<a href="${fragment}">Details</a>`),
        ).html,
      ).toContain(`href="${fragment}"`);
      expect(() =>
        prepareHubSpotEmailHtml(
          withContent(
            `<a href="{{ personalization_token('contact.website', '${fragment}') }}">CTA</a>`,
          ),
        ),
      ).toThrow("literal URL fallback");
    },
  );

  it("preserves approved source anchor destinations, including contact URL defaults", () => {
    const source = `<link href="https://example.com/web.css"><img src="https://example.com/hero.png"><a href="#section">Jump</a><a href="{{ unsubscribe_link }}">Unsubscribe</a><a href="https://EXAMPLE.com/docs">Docs</a><a href="https://example.com/docs">Again</a><a href="mailto:hello@example.com">Email</a><a href="tel:+15555550100">Call</a><a href="{{ personalization_token('contact.website', 'https://example.com/signup') }}">Start</a>`;
    const target = withContent(
      `<a href="https://example.com/docs">Documentation</a><a href="mailto:hello@example.com">Contact</a><a href="tel:+15555550100">Phone</a><a href="{{ personalization_token('contact.website', 'https://example.com/signup') }}">Join</a>`,
    );
    const result = prepareHubSpotEmailHtml(target, {
      preserveLinksFromHtml: source,
    });
    expect(result.html).toContain("https://example.com/signup");
    expect(source).toContain("https://EXAMPLE.com/docs");
    expect(target).toContain("personalization_token");
  });

  it("rejects rewritten source destinations before checking remote images and redacts query values", async () => {
    const source = `<a href="https://example.com/invite?code=PRIVATE_EXAMPLE#secret">Invite</a><a href="https://example.com/figma">Figma</a><a href="https://EXAMPLE.com/figma">Figma again</a>`;
    const target = withContent(
      '<a href="https://example.com/help">Help</a><img src="https://images.example.com/hero.png" alt="" width="600" height="200">',
    );
    await expect(
      exportHubSpotEmailHtml(target, { preserveLinksFromHtml: source }),
    ).rejects.toThrowError(
      expect.objectContaining({ errorCode: "invalid_hubspot_email" }),
    );
    expect(safeFetch).not.toHaveBeenCalled();
    try {
      prepareHubSpotEmailHtml(target, { preserveLinksFromHtml: source });
      throw new Error("Expected missing destination failure");
    } catch (error) {
      expect(String(error)).toContain(
        "missing 2 approved source link destinations",
      );
      expect(String(error)).toContain("https://example.com/invite");
      expect(String(error)).toContain("https://example.com/figma");
      expect(String(error)).not.toContain("PRIVATE_EXAMPLE");
      expect(String(error)).not.toContain("#secret");
    }
  });

  it("rejects a rewritten personalization URL default while accepting the original as a static destination", () => {
    const source = `<a href="{{ personalization_token('contact.website', 'https://example.com/signup') }}">Start</a>`;
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent('<a href="https://example.com/help">Help</a>'),
        { preserveLinksFromHtml: source },
      ),
    ).toThrow("https://example.com/signup");
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent('<a href="https://example.com/signup">Start</a>'),
        { preserveLinksFromHtml: source },
      ),
    ).not.toThrow();
  });

  it("bounds link-preservation source parsing and ignores unapproved source destinations", () => {
    expect(() =>
      prepareHubSpotEmailHtml(withContent("Hello"), {
        preserveLinksFromHtml: "x".repeat(1_000_001),
      }),
    ).toThrow("1 MB");
    expect(() =>
      prepareHubSpotEmailHtml(withContent("Hello"), {
        preserveLinksFromHtml:
          '<a href="javascript:alert(1)">Script</a><a href="https://user:secret@example.com/private">Private</a><a href="/relative">Relative</a>',
      }),
    ).not.toThrow();
  });

  it("rejects hidden image channels even when the email marker is only a comment", () => {
    expect(() =>
      prepareHubSpotEmailHtml(
        withContent('<!--[if mso]><img src="/private.png"><![endif]-->'),
      ),
    ).toThrow("Conditional-comment markup");
    const commentedMarker = withContent(
      '<img src="/private.png" alt="Private">',
    ).replace(
      "</head>",
      '<!-- <meta name="agent-native:frame-type" content="hubspot-email"> --></head>',
    );
    expect(() => prepareHubSpotEmailHtml(commentedMarker)).toThrow(
      "absolute public HTTPS",
    );
  });

  it("matches attribute selectors against the authored attributes before applying styles", () => {
    const { html } = prepareHubSpotEmailHtml(
      withContent(
        '<span id="first">First</span><span id="second">Second</span>',
        "#first {color:red} span[style] + span {font-weight:bold}",
      ),
    );
    expect(
      findElement(html, "first").attrs.find((attr) => attr.name === "style")
        ?.value,
    ).toBe("color:red;");
    expect(
      findElement(html, "second").attrs.find((attr) => attr.name === "style"),
    ).toBeUndefined();
  });

  it.each([
    [
      "HTTP failure",
      () => safeFetch.mockResolvedValue(new Response(null, { status: 403 })),
      "HTTP 403",
    ],
    [
      "HTML login page",
      () =>
        safeFetch.mockResolvedValue(
          new Response(null, { headers: { "content-type": "text/html" } }),
        ),
      "PNG, JPEG, or GIF",
    ],
    [
      "HTML disguised as a PNG",
      () =>
        safeFetch.mockResolvedValue(
          new Response("<html>Sign in</html>", {
            headers: { "content-type": "image/png" },
          }),
        ),
      "invalid image data",
    ],
    [
      "SSRF/private DNS/redirect",
      () => safeFetch.mockRejectedValue(new Error("SSRF blocked")),
      "publicly reachable",
    ],
  ])(
    "fails the whole export when an image has %s",
    async (_, arrange, message) => {
      arrange();
      await expect(
        exportHubSpotEmailHtml(
          withContent(
            '<img id="hero" src="https://images.example.com/a.png" alt="Hero" width="600" height="240">',
          ),
        ),
      ).rejects.toThrow(message);
    },
  );
});
