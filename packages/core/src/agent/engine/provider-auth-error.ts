import { PROVIDER_ENV_META } from "./provider-env-vars.js";
import { EngineError, type EngineEvent } from "./types.js";

const PROVIDER_NAMES = new Set([...Object.keys(PROVIDER_ENV_META), "builder"]);

export function credentialFailureProvider(key: string): string {
  const match = Object.entries(PROVIDER_ENV_META).find(
    ([, meta]) => meta.envVar === key,
  );
  return match?.[0] ?? "model";
}

/** Authentication failures never retain a provider response, prompt, or cause. */
export class ProviderAuthenticationError extends EngineError {
  readonly provider: string;
  readonly code: string;

  constructor(provider: string, status?: number) {
    const safeProvider = PROVIDER_NAMES.has(provider) ? provider : "model";
    const safeStatus =
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
        ? status
        : undefined;
    super(
      safeProvider === "builder"
        ? "Builder authentication failed. Sign in to Builder.io again in Settings (free tier available)."
        : "The model provider rejected the saved API key. Update it in Settings.",
      {
        errorCode:
          safeProvider === "builder"
            ? "builder_auth_error"
            : safeStatus === undefined
              ? "provider_auth_error"
              : `http_${safeStatus}`,
        ...(safeStatus !== undefined ? { statusCode: safeStatus } : {}),
      },
    );
    this.name = "ProviderAuthenticationError";
    this.provider = safeProvider;
    this.code = this.errorCode ?? "provider_auth_error";
  }

  details() {
    return {
      message: this.message,
      provider: this.provider,
      code: this.code,
      ...(this.statusCode !== undefined ? { status: this.statusCode } : {}),
    };
  }

  stopEvent(): EngineEvent {
    return {
      type: "stop",
      reason: "error",
      error: this.message,
      errorCode: this.code,
      provider: this.provider,
      ...(this.statusCode !== undefined ? { statusCode: this.statusCode } : {}),
    };
  }
}
