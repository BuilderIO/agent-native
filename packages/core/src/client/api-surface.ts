/**
 * Some surfaces are framed by a host and carry no agent-native session at all —
 * Builder's Design tab frames a canvas that owns no design row and holds no
 * credential. Every `/_agent-native/*` call from one is unauthenticated by
 * construction, so the client must not make them: a 401 per poll buries real
 * failures, and a write can never land.
 */

let disabledReason: string | null = null;

/** Pass `null` to re-enable, so a surface can be entered and left. */
export function setAgentNativeApiDisabled(reason: string | null): void {
  disabledReason = reason?.trim() ? reason.trim() : null;
}

export function agentNativeApiDisabledReason(): string | null {
  return disabledReason;
}

/**
 * Thrown rather than resolved: a caller that cannot tell "no backend" from
 * "empty result" reports success for work that never happened.
 */
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
