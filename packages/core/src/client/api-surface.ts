/**
 * Some surfaces are framed by a host and carry no agent-native session at all —
 * Builder's Design tab frames a canvas that owns no design row and holds no
 * credential. Every `/_agent-native/*` call from one is unauthenticated by
 * construction, so the client must not make them: a 401 per poll buries real
 * failures, and a write can never land.
 */

let disabledReason: string | null = null;

export function setAgentNativeApiDisabled(reason: string | null): void {
  disabledReason = reason?.trim() ? reason.trim() : null;
}

export function agentNativeApiDisabledReason(): string | null {
  return disabledReason;
}

export class AgentNativeApiDisabledError extends Error {
  readonly reason: string;

  constructor(detail: string) {
    const reason = disabledReason ?? "unknown surface";
    super(
      `agent-native API is disabled on this surface (${reason}): ${detail}`,
    );
    this.name = "AgentNativeApiDisabledError";
    this.reason = reason;
  }
}

export function assertAgentNativeApiEnabled(detail: string): void {
  if (disabledReason) throw new AgentNativeApiDisabledError(detail);
}

/**
 * A directory MCP widget runs on a read-only scoped session: the server refuses
 * every application-state read and write for it. The client refuses first, so
 * those calls never reach the network and a refusal is never mistaken for a
 * dropped connection.
 */
export class AgentNativeReadOnlySurfaceError extends Error {
  constructor(detail: string) {
    super(
      `agent-native application state is unavailable on a read-only widget session: ${detail}`,
    );
    this.name = "AgentNativeReadOnlySurfaceError";
  }
}
