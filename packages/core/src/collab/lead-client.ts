import type { Awareness } from "y-protocols/awareness";

import { AGENT_CLIENT_ID } from "./agent-identity.js";

export function isReconcileLeadClient(
  awareness: Awareness | null | undefined,
  localClientId: number | null | undefined,
): boolean {
  if (localClientId == null) return false;
  if (!awareness) return true;

  const localState = awareness.getStates().get(localClientId) as
    | { canFlushDocument?: boolean }
    | undefined;
  if (localState?.canFlushDocument === false) return false;

  let hasPeer = false;
  let minVisible = localClientId;
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === AGENT_CLIENT_ID || clientId === localClientId) return;
    const candidate = state as {
      user?: unknown;
      visible?: boolean;
      canFlushDocument?: boolean;
    };
    if (!candidate?.user) return;
    if (candidate.canFlushDocument === false) return;
    hasPeer = true;
    if (candidate.visible !== false && clientId < minVisible) {
      minVisible = clientId;
    }
  });

  if (!hasPeer) return true;

  const localHidden =
    typeof document !== "undefined" && document.visibilityState === "hidden";
  if (localHidden) return false;
  return localClientId <= minVisible;
}
