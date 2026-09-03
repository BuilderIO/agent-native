/**
 * Deliberately narrow authenticated MCP surface for Calendar.
 *
 * External callers may read calendar coverage through list-events. Other
 * actions remain available through the in-app agent, ask_app, or an explicit
 * full-catalog connection; tool-search alone never makes them callable.
 */
export const CALENDAR_CONNECTOR_CATALOG = ["list-events"] as const;
