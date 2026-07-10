import { agentNativePath } from "../api-path.js";

export interface IntegrationEnvStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
  helpText?: string;
}

export interface ClientIntegrationStatus {
  platform: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  details?: Record<string, unknown>;
  error?: string;
  webhookUrl?: string;
  requiredEnvKeys?: IntegrationEnvStatus[];
}

export interface SavedEnvVarsResult {
  saved: string[];
  storage?: string;
}

export class IntegrationClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "IntegrationClientError";
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) {
      throw new IntegrationClientError(
        "Integration response was not valid JSON.",
        response.status,
      );
    }
    payload = null;
  }
  if (response.ok) return payload as T;

  const error =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : response.statusText || `Request failed (HTTP ${response.status})`;
  throw new IntegrationClientError(error, response.status);
}

async function integrationRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return readResponse<T>(await fetch(agentNativePath(path), init));
}

export async function listIntegrationStatuses(): Promise<
  ClientIntegrationStatus[]
> {
  const result = await integrationRequest<unknown>(
    "/_agent-native/integrations/status",
  );
  return Array.isArray(result) ? (result as ClientIntegrationStatus[]) : [];
}

export async function setIntegrationEnabled(
  platform: string,
  enabled: boolean,
): Promise<unknown> {
  return integrationRequest(
    `/_agent-native/integrations/${encodeURIComponent(platform)}/${enabled ? "enable" : "disable"}`,
    { method: "POST" },
  );
}

export async function setupIntegration(platform: string): Promise<unknown> {
  return integrationRequest(
    `/_agent-native/integrations/${encodeURIComponent(platform)}/setup`,
    { method: "POST" },
  );
}

export async function listIntegrationEnvStatuses(): Promise<
  IntegrationEnvStatus[]
> {
  const result = await integrationRequest<unknown>("/_agent-native/env-status");
  return Array.isArray(result) ? (result as IntegrationEnvStatus[]) : [];
}

export async function saveIntegrationEnvVars(
  vars: Array<{ key: string; value: string }>,
): Promise<SavedEnvVarsResult> {
  return integrationRequest<SavedEnvVarsResult>("/_agent-native/env-vars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vars }),
  });
}
