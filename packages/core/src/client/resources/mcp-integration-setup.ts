import type { DefaultMcpIntegration } from "./mcp-integration-catalog.js";

export function isMcpIntegrationOAuthAvailable(
  integration: DefaultMcpIntegration,
): boolean {
  if (integration.authMode !== "oauth") return false;
  if (integration.managedOAuth) return true;
  if (integration.availability !== "client-restricted") return true;
  // Canva's restriction is client-domain setup, not an unapproved-client gate.
  return integration.id === "canva";
}
