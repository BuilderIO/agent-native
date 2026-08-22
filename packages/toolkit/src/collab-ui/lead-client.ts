import type { Awareness } from "y-protocols/awareness";

import { AGENT_CLIENT_ID } from "./agent-identity.js";

// Exactly one visible non-agent client may apply an external snapshot; allowing
// every client to reconcile it duplicates concurrent CRDT inserts.
export function isReconcileLeadClient(
  awareness: Awareness | null | undefined,
  localClientId: number | null | undefined,
): boolean {
  if (localClientId == null) return false;
  if (!awareness) return true;

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
    // Read-only viewers subscribe to awareness for presence but bind no Y.Doc,
    // so electing one stops external snapshots reconciling anywhere. Absent
    // (legacy clients that never publish the field) still counts as eligible.
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
