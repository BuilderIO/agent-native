import {
  isMcpIntegrationUrl,
  type DefaultMcpIntegration,
} from "@agent-native/core/client/resources/mcp-integration-catalog";
import type { McpServer } from "@agent-native/core/client/resources/use-mcp-servers";

/**
 * The settings-page id a CONNECTED server opens under.
 *
 * A server that came from the catalog opens its catalog entry, matched by URL, so the
 * detail page is the same one the catalog tile would have opened before connecting
 * (for example `integrations/notion`). A custom integration — one added by URL, with no
 * catalog entry — opens under a slug of its own name, which is the same slug whose logo
 * it already renders.
 *
 * This lives in one place because two surfaces must agree on it: the tile that links to
 * the page, and the page that resolves which server it is showing. A remote MCP tile
 * that cannot be clicked was the bug this exists to prevent (Steve, 11/6).
 */
export function connectedServerIntegrationId(
  server: Pick<McpServer, "name" | "url">,
  catalog: readonly DefaultMcpIntegration[],
): string {
  const match = catalog.find((integration) =>
    isMcpIntegrationUrl(integration, server.url),
  );
  if (match) return match.id;
  const slug = server.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "mcp-server";
}
