import type {
  ProviderApiRequestArgs,
  ProviderApiRuntime,
} from "@agent-native/core/provider-api";

export class ContextConnectorQuotaError extends Error {
  readonly provider: string;
  readonly retryAt: string;
  readonly retryAfterMs: number;

  constructor(input: {
    provider: string;
    retryAt: string;
    retryAfterMs?: number;
  }) {
    super(`Provider quota exhausted; retry after ${input.retryAt}.`);
    this.name = "ContextConnectorQuotaError";
    this.provider = input.provider;
    this.retryAt = input.retryAt;
    this.retryAfterMs = Math.max(0, input.retryAfterMs ?? 0);
  }
}

export function isContextConnectorQuotaError(
  value: unknown,
): value is ContextConnectorQuotaError {
  return value instanceof ContextConnectorQuotaError;
}

export async function executeConnectorProviderRequest(
  runtime: Pick<ProviderApiRuntime, "executeRequest"> | undefined,
  args: ProviderApiRequestArgs,
): Promise<unknown> {
  if (!runtime) {
    throw new Error(
      `The ${args.provider} connector requires a provider API runtime.`,
    );
  }
  const raw = (await runtime.executeRequest(args)) as Record<string, unknown>;
  const response = asRecord(raw.response);
  if (!response) return raw;
  const quota = asRecord(response.quota);
  if (quota?.exhausted === true) {
    throw new ContextConnectorQuotaError({
      provider: stringValue(quota.providerId) ?? String(args.provider),
      retryAt:
        stringValue(quota.retryAt) ??
        new Date(
          Date.now() + Number(quota.retryAfterMs ?? 60_000),
        ).toISOString(),
      retryAfterMs: Number(quota.retryAfterMs ?? 0),
    });
  }
  if (response.ok !== true) {
    const status = response.status ?? "unknown";
    const detail = response.text ?? response.json ?? response.statusText ?? "";
    throw new Error(
      `Provider request failed (${String(status)}): ${brief(detail)}`,
    );
  }
  if (response.json !== undefined) return response.json;
  if (typeof response.text === "string") {
    try {
      return JSON.parse(response.text);
    } catch {
      return response.text;
    }
  }
  return null;
}

export async function connectorConnectionId(
  provider: string,
  config: Record<string, unknown>,
  resolve?: (
    provider: string,
    requestedConnectionId?: string,
  ) => Promise<string | undefined>,
): Promise<string | undefined> {
  const requested = stringValue(config.connectionId);
  const credentialMode = stringValue(config.credentialMode);
  if (credentialMode === "admin-token" || config.useAdminToken === true) {
    if (provider !== "figma") {
      throw new Error(
        `${provider} creative-context imports require a per-user granted workspace connection; admin-token mode is not allowed.`,
      );
    }
    if (requested) {
      throw new Error(
        `${provider} connector config cannot combine connectionId with admin-token credentialMode.`,
      );
    }
    return undefined;
  }
  if (!resolve) {
    throw new Error(
      `${provider} creative-context imports require a workspace connection resolver.`,
    );
  }
  const resolved = await resolve(provider, requested);
  if (!resolved) {
    throw new Error(
      `${provider} creative-context imports require a granted workspace connection.`,
    );
  }
  return resolved;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringValue).filter((item): item is string => Boolean(item))
    : [];
}

export function positiveLimit(
  value: unknown,
  fallback = 100,
  max = 1_000,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
}

export function cursorOffset(cursor: string | null | undefined): number {
  const parsed = Number(cursor ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function brief(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (text ?? "").slice(0, 500);
}
