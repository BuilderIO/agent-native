import { agentNativePath } from "@agent-native/core/client/api-path";

export interface DispatchAutomationItem {
  id: string;
  name: string;
  path: string;
  owner: string;
  appId?: string;
  scope?: "personal" | "organization";
  canUpdate?: boolean;
  triggerType?: "schedule" | "event" | string;
  event?: string;
  schedule?: string;
  scheduleDescription?: string;
  condition?: string;
  mode?: string;
  domain?: string;
  enabled?: boolean;
  timezone?: string;
  lastStatus?: string;
  lastRun?: string;
  lastCheck?: string;
  lastError?: string;
  nextRun?: string;
  createdBy?: string;
  body?: string;
  model?: string;
  mcpTools?: string[];
  runAs?: "creator" | "shared";
  executionHostId?: string;
  executionEngine?: string;
  executionCwd?: string;
  deliveryPlatform?: string;
  deliveryDestination?: string;
  deliveryThreadRef?: string;
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
  const rows = await readAutomationResponse<unknown>(response);
  if (!Array.isArray(rows)) {
    throw new Error("Automation list returned an invalid response");
  }
  return rows as DispatchAutomationItem[];
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
