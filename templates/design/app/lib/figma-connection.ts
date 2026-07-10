import { agentNativePath } from "@agent-native/core/client";

export const FIGMA_ACCESS_TOKEN_SECRET_KEY = "FIGMA_ACCESS_TOKEN";

interface RegisteredSecretStatus {
  key: string;
  label: string;
  description?: string;
  docsUrl?: string;
  status: "set" | "unset" | "invalid";
  last4?: string;
  updatedAt?: number;
}

export interface FigmaConnectionStatus {
  connected: boolean;
  status: RegisteredSecretStatus["status"];
  key: typeof FIGMA_ACCESS_TOKEN_SECRET_KEY;
  label: string;
  description?: string;
  docsUrl?: string;
  last4?: string;
  updatedAt?: number;
}

const SECRETS_ENDPOINT = agentNativePath("/_agent-native/secrets");

async function responseError(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return typeof payload?.error === "string" && payload.error.trim()
    ? payload.error
    : `${fallback} (${response.status})`;
}

function notifySecretsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agent-engine:configured-changed", {
      detail: { source: "secrets", key: FIGMA_ACCESS_TOKEN_SECRET_KEY },
    }),
  );
}

/**
 * Read Figma connection metadata without ever returning the token value.
 * Both the chat URL affordance and Import panel should share this helper.
 */
export async function getFigmaConnectionStatus(options?: {
  signal?: AbortSignal;
}): Promise<FigmaConnectionStatus> {
  const response = await fetch(SECRETS_ENDPOINT, {
    method: "GET",
    credentials: "same-origin",
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new Error(
      await responseError(response, "Could not check the Figma connection"),
    );
  }

  const secrets = (await response.json()) as RegisteredSecretStatus[];
  const figma = secrets.find(
    (secret) => secret.key === FIGMA_ACCESS_TOKEN_SECRET_KEY,
  );
  if (!figma) {
    throw new Error("Figma connection is not registered for this app.");
  }

  return {
    connected: figma.status === "set",
    status: figma.status,
    key: FIGMA_ACCESS_TOKEN_SECRET_KEY,
    label: figma.label,
    description: figma.description,
    docsUrl: figma.docsUrl,
    last4: figma.last4,
    updatedAt: figma.updatedAt,
  };
}

/**
 * Validate and save a user-scoped Figma token through the encrypted secrets
 * route. This deliberately is not an action: action arguments can appear in
 * tool/run ledgers, while secret values must never enter agent context.
 */
export async function saveFigmaAccessToken(
  value: string,
): Promise<FigmaConnectionStatus> {
  const token = value.trim();
  if (!token) throw new Error("Enter a Figma access token.");

  const response = await fetch(
    `${SECRETS_ENDPOINT}/${FIGMA_ACCESS_TOKEN_SECRET_KEY}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: token }),
    },
  );
  if (!response.ok) {
    const message = await responseError(response, "Could not connect Figma");
    // The server already redacts validator/storage errors. Keep a final client
    // boundary so a misbehaving intermediary cannot reflect the submitted key.
    throw new Error(message.split(token).join("[redacted]"));
  }

  notifySecretsChanged();
  return getFigmaConnectionStatus();
}
