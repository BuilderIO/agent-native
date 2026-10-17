import {
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "../agent/engine/credential-errors.js";
import { CONNECTION_REQUIRED_ERROR_CODE } from "./automation-outcome.js";

export interface AutomationTerminalEvent {
  type: string;
  error?: string;
  details?: string;
  errorCode?: string;
  provider?: string;
}

export function automationRunTerminalError(
  events: readonly AutomationTerminalEvent[],
): { message: string; errorCode?: string } | null {
  // A connection request ends the unattended turn with a clean `done`, but
  // nobody can answer it, even if earlier tools completed work.
  const connection = events.find(
    (event) => event.type === "connection_required",
  );
  if (connection) {
    return {
      message: `The run stopped because ${connection.provider || "a provider"} is not connected. Connect it for this automation's owner so the automation can use it.`,
      errorCode: CONNECTION_REQUIRED_ERROR_CODE,
    };
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "missing_api_key") {
      return {
        message: LLM_MISSING_CREDENTIALS_MESSAGE,
        errorCode: LLM_MISSING_CREDENTIALS_ERROR_CODE,
      };
    }
    if (event.type === "error") {
      const message = (event.error || event.details || "").trim();
      return message ? { message, errorCode: event.errorCode } : null;
    }
    if (event.type === "done") return null;
  }
  return null;
}
