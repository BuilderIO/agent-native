import { agentNativePath } from "./api-path.js";

export type SecretSource = "personal" | "workspace" | "vault";

export interface SecretStatus {
  key: string;
  label: string;
  description?: string;
  docsUrl?: string;
  scope: "user" | "workspace" | "org";
  kind: "api-key" | "oauth";
  required: boolean;
  status: "set" | "unset" | "invalid" | "unknown";
  source?: SecretSource;
  managedHere?: boolean;
  overrides?: "vault" | "workspace";
  last4?: string;
  updatedAt?: number;
  oauthProvider?: string;
  oauthConnectUrl?: string;
  error?: string;
}

export async function listRegisteredSecrets(
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<SecretStatus[]> {
  const response = await fetch(agentNativePath("/_agent-native/secrets"), {
    credentials: "same-origin",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to load secrets (${response.status})`);
  }
  const secrets: unknown = await response.json();
  if (!Array.isArray(secrets)) {
    throw new Error("Invalid registered secrets response");
  }
  return secrets as SecretStatus[];
}
