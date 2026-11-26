// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  ensureGoogleFontLinkInHtml,
  primaryFontFamilyName as editorPrimaryFontFamilyName,
} from "../app/pages/design-editor/code-layer-state";
import {
  ensureGoogleFontLinkInHtmlString,
  primaryFontFamilyName,
} from "./google-font-link";

// The editor's DOM implementation and the action's string implementation are
// two copies of one rule. This pins them together: for the same input they
// must leave the same <head> content behind.

const documents = {
  empty: "<!doctype html><html><head></head><body><p>Hi</p></body></html>",
  titled:
    "<!doctype html><html><head><title>Card</title></head><body><h1>Title</h1></body></html>",
  noHead: '<!doctype html><html lang="en"><body><p>Hi</p></body></html>',
  authored:
    '<!doctype html><html><head><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&amp;display=swap"></head><body></body></html>',
};

function headFingerprint(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return {
    links: Array.from(parsed.head.querySelectorAll("link")).map((link) => ({
      rel: link.getAttribute("rel"),
      href: link.getAttribute("href"),
      crossorigin: link.hasAttribute("crossorigin"),
    })),
    styles: Array.from(parsed.head.querySelectorAll("style")).map((style) => ({
      marker: style.getAttribute("data-agent-native-font-face"),
      text: style.textContent,
    })),
    bodyText: parsed.body.textContent,
  };
}

describe("string helper matches the editor's ensureGoogleFontLinkInHtml", () => {
  const values = [
    "'Lato', sans-serif",
    "Lato, sans-serif",
    '"Playfair Display", serif',
    "'Montserrat', sans-serif",
    "Inter",
    "system-ui",
    '"Custom Display", sans-serif',
    "Arial, 'Playfair Display', serif",
  ];

  for (const [name, html] of Object.entries(documents)) {
    for (const value of values) {
      it(`${name}: ${value}`, () => {
        const editor = ensureGoogleFontLinkInHtml(html, value);
        const string = ensureGoogleFontLinkInHtmlString(html, value);

        expect(headFingerprint(string.html)).toEqual(headFingerprint(editor));
        expect(string.status === "added").toBe(
          headFingerprint(editor).links.length +
            headFingerprint(editor).styles.length !==
            headFingerprint(html).links.length +
              headFingerprint(html).styles.length,
        );
      });
    }
  }

  it("agrees on idempotency", () => {
    const once = ensureGoogleFontLinkInHtmlString(
      documents.titled,
      "Lato",
    ).html;
    const editorTwice = ensureGoogleFontLinkInHtml(once, "Lato");
    expect(headFingerprint(editorTwice)).toEqual(headFingerprint(once));
  });

  it("reads the primary family the same way", () => {
    for (const value of [
      "'Lato', sans-serif",
      '"Playfair Display", serif',
      "  Inter  , sans-serif",
      "",
    ]) {
      expect(primaryFontFamilyName(value)).toBe(
        editorPrimaryFontFamilyName(value),
      );
    }
  });
});
