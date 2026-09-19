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

export interface ClientIntegrationInstallation {
  id: string;
  platform: string;
  installationKey: string;
  teamId: string | null;
  teamName: string | null;
  enterpriseId: string | null;
  enterpriseName: string | null;
  scopes: string[];
  ownerEmail: string;
  orgId: string | null;
  status: "connected" | "disconnected" | "revoked" | "error";
  health: "unknown" | "healthy" | "degraded" | "revoked";
  lastError: string | null;
  healthCheckedAt: number | null;
  tokenExpiresAt: number | null;
  updatedAt: number;
}

export interface ClientIntegrationScope {
  id: string;
  platform: string;
  tenantId: string;
  conversationId: string;
  conversationType: "channel" | "direct_message" | "group_direct_message";
  trust: "trusted" | "guest" | "external_shared" | "unknown";
  orgId: string | null;
  serviceOwnerEmail: string;
  defaultModel: string | null;
  policy: {
    requireMention: boolean;
    allowDirectMessages: boolean;
    allowGuests: boolean;
    allowExternalShared: boolean;
    allowUnknownTrust: boolean;
  };
  updatedAt: number;
}

export interface ClientIntegrationUsageBudget {
  id: string;
  subjectType: "org" | "user" | "scope";
  subjectId: string;
  period: "day" | "month";
  limitMicros: number;
  thresholdBps: number;
  updatedAt: number;
}

export interface ClientIntegrationMemory {
  name: string;
  path: string;
  updatedAt: number;
  size: number;
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

export function managedIntegrationOAuthUrl(
  platform: string,
  returnPath = "/messaging",
): string {
  const query = new URLSearchParams({ return: returnPath });
  return agentNativePath(
    `/_agent-native/integrations/${encodeURIComponent(platform)}/oauth/install?${query}`,
  );
}

export function managedSlackAgentManifestUrl(): string {
  return agentNativePath("/_agent-native/integrations/slack/manifest");
}

export async function listManagedIntegrationInstallations(
  platform?: string,
): Promise<ClientIntegrationInstallation[]> {
  const query = platform
    ? `?${new URLSearchParams({ platform }).toString()}`
    : "";
  const result = await integrationRequest<{
    installations?: ClientIntegrationInstallation[];
  }>(`/_agent-native/integrations/installations${query}`);
  return Array.isArray(result.installations) ? result.installations : [];
}

export async function testManagedIntegrationInstallation(
  id: string,
): Promise<ClientIntegrationInstallation | null> {
  const result = await integrationRequest<{
    installation?: ClientIntegrationInstallation | null;
  }>("/_agent-native/integrations/installations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action: "test" }),
  });
  return result.installation ?? null;
}

export async function disconnectManagedIntegrationInstallation(
  id: string,
): Promise<ClientIntegrationInstallation | null> {
  const result = await integrationRequest<{
    installation?: ClientIntegrationInstallation | null;
  }>("/_agent-native/integrations/installations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action: "disconnect" }),
  });
  return result.installation ?? null;
}

export async function listManagedIntegrationScopes(
  platform?: string,
): Promise<ClientIntegrationScope[]> {
  const query = platform
    ? `?${new URLSearchParams({ platform }).toString()}`
    : "";
  const result = await integrationRequest<{
    scopes?: ClientIntegrationScope[];
  }>(`/_agent-native/integrations/scopes${query}`);
  return Array.isArray(result.scopes) ? result.scopes : [];
}

export async function saveManagedIntegrationScope(
  scope: Omit<ClientIntegrationScope, "id" | "updatedAt">,
): Promise<ClientIntegrationScope> {
  const result = await integrationRequest<{ scope: ClientIntegrationScope }>(
    "/_agent-native/integrations/scopes",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scope),
    },
  );
  return result.scope;
}

export async function listManagedIntegrationBudgets(): Promise<
  ClientIntegrationUsageBudget[]
> {
  const result = await integrationRequest<{
    budgets?: ClientIntegrationUsageBudget[];
  }>("/_agent-native/integrations/budgets");
  return Array.isArray(result.budgets) ? result.budgets : [];
}

export async function saveManagedIntegrationBudget(input: {
  subject:
    | { type: "org"; orgId: string }
    | { type: "user"; userEmail: string }
    | {
        type: "scope";
        scope: { platform: string; tenantId: string; conversationId: string };
      };
  period: "day" | "month";
  limitMicros: number;
  thresholdBps?: number;
}): Promise<ClientIntegrationUsageBudget> {
  const result = await integrationRequest<{
    budget: ClientIntegrationUsageBudget;
  }>("/_agent-native/integrations/budgets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return result.budget;
}

export async function listManagedIntegrationMemory(
  scopeId: string,
): Promise<ClientIntegrationMemory[]> {
  const query = new URLSearchParams({ scopeId });
  const result = await integrationRequest<{
    memories?: ClientIntegrationMemory[];
  }>(`/_agent-native/integrations/memory?${query}`);
  return Array.isArray(result.memories) ? result.memories : [];
}

export async function forgetManagedIntegrationMemory(
  scopeId: string,
  name: string,
): Promise<void> {
  await integrationRequest("/_agent-native/integrations/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "forget", scopeId, name }),
  });
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
