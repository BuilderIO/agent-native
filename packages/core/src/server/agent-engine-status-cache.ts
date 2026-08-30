export interface AgentEngineStatusResult {
  configured: boolean;
  engine?: string;
  model?: string;
  source?: "settings" | "env" | "app_secrets";
  envVar?: string;
  openAiBaseUrlConfigured?: boolean;
}

const agentEngineStatusInFlight = new Map<
  string,
  Promise<AgentEngineStatusResult>
>();

/**
 * Share concurrent status probes, but let credential mutations discard an
 * older answer before the next probe joins it.
 */
export function shareAgentEngineStatusLookup(
  identityKey: string,
  compute: () => Promise<AgentEngineStatusResult>,
): Promise<AgentEngineStatusResult> {
  const existing = agentEngineStatusInFlight.get(identityKey);
  if (existing) return existing;
  const started = compute().finally(() => {
    if (agentEngineStatusInFlight.get(identityKey) === started) {
      agentEngineStatusInFlight.delete(identityKey);
    }
  });
  agentEngineStatusInFlight.set(identityKey, started);
  return started;
}

/** Drop in-flight answers that predate a provider/settings mutation. */
export function invalidateAgentEngineStatusLookups(): void {
  agentEngineStatusInFlight.clear();
}

export function agentEngineStatusIdentityKey(
  userEmail: string | undefined,
  orgId: string | undefined,
): string {
  return `${userEmail ?? ""}\u0000${orgId ?? ""}`;
}
