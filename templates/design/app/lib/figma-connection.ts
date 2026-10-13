import {
  WorkspaceAppMountResolutionError,
  agentNativePath,
} from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/hooks";
import {
  FIGMA_FILE_URL_TOKEN_VALIDATION_CODE,
  isFigmaFileUrl,
} from "@shared/figma-url";

export const FIGMA_ACCESS_TOKEN_SECRET_KEY = "FIGMA_ACCESS_TOKEN";

export class FigmaFileUrlUsedAsTokenError extends Error {
  constructor() {
    super("Paste a Figma access token, not a Figma file URL.");
    this.name = "FigmaFileUrlUsedAsTokenError";
  }
}

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
  managed?: boolean;
}

function secretsEndpoint(): string {
  return agentNativePath("/_agent-native/secrets");
}

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

function redactSubmittedSecret(message: string, secret: string): string {
  const encoded = encodeURIComponent(secret);
  const jsonEscaped = JSON.stringify(secret).slice(1, -1);
  return [secret, encoded, jsonEscaped]
    .filter(
      (candidate, index, values) =>
        Boolean(candidate) && values.indexOf(candidate) === index,
    )
    .reduce(
      (sanitized, candidate) => sanitized.split(candidate).join("[redacted]"),
      message,
    );
}

export async function getFigmaConnectionStatus(options?: {
  signal?: AbortSignal;
}): Promise<FigmaConnectionStatus> {
  const response = await fetch(secretsEndpoint(), {
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

  // An invalid user-vault token wins over any managed fallback because the
  // importer resolves that scoped row first. Prompt the user to replace it.
  // For an unset vault row, ask the authenticated runtime whether it has a
  // usable managed credential. This returns only a boolean and follows the
  // same request-scoped resolver as Figma imports.
  const managedAvailable =
    figma.status === "unset"
      ? await callAction<{ available: boolean }>(
          "get-figma-connection-status",
          {},
          { method: "GET", signal: options?.signal },
        )
          .then((result) => result.available)
          .catch((error) => {
            if (error instanceof WorkspaceAppMountResolutionError) throw error;
            return false;
          })
      : false;

  return {
    connected: figma.status === "set" || managedAvailable,
    status: managedAvailable ? "set" : figma.status,
    key: FIGMA_ACCESS_TOKEN_SECRET_KEY,
    label: figma.label,
    description: figma.description,
    docsUrl: figma.docsUrl,
    last4: figma.last4,
    updatedAt: figma.updatedAt,
    managed: managedAvailable || undefined,
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
  if (isFigmaFileUrl(token)) throw new FigmaFileUrlUsedAsTokenError();

  const endpoint = `${secretsEndpoint()}/${FIGMA_ACCESS_TOKEN_SECRET_KEY}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: token }),
    });
  } catch (reason) {
    const message =
      reason instanceof Error && reason.message.trim()
        ? reason.message
        : "Could not connect Figma.";
    throw new Error(redactSubmittedSecret(message, token));
  }
  if (!response.ok) {
    let payload: { error?: unknown; validationCode?: unknown } | null;
    try {
      payload = (await response.json()) as {
        error?: unknown;
        validationCode?: unknown;
      } | null;
    } catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause;
      throw new Error(
        redactSubmittedSecret(
          `Could not connect Figma (${response.status})`,
          token,
        ),
      );
    }
    if (payload?.validationCode === FIGMA_FILE_URL_TOKEN_VALIDATION_CODE) {
      throw new FigmaFileUrlUsedAsTokenError();
    }
    const message =
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error
        : `Could not connect Figma (${response.status})`;
    throw new Error(redactSubmittedSecret(message, token));
  }

  notifySecretsChanged();
  return getFigmaConnectionStatus();
}
