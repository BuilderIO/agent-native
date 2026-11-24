import {
  readFullScreenBlockLink,
  type FullScreenBlockLink,
} from "./block-link.js";

export const INTERACTIVE_HTML_LANGUAGE = "html interactive";

export function isInteractiveHtmlLanguage(language: unknown): boolean {
  return (
    typeof language === "string" &&
    language.trim().toLowerCase().split(/\s+/).join(" ") ===
      INTERACTIVE_HTML_LANGUAGE
  );
}

const CODE_NOTE = /^<!-- Runs in Content: (\S+) -->(?:\n|$)/;

export function withInteractiveHtmlNote(source: string, url: string): string {
  return `<!-- Runs in Content: ${url} -->\n${source}`;
}

export function readInteractiveHtmlNote(
  code: string,
): { source: string; link: FullScreenBlockLink } | null {
  const [note, url] = CODE_NOTE.exec(code) ?? [];
  const link = readFullScreenBlockLink(url);
  return note && link ? { source: code.slice(note.length), link } : null;
}
