import type {
  MultiFrontierIpcEvent,
  MultiFrontierProviderId,
  MultiFrontierRendererState,
} from "../../../shared/multi-frontier-ipc.js";

export interface MultiFrontierAutoContinueSettings {
  autoContinueAfterAgreement: boolean;
}

export interface MultiFrontierRendererNotice {
  id: string;
  kind: "info" | "failure";
  message: string;
}

export function initialMultiFrontierRunAutoContinue(
  settings: MultiFrontierAutoContinueSettings,
): boolean {
  return settings.autoContinueAfterAgreement;
}

export function locksMultiFrontierMode(
  state?: Pick<MultiFrontierRendererState, "phase">,
): boolean {
  if (!state) return false;
  return !["completed", "failed", "canceled"].includes(state.phase);
}

export function providerOperationFailureNotice(
  providerId: MultiFrontierProviderId,
  operation: "connect" | "refresh" | "load",
  id: string,
): MultiFrontierRendererNotice {
  const provider = providerId === "codex" ? "Codex" : "Claude";
  const action =
    operation === "connect"
      ? "connect"
      : operation === "refresh"
        ? "refresh subscription status"
        : "load subscription status";
  return {
    id,
    kind: "failure",
    message: `Could not ${action} for ${provider}. Try again or check its local sign-in.`,
  };
}

export function readNewerMultiFrontierSnapshot(
  collaborationId: string,
  sequence: number,
  event: MultiFrontierIpcEvent,
): {
  sequence: number;
  snapshot?: MultiFrontierRendererState;
  notice?: MultiFrontierRendererNotice;
} | null {
  if (event.collaborationId !== collaborationId) return null;
  if (event.sequence <= sequence) return null;
  return {
    sequence: event.sequence,
    snapshot: event.snapshot,
    ...(event.event?.kind === "notice" || event.event?.kind === "lifecycle"
      ? { notice: boundedNotice(event) }
      : {}),
  };
}

function boundedNotice(
  event: MultiFrontierIpcEvent,
): MultiFrontierRendererNotice | undefined {
  const message = event.event?.text
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 512);
  if (!message) return undefined;
  return {
    id: `${event.collaborationId}:${event.sequence}`,
    kind: "info",
    message,
  };
}
