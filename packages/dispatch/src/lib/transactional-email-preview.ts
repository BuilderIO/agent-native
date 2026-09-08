const DEFAULT_EMAIL_LOGO_SOURCE = "cid:agent-native-logo";

/**
 * The `<iframe sandbox="">` these previews render into blocks script
 * execution, but sandboxing does nothing to stop `<img>`, CSS `url()`/
 * `@import`, or other resource fetches — an email (a real sent one, or a
 * dummy-data template preview) can use one as a tracking beacon that leaks
 * the viewing admin's IP and open time to an attacker-controlled host. A CSP
 * `<meta>` tag is still enforced inside a sandboxed document, so this blocks
 * every remote fetch except the local favicon `resolveEmailPreviewAssets`
 * rewrites CIDs to, while leaving inline styles (which email HTML relies on
 * throughout) and data-URI images intact.
 */
const EMAIL_PREVIEW_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

function withRestrictiveCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${EMAIL_PREVIEW_CSP}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${meta}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(
      /<html[^>]*>/i,
      (match) => `${match}<head>${meta}</head>`,
    );
  }
  return `${meta}${html}`;
}

export function resolveEmailPreviewAssets(html: string): string {
  // Browser srcdoc previews do not have the MIME parts that resolve email CIDs.
  const withLocalAssets = html.replaceAll(
    DEFAULT_EMAIL_LOGO_SOURCE,
    "/favicon.png",
  );
  return withRestrictiveCsp(withLocalAssets);
}
