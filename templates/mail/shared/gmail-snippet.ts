import { decodeCommonHtmlEntities } from "./markdown";

function isUnicodeScalarValue(codePoint: number): boolean {
  return (
    codePoint > 0 &&
    codePoint <= 0x10ffff &&
    (codePoint < 0xd800 || codePoint > 0xdfff)
  );
}

// Gmail returns snippets HTML-escaped, numeric references included. Compose
// markdown keeps decodeCommonHtmlEntities so typed "&#60;b&#62;" stays text.
// A single replace pass, so "&amp;lt;" decodes to the literal text "&lt;".
export function decodeGmailSnippet(snippet: string): string {
  return snippet.replace(
    /&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d+)|#[xX]([0-9a-fA-F]+));/g,
    (match, entity?: string, decimal?: string, hex?: string) => {
      if (entity) return decodeCommonHtmlEntities(match);
      const codePoint =
        decimal !== undefined
          ? Number.parseInt(decimal, 10)
          : Number.parseInt(hex ?? "", 16);
      return isUnicodeScalarValue(codePoint)
        ? String.fromCodePoint(codePoint)
        : match;
    },
  );
}
