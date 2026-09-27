import { agentNativePath } from "./api-path.js";

/** Where a stored value's effective source is, as reported by the server. */
export type SecretSource = "personal" | "workspace" | "vault";

export interface SecretStatus {
  key: string;
  label: string;
  description?: string;
  docsUrl?: string;
  scope: "user" | "workspace" | "org";
  kind: "api-key" | "oauth";
  required: boolean;
  /**
   * "set" = a value is in effect; "unset" = not configured; "invalid" = the
   * provider rejected the value in effect, which is still rendered like a set
   * one so it can be rotated or removed; "unknown" = the credential store
   * could not be read.
   */
  status: "set" | "unset" | "invalid" | "unknown";
  /** When the provider last rejected the value in effect (ms). */
  rejectedAt?: number;
  /** Where the effective value comes from — only present when status === "set". */
  source?: SecretSource;
  /**
   * True when the effective value is the row this UI writes for the
   * registered scope, so Rotate/Remove apply. False when a Vault or
   * workspace value is in use instead.
   */
  managedHere?: boolean;
  /** A shared value this row overrides; removing the row falls back to it. */
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
