import { parse, serialize } from "parse5";
import { describe, expect, it } from "vitest";

import { stripExecutableMarkup } from "./strip-executable-markup.js";

describe("stripExecutableMarkup", () => {
  it.each([
    ["a slash-separated handler", "<svg/onload=alert(1)><rect/></svg>"],
    ["a handler after a slash", '<img src="x"/onerror="alert(1)">'],
    ["an entity-encoded scheme", '<a href="jav&#x61;script:alert(1)">x</a>'],
    ["a scheme split by a tab", '<a href="java&#9;script:alert(1)">x</a>'],
    ["a srcset candidate", '<img srcset="a.png 1x, javascript:alert(1) 2x">'],
    ["a style expression", '<div style="width: expression(alert(1))"></div>'],
    ["srcdoc", '<div srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></div>'],
    ["a script element", "<main><script/x>alert(1)</script></main>"],
    ["an iframe", '<iframe src="https://example.com"></iframe>'],
    [
      "an animation that rewrites a link",
      '<svg><a href="#"><set attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>',
    ],
    ["a data URL link", '<a href="data:text/html,&lt;b&gt;x&lt;/b&gt;">x</a>'],
    [
      "a data URL form action",
      '<form action="data:text/html;base64,PGI+">x</form>',
    ],
    [
      "an animation to an encoded script URL",
      '<svg><a href="#"><animate attributeName="xlink:href" values="#;jav&#x61;script:alert(1)"/></a></svg>',
    ],
  ])("removes %s", (_, html) => {
    const result = stripExecutableMarkup(html);
    expect(result).not.toMatch(
      /onload|onerror|javascript|jav&#x61;|java&#9;|expression\(|srcdoc|data:text|<script|<iframe|<set|<animate/i,
    );
  });

  it("keeps a harmless animation", () => {
    const html =
      '<svg><rect><animate attributeName="opacity" values="0;1" dur="1s"/></rect></svg>';
    expect(stripExecutableMarkup(html)).toBe(html);
  });

  it("removes a script xlink:href beside a safe href, and keeps the safe one", () => {
    expect(
      stripExecutableMarkup(
        '<svg><a href="#" xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
      ),
    ).toBe('<svg><a href="#"  ><text>x</text></a></svg>');
  });

  it("keeps an svg open when its handler sat right after a slash", () => {
    expect(stripExecutableMarkup("<svg/onload=x><rect/></svg>")).toBe(
      "<svg/ ><rect/></svg>",
    );
  });

  it("removes markup that hides a handler from a parse with scripting on", () => {
    const html =
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript><p>Kept</p>';
    const result = stripExecutableMarkup(html);
    for (const scriptingEnabled of [true, false]) {
      expect(serialize(parse(result, { scriptingEnabled }))).not.toMatch(
        /onerror/i,
      );
    }
    expect(result).toContain("<p>Kept</p>");
  });

  it("never returns markup that turns executable once serialized and reparsed", () => {
    const html =
      "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>";
    let result: string;
    try {
      result = stripExecutableMarkup(html);
    } catch (error) {
      expect(String(error)).toMatch(/parsed again/);
      return;
    }
    const reparsed = serialize(parse(serialize(parse(result))));
    expect(serialize(parse(reparsed))).not.toMatch(/onerror/i);
  });

  it("keeps an image data URL on an SVG image", () => {
    const html =
      '<svg><image href="data:image/svg+xml;base64,PHN2Zy8+" width="4" height="4"/></svg>';
    expect(stripExecutableMarkup(html)).toBe(html);
  });

  it("leaves safe markup byte for byte", () => {
    const html =
      '<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins&amp;display=swap"></head><body><a href="https://example.com" style="color: red">Hi</a><img src="data:image/png;base64,AAAA"></body></html>';
    expect(stripExecutableMarkup(html)).toBe(html);
  });
});
