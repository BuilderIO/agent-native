/**
 * How long an MCP OAuth authorization may still complete after it starts.
 *
 * The server enforces this on the flow cookie, and the client uses it to decide
 * how long a return from the consent screen can still change the server list.
 * They have to be the same number: a client window shorter than the server's
 * leaves a stretch where a consent still succeeds but the opener has stopped
 * revalidating, which is exactly the stale "Connect" the refresh exists to
 * prevent.
 */
export const MCP_OAUTH_FLOW_TTL_SECONDS = 10 * 60;
export const MCP_OAUTH_FLOW_TTL_MS = MCP_OAUTH_FLOW_TTL_SECONDS * 1_000;
