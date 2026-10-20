import { createContext, useContext, useMemo } from "react";

import { escapeHtmlAttributeValue } from "@/pages/design-editor/dom-utils";

// A string, so a render that leaves every CSS file untouched keeps the value
// equal and no canvas rebuilds its document.
export const DesignStylesheetsContext = createContext("[]");

export function designStylesheetsKey(
  files: ReadonlyArray<{ filename: string; content?: string | null }>,
): string {
  return JSON.stringify(
    files
      .filter((file) => file.filename.toLowerCase().endsWith(".css"))
      .map((file) => [file.filename, file.content ?? ""]),
  );
}

/** The design's CSS files by filename. */
export function useDesignStylesheets(): ReadonlyMap<string, string> {
  const key = useContext(DesignStylesheetsContext);
  return useMemo(() => new Map<string, string>(JSON.parse(key)), [key]);
}

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * Inlines `<link rel="stylesheet">` tags that name one of the design's CSS
 * files: the canvas document has no URL those files resolve against.
 */
export function inlineDesignStylesheets(
  html: string,
  stylesheets: ReadonlyMap<string, string>,
): string {
  if (stylesheets.size === 0) return html;
  return html.replace(LINK_TAG_RE, (tag) => {
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) return tag;
    const href = tag.match(HREF_RE);
    const filename = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").replace(
      /^\.\//,
      "",
    );
    const css = stylesheets.get(filename);
    if (css === undefined) return tag;
    return `<style data-agent-native-design-stylesheet="${escapeHtmlAttributeValue(filename)}">${css.replace(/<\/style/gi, "<\\/style")}</style>`;
  });
}
