/**
 * Deliberately narrow authenticated MCP surface for Mail.
 *
 * External callers may read inbox coverage and mint a short-lived attachment
 * upload capability. Other actions remain available through the in-app agent,
 * ask_app, or an explicit full-catalog connection; tool-search alone never
 * makes them callable.
 */
export const MAIL_CONNECTOR_CATALOG = [
  "list-emails",
  "create-attachment-upload",
] as const;
