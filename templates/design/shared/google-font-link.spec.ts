import { describe, expect, it } from "vitest";

import {
  ensureGoogleFontLinkInHtmlString,
  primaryFontFamilyName,
} from "./google-font-link";

const document =
  "<!doctype html>\n<html>\n  <head>\n    <title>Card</title>\n  </head>\n  <body><h1>Title</h1></body>\n</html>";

function stylesheetLinks(html: string): string[] {
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]*)">/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("ensureGoogleFontLinkInHtmlString", () => {
  it("adds preconnect hints and the stylesheet link inside <head>, leaving the rest alone", () => {
    const result = ensureGoogleFontLinkInHtmlString(
      document,
      "'Inter', sans-serif",
    );

    expect(result.status).toBe("added");
    expect(result.family).toBe("Inter");
    expect(stylesheetLinks(result.html)).toEqual([
      expect.stringMatching(
        /^https:\/\/fonts\.googleapis\.com\/css2\?family=Inter[^"]*&amp;display=swap$/,
      ),
    ]);
    expect(result.html).toContain(
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
    );
    expect(result.html).toContain(
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    );
    const head = result.html.slice(
      result.html.indexOf("<head>"),
      result.html.indexOf("</head>"),
    );
    expect(head).toContain("fonts.googleapis.com/css2");
    const closeHead = document.indexOf("  </head>");
    expect(result.html.startsWith(document.slice(0, closeHead))).toBe(true);
    expect(result.html.endsWith(document.slice(closeHead))).toBe(true);
  });

  it("is idempotent: a second call reports already-linked and returns the same string", () => {
    const once = ensureGoogleFontLinkInHtmlString(
      document,
      "Inter, sans-serif",
    );
    const twice = ensureGoogleFontLinkInHtmlString(
      once.html,
      '"Inter", system-ui',
    );

    expect(twice.status).toBe("already-linked");
    expect(twice.html).toBe(once.html);
    expect(stylesheetLinks(twice.html)).toHaveLength(1);
  });

  it("does not add a second preconnect when a different font already added them", () => {
    const withInter = ensureGoogleFontLinkInHtmlString(document, "Inter").html;
    const withBoth = ensureGoogleFontLinkInHtmlString(
      withInter,
      "'Playfair Display', serif",
    ).html;

    expect(stylesheetLinks(withBoth)).toHaveLength(2);
    expect(withBoth.match(/rel="preconnect"/g)).toHaveLength(2);
  });

  it("recognises an existing link written by hand, with encoded or plus-joined family names", () => {
    const authored = document.replace(
      "</head>",
      '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&amp;display=swap" rel="stylesheet"></head>',
    );

    const result = ensureGoogleFontLinkInHtmlString(
      authored,
      '"Playfair Display", serif',
    );

    expect(result.status).toBe("already-linked");
    expect(result.html).toBe(authored);
  });

  it("leaves families outside the built-in list untouched as unlisted, including a Google family the list lacks", () => {
    for (const value of [
      "system-ui",
      "-apple-system, BlinkMacSystemFont, sans-serif",
      "'Helvetica Neue', Arial, sans-serif",
      '"Custom Display", sans-serif',
      "'Buda', sans-serif",
      "var(--font-body)",
      "",
    ]) {
      const result = ensureGoogleFontLinkInHtmlString(document, value);
      expect(result, value).toEqual({ html: document, status: "unlisted" });
    }
  });

  it("uses only the primary family of a fallback list", () => {
    const sansFirst = ensureGoogleFontLinkInHtmlString(
      document,
      "Arial, 'Playfair Display', serif",
    );
    expect(sansFirst.status).toBe("unlisted");

    const serifFirst = ensureGoogleFontLinkInHtmlString(
      document,
      '"Playfair Display", Georgia, serif',
    );
    expect(serifFirst.status).toBe("added");
    expect(serifFirst.family).toBe("Playfair Display");
    expect(stylesheetLinks(serifFirst.html)[0]).toContain(
      "family=Playfair+Display",
    );
  });

  it("creates a <head> after <html> when the document has none", () => {
    const noHead =
      '<!doctype html><html lang="en"><body><p>Hi</p></body></html>';
    const result = ensureGoogleFontLinkInHtmlString(noHead, "Inter");

    expect(result.status).toBe("added");
    expect(result.html).toMatch(
      /^<!doctype html><html lang="en"><head><link rel="preconnect"[\s\S]*<\/head><body><p>Hi<\/p><\/body><\/html>$/,
    );
    expect(ensureGoogleFontLinkInHtmlString(result.html, "Inter").status).toBe(
      "already-linked",
    );
  });

  it("prepends the links to a bare fragment, after any doctype", () => {
    const fragment = '<div class="card">Hi</div>';
    const bare = ensureGoogleFontLinkInHtmlString(fragment, "Inter");
    expect(bare.status).toBe("added");
    expect(bare.html.endsWith(fragment)).toBe(true);
    expect(bare.html.startsWith("<link")).toBe(true);

    const withDoctype = ensureGoogleFontLinkInHtmlString(
      `<!DOCTYPE html>${fragment}`,
      "Inter",
    );
    expect(withDoctype.html.startsWith("<!DOCTYPE html><link")).toBe(true);
  });

  it("inserts inline when <head> shares a line with its content", () => {
    const inline = "<html><head><title>x</title></head><body></body></html>";
    const result = ensureGoogleFontLinkInHtmlString(inline, "Inter");

    expect(result.html).toMatch(
      /^<html><head><title>x<\/title><link rel="preconnect"[^>]*><link rel="preconnect"[^>]*><link rel="stylesheet"[^>]*><\/head><body><\/body><\/html>$/,
    );
  });

  it("ignores <head> and <link> text inside comments, scripts, and styles", () => {
    const tricky = `<!doctype html><html><!-- <head></head> --><head><script>const t = "</head><link href='https://fonts.googleapis.com/css2?family=Inter:wght@400'>";</script><style>/* </head> */</style></head><body></body></html>`;
    const result = ensureGoogleFontLinkInHtmlString(tricky, "Inter");

    expect(result.status).toBe("added");
    expect(result.html).toContain(
      "<script>const t = \"</head><link href='https://fonts.googleapis.com/css2?family=Inter:wght@400'>\";</script>",
    );
    expect(result.html.indexOf('<link rel="stylesheet"')).toBeGreaterThan(
      result.html.indexOf("</style>"),
    );
    expect(result.html.indexOf('<link rel="stylesheet"')).toBeLessThan(
      result.html.lastIndexOf("</head>"),
    );
  });

  it("does not treat a Google link in <body> as loading the font for <head>", () => {
    const bodyLink = document.replace(
      "<h1>",
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400&amp;display=swap"><h1>',
    );

    expect(ensureGoogleFontLinkInHtmlString(bodyLink, "Inter").status).toBe(
      "added",
    );
  });

  it("pins Lato's 500 face once, even when the stylesheet link already exists", () => {
    const first = ensureGoogleFontLinkInHtmlString(
      document,
      "'Lato', sans-serif",
    );
    expect(first.status).toBe("added");
    expect(first.html).toContain('data-agent-native-font-face="Lato-500"');
    expect(first.html).toContain("Lato-Medium.ttf");
    expect(first.html).toContain("SIL Open Font License 1.1");

    const again = ensureGoogleFontLinkInHtmlString(first.html, "Lato");
    expect(again).toMatchObject({ status: "already-linked", html: first.html });
    expect(
      again.html.match(/data-agent-native-font-face="Lato-500"/g),
    ).toHaveLength(1);

    const linkOnly = first.html.replace(
      /\s*<style data-agent-native-font-face[\s\S]*?<\/style>\n?/,
      "",
    );
    const repaired = ensureGoogleFontLinkInHtmlString(linkOnly, "Lato");
    expect(repaired.status).toBe("added");
    expect(
      repaired.html.match(/data-agent-native-font-face="Lato-500"/g),
    ).toHaveLength(1);
    expect(stylesheetLinks(repaired.html)).toHaveLength(1);
  });

  it("does not pin a face for other families", () => {
    expect(
      ensureGoogleFontLinkInHtmlString(document, "Inter").html,
    ).not.toContain("data-agent-native-font-face");
  });
});

describe("font family name helpers", () => {
  it("reads the primary family from quoted and unquoted lists", () => {
    expect(primaryFontFamilyName('"Playfair Display", serif')).toBe(
      "Playfair Display",
    );
    expect(primaryFontFamilyName("'Lato', sans-serif")).toBe("Lato");
    expect(primaryFontFamilyName("  Inter  , sans-serif")).toBe("Inter");
    expect(primaryFontFamilyName("")).toBe("");
  });
});
