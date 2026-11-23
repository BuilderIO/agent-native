import { registerRequiredSecret } from "@agent-native/core/secrets";

export const HUBSPOT_MCP_CLIENT_ID_KEY = "HUBSPOT_MCP_CLIENT_ID";
export const HUBSPOT_MCP_CLIENT_SECRET_KEY = "HUBSPOT_MCP_CLIENT_SECRET";
export const HUBSPOT_MCP_CLIENT_ID_LABEL = "HubSpot MCP OAuth client ID";
export const HUBSPOT_MCP_CLIENT_SECRET_LABEL =
  "HubSpot MCP OAuth client secret";

const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const HUBSPOT_DOCS_URL =
  "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server";
const TEST_TIMEOUT_MS = 10_000;

export type HubSpotTestResult =
  | { kind: "connected" }
  | { kind: "auth_failed"; message: string }
  | { kind: "unreachable"; message: string };

export type HubSpotFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text(): Promise<string> }>;

const CLIENT_REJECTED = /BAD_CLIENT|INVALID_CLIENT|UNAUTHORIZED_CLIENT/i;

export async function testHubSpotClientId(
  clientId: string,
  fetchImpl: HubSpotFetch = (url, init) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) }),
): Promise<HubSpotTestResult> {
  const id = clientId.trim();
  if (!id) return { kind: "auth_failed", message: "Client ID is empty." };
  let status: number;
  let text: string;
  try {
    const res = await fetchImpl(HUBSPOT_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: id,
        client_secret: "connection-test-placeholder",
        redirect_uri: "https://localhost/connection-test",
        code: "connection-test-placeholder",
      }).toString(),
    });
    status = res.status;
    text = await res.text().catch(() => "");
  } catch (err) {
    return {
      kind: "unreachable",
      message: `HubSpot could not be reached: ${
        err instanceof Error ? err.message : "network error"
      }`,
    };
  }
  if (status >= 500 || status === 429) {
    return {
      kind: "unreachable",
      message: `HubSpot is unavailable (HTTP ${status}). Try again shortly.`,
    };
  }
  if (status === 401 || status === 403 || CLIENT_REJECTED.test(text)) {
    return {
      kind: "auth_failed",
      message: "HubSpot did not accept this client ID.",
    };
  }
  if (status === 400) return { kind: "connected" };
  return {
    kind: "unreachable",
    message: `HubSpot returned an unexpected response (HTTP ${status}).`,
  };
}

export async function validateHubSpotClientId(
  value: string,
  fetchImpl?: HubSpotFetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await testHubSpotClientId(value, fetchImpl);
  if (result.kind === "connected") return { ok: true };
  return {
    ok: false,
    error: `${result.kind === "auth_failed" ? "Auth failed" : "Unreachable"}: ${result.message}`,
  };
}

export function registerHubSpotCredentials(): void {
  const common = {
    description:
      "Workspace-managed HubSpot MCP Auth App credential. Each member authorizes their own HubSpot account separately.",
    docsUrl: HUBSPOT_DOCS_URL,
    scope: "workspace" as const,
    kind: "api-key" as const,
    required: false,
    usedFor: [
      {
        appId: "analytics-2",
        feature: "HubSpot MCP connections",
        effectWhenRemoved:
          "Workspace members cannot start new HubSpot MCP connections.",
      },
    ],
  };
  registerRequiredSecret({
    ...common,
    key: HUBSPOT_MCP_CLIENT_ID_KEY,
    label: HUBSPOT_MCP_CLIENT_ID_LABEL,
    validator: (value: string) => validateHubSpotClientId(value),
  });
  registerRequiredSecret({
    ...common,
    key: HUBSPOT_MCP_CLIENT_SECRET_KEY,
    label: HUBSPOT_MCP_CLIENT_SECRET_LABEL,
  });
}

registerHubSpotCredentials();

export default () => {
  registerHubSpotCredentials();
};
