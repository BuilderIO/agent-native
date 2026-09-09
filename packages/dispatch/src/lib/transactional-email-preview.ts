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

/**
 * Deliberately does NOT try to locate an existing `<head>`/`<html>` tag and
 * insert into it. That would still be beatable: the HTML parser starts
 * fetching a resource as soon as it tokenizes a tag that references one, and
 * malformed-but-parseable markup can put such a tag before the position a
 * regex would find (e.g. `<img src="https://evil">` followed later by a
 * stray `<head>`) — the browser opens an implicit head to hold that `<img>`
 * *before* our injected one is ever reached, so a CSP inserted "into the
 * first `<head>`" can run after the leak already happened. Always emitting
 * our own `<head>` as the literal first bytes guarantees nothing supplied
 * can be tokenized first, at the cost of a stray duplicate/relocated
 * `<head>`/`<title>` later in the document — which the parser silently
 * drops or reflows, and which does not matter for a throwaway preview.
 */
function withRestrictiveCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${EMAIL_PREVIEW_CSP}">`;
  return `<head>${meta}</head>${html}`;
}

export function resolveEmailPreviewAssets(html: string): string {
  // Browser srcdoc previews do not have the MIME parts that resolve email CIDs.
  const withLocalAssets = html.replaceAll(
    DEFAULT_EMAIL_LOGO_SOURCE,
    "/favicon.png",
  );
  return withRestrictiveCsp(withLocalAssets);
}
