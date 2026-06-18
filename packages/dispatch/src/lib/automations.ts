import { agentNativePath } from "@agent-native/core/client";

export interface DispatchAutomationItem {
  id: string;
  name: string;
  path: string;
  owner: string;
  canUpdate?: boolean;
  triggerType?: "schedule" | "event" | string;
  event?: string;
  schedule?: string;
  scheduleDescription?: string;
  condition?: string;
  mode?: string;
  domain?: string;
  enabled?: boolean;
  lastStatus?: string;
  lastRun?: string;
  lastError?: string;
  nextRun?: string;
  createdBy?: string;
}

export interface SetDispatchAutomationEnabledInput {
  owner: string;
  path: string;
  enabled: boolean;
}

async function readAutomationResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error)
        : "Automation request failed";
    throw new Error(message);
  }
  return data as T;
}

export async function listDispatchAutomations(): Promise<
  DispatchAutomationItem[]
> {
  const response = await fetch(agentNativePath("/_agent-native/automations"));
  if (!response.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export async function setDispatchAutomationEnabled(
  input: SetDispatchAutomationEnabledInput,
): Promise<DispatchAutomationItem> {
  const response = await fetch(agentNativePath("/_agent-native/automations"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readAutomationResponse<DispatchAutomationItem>(response);
}
