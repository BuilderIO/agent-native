const DEFAULT_EMAIL_LOGO_SOURCE = "cid:agent-native-logo";

export function resolveEmailPreviewAssets(html: string): string {
  // Browser srcdoc previews do not have the MIME parts that resolve email CIDs.
  return html.replaceAll(DEFAULT_EMAIL_LOGO_SOURCE, "/favicon.png");
}
