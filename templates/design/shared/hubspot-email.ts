import { parse } from "parse5";

import { scanHubLInterpolations } from "./hubl-tokens.js";

export const HUBSPOT_EMAIL_FRAME_TYPE = "hubspot-email";

// Gates the full parse, so it must match every spelling parse5 decodes to the
// marker name. Any meta tag holding a character reference goes to the parse,
// since references can spell any part of the name. A false positive only
// costs a parse. The scan is linear and honors quoted attribute values, which
// may contain ">"; a regex like /<meta[^>]*&/ is neither.
function mayHaveFrameTypeMarker(content: string): boolean {
  const lower = content.toLowerCase();
  if (lower.includes("agent-native:frame-type")) return true;
  let from = 0;
  for (;;) {
    const start = lower.indexOf("<meta", from);
    if (start === -1) return false;
    let quote = "";
    // A quote opens a value only right after "=" and optional whitespace;
    // anywhere else it is an ordinary character, as it is to the parser.
    let expectingValue = false;
    let hasReference = false;
    let index = start + 5;
    for (; index < lower.length; index += 1) {
      const character = lower.charAt(index);
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === ">") {
        break;
      } else if (character === "=") {
        expectingValue = true;
      } else if (expectingValue && /\s/.test(character)) {
        // Still waiting for the value.
      } else {
        if (expectingValue && (character === '"' || character === "'")) {
          quote = character;
        }
        expectingValue = false;
      }
      if (character === "&") hasReference = true;
    }
    // A tag still open at the end of the input is dropped by the parser.
    if (index >= lower.length) return false;
    if (hasReference) return true;
    from = index;
  }
}

export function isHubSpotEmailHtml(content: string): boolean {
  if (!mayHaveFrameTypeMarker(content)) return false;
  // HubL string literals may contain HTML attribute delimiters or closing braces.
  const scanned = scanHubLInterpolations(content);
  if (scanned.unclosedAt !== undefined) return false;
  const parts: string[] = [];
  let cursor = 0;
  for (const token of scanned.tokens) {
    parts.push(content.slice(cursor, token.start), "ANHUBL");
    cursor = token.end;
  }
  parts.push(content.slice(cursor));
  const document = parse(parts.join(""));
  const html = document.childNodes.find(
    (node) => "tagName" in node && node.tagName === "html",
  );
  const head =
    html && "childNodes" in html
      ? html.childNodes.find(
          (node) => "tagName" in node && node.tagName === "head",
        )
      : undefined;
  return !!(
    head &&
    "childNodes" in head &&
    head.childNodes.some(
      (node) =>
        "tagName" in node &&
        node.tagName === "meta" &&
        node.attrs
          .find((attribute) => attribute.name === "name")
          ?.value.toLowerCase() === "agent-native:frame-type" &&
        node.attrs
          .find((attribute) => attribute.name === "content")
          ?.value.toLowerCase() === HUBSPOT_EMAIL_FRAME_TYPE,
    )
  );
}

export function createHubSpotEmailHtml({
  title = "Email",
}: { title?: string } = {}): string {
  const escapedTitle = title.replace(/[&<>"']/g, (character) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]!;
  });
  return `<!--
  templateType: email
  isAvailableForNewContent: true
-->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="agent-native:frame-type" content="hubspot-email">
  <title>${escapedTitle}</title>
  <style>
    body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
    table { border-collapse: collapse; }
    td { font-family: Arial, sans-serif; }
    .email-container { width: 100%; max-width: 600px; }
    .email-content { padding: 32px; }
    .email-footer { padding: 24px 32px; font-size: 14px; line-height: 20px; }
    @media only screen and (max-width: 620px) {
      .email-content { padding: 24px 20px !important; }
      .email-footer { padding: 20px !important; }
    }
  </style>
</head>
<body>
  <div data-email-preheader style="display:none;max-height:0;overflow:hidden;mso-hide:all">A short preview of your email.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="600" class="email-container" cellpadding="0" cellspacing="0">
      <tr><td class="email-content">
        <h1>${escapedTitle}</h1>
        <p>Hello {{ personalization_token('contact.firstname', 'there') }},</p>
        <p>Your email content goes here.</p>
      </td></tr>
      <tr><td class="email-footer">
        <p>{{ site_settings.company_name }}<br>
        {{ site_settings.company_street_address_1 }}<br>
        {{ site_settings.company_city }}, {{ site_settings.company_state }}</p>
        <a href="{{ unsubscribe_link }}">Unsubscribe</a>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;
}
