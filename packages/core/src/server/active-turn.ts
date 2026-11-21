import { isProductionServerlessFunctionRuntime } from "../db/migration-runtime.js";
import { recordChange } from "./poll.js";
import { getRequestUserEmail } from "./request-context.js";

const ACTIVE_TURN_TTL_MS = 30_000;

export function markActiveTurn(owner = getRequestUserEmail()): void {
  if (!owner || !isProductionServerlessFunctionRuntime()) return;
  recordChange({
    source: "active_turn",
    type: "change",
    owner,
    activeUntil: Date.now() + ACTIVE_TURN_TTL_MS,
  });
}
