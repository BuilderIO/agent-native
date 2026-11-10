// Re-mint a little before expiry so a copied link still opens for the agent.
const AGENT_LINK_EXPIRY_MARGIN_MS = 60_000;

/** When `create-agent-resource-link`'s link stops working, or null if it didn't say. */
export function agentLinkExpiresAt(expiresAt: string | undefined) {
  const parsed = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function isAgentLinkExpiring(expiresAt: number | null) {
  return (
    expiresAt !== null && expiresAt - AGENT_LINK_EXPIRY_MARGIN_MS <= Date.now()
  );
}
