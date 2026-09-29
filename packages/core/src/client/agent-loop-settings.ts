/**
 * Browser helpers for the agent loop limit ("Max iterations"): how many
 * steps one response may take before it pauses. The organization's for
 * members of one (owners and admins change it), otherwise the user's own.
 * The agent reads and changes the same value with `manage-agent-loop-settings`.
 */

import { agentNativePath } from "./api-path.js";

/** Other surfaces showing the limit listen for this and read `detail`. */
export const AGENT_LOOP_SETTINGS_CHANGED_EVENT = "agent-loop-settings:changed";

export interface AgentLoopSettingsStatus {
  maxIterations: number;
  defaultMaxIterations: number;
  minMaxIterations: number;
  maxMaxIterations: number;
  scope: "org" | "user" | "default";
  source: "org" | "user" | "env" | "default";
  /** Owners and admins of the organization, or a user with no organization. */
  canUpdate: boolean;
  orgId: string | null;
}

async function readLoopSettingsResponse(
  response: Response,
  fallback: string,
): Promise<AgentLoopSettingsStatus> {
  // coercion-ok: an unreadable body falls through to the errors below.
  const body: unknown = await response.json().catch(() => null);
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!response.ok) {
    throw new Error(
      typeof record?.error === "string" && record.error.trim()
        ? record.error
        : `${fallback} (HTTP ${response.status}).`,
    );
  }
  if (
    !record ||
    typeof record.maxIterations !== "number" ||
    typeof record.canUpdate !== "boolean"
  ) {
    throw new Error("Could not read the agent step limit.");
  }
  return record as unknown as AgentLoopSettingsStatus;
}

export async function fetchAgentLoopSettings(): Promise<AgentLoopSettingsStatus> {
  const response = await fetch(
    agentNativePath("/_agent-native/agent-loop-settings"),
    { credentials: "include" },
  );
  return readLoopSettingsResponse(
    response,
    "Could not load the agent step limit",
  );
}

/**
 * Save the limit. The server refuses members of an organization and values
 * outside `minMaxIterations`–`maxMaxIterations`, and the refusal is thrown.
 */
export async function saveAgentLoopMaxIterations(
  maxIterations: number,
): Promise<AgentLoopSettingsStatus> {
  const response = await fetch(
    agentNativePath("/_agent-native/agent-loop-settings"),
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxIterations }),
    },
  );
  const settings = await readLoopSettingsResponse(
    response,
    "Could not save the agent step limit",
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(AGENT_LOOP_SETTINGS_CHANGED_EVENT, { detail: settings }),
    );
  }
  return settings;
}
