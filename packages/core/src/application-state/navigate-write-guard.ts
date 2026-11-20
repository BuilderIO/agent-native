import { isAgentCaller } from "../action-caller.js";
import {
  currentActionOriginCaller,
  insideReadOnlyAction,
} from "../action-frame.js";

export class AgentNavigationRefusedError extends Error {
  readonly code = "agent_navigation_refused";
  constructor(message: string) {
    super(message);
    this.name = "AgentNavigationRefusedError";
  }
}

/**
 * Refuses a navigate command (account-wide or tab-scoped) written while an
 * agent's read-only action runs. Reading data never moves the user's view.
 * The store calls this on every write, so no helper can route around it.
 */
export function assertNavigateWriteAllowed(key: string): void {
  if (key !== "navigate" && !key.startsWith("navigate:")) return;
  if (!insideReadOnlyAction()) return;
  if (!isAgentCaller(currentActionOriginCaller())) return;
  throw new AgentNavigationRefusedError(
    'Refused: a read-only action cannot move the user\'s view. Read the data and answer; call navigate with intent: "open" only if the user asked to see it.',
  );
}
