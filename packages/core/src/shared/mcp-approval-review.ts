/**
 * Where an app shows its own MCP approval review page: on its home page, with
 * the grant id in this key of the URL fragment. The toolkit's `AppProviders`
 * renders the page there. The id is a lookup handle, not a credential: the
 * page reads and decides through the framework route, which checks the
 * browser session.
 */
export const MCP_APPROVAL_HASH_PARAM = "mcpApproval";

// The auth guard admits the review route only for `:id(uuidv4)`, a lowercase
// UUID v4; accept nothing wider, or a link would reach the sign-in wall.
const GRANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A grant id is a UUID, so it never needs percent-encoding. */
export function isMcpApprovalId(value: unknown): value is string {
  return typeof value === "string" && GRANT_ID.test(value);
}

/** The grant id a page's URL fragment names, if it names a well-formed one. */
export function readMcpApprovalId(hash: string): string | undefined {
  const id = new URLSearchParams(hash.replace(/^#/, "")).get(
    MCP_APPROVAL_HASH_PARAM,
  );
  return isMcpApprovalId(id) ? id : undefined;
}

/**
 * The app page that reviews one grant. The id rides in the fragment, not the
 * query: an app's home route often redirects (to `/inbox`, `/plans`), and a
 * browser carries the fragment through an HTTP redirect, where a server
 * redirect can drop the query.
 */
export function mcpApprovalAppPagePath(
  id: string,
  homePath: string,
  basePath = "",
): string {
  return `${basePath}${homePath}#${MCP_APPROVAL_HASH_PARAM}=${id}`;
}
