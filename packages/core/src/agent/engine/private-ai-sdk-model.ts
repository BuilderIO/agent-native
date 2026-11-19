import type { wrapLanguageModel } from "ai";

import {
  PrivateCompletionError,
  toPrivateCompletionError,
} from "./private-completion-error.js";
import { ProviderAuthenticationError } from "./provider-auth-error.js";
import type { EngineEvent } from "./types.js";

/**
 * Type-only aliases taken from the INSTALLED `ai` package so this module adds
 * no direct dependency on `@ai-sdk/provider`. `ai` is an optional peer/dev
 * dependency of `packages/core`; the import is erased at runtime.
 */
export type PrivateLanguageModelV3 = Parameters<
  typeof wrapLanguageModel
>[0]["model"];

export type PrivateLanguageModelV3StreamResult = Awaited<
  ReturnType<PrivateLanguageModelV3["doStream"]>
>;

export type PrivateLanguageModelV3StreamPart =
  PrivateLanguageModelV3StreamResult["stream"] extends ReadableStream<
    infer Part
  >
    ? Part
    : never;

/** The single global the AI SDK reads synchronously inside `streamText`. */
const TELEMETRY_REGISTRY_KEY = "AI_SDK_TELEMETRY_INTEGRATIONS";

function readGlobalTelemetryRegistry(): unknown {
  return (globalThis as Record<string, unknown>)[TELEMETRY_REGISTRY_KEY];
}

/**
 * True when the (possibly absent) global telemetry registry is unsafe for a
 * private call. `undefined`/`null` and an empty array are safe; any non-array
 * value or any non-empty array is not.
 *
 * `getGlobalTelemetryIntegration()` unions this global list unconditionally and
 * `streamText` captures it synchronously at call time, so the only way to keep
 * globally registered handlers from receiving prompt/content is to not call the
 * SDK at all when one is present.
 */
export function isUnsafeTelemetryRegistry(registry: unknown): boolean {
  if (registry === undefined || registry === null) return false;
  if (!Array.isArray(registry)) return true;
  return registry.length > 0;
}

/**
 * Synchronous, fail-closed telemetry guard. Reads (never mutates) the global
 * registry and throws a fixed app-owned error when it is unsafe. Must be
 * invoked immediately before `streamText` with no `await` in between, because
 * the SDK captures the registry synchronously.
 */
export function assertNoGlobalTelemetryIntegration(provider: unknown): void {
  if (isUnsafeTelemetryRegistry(readGlobalTelemetryRegistry())) {
    throw new PrivateCompletionError(provider);
  }
}

type FinishStreamPart = Extract<
  PrivateLanguageModelV3StreamPart,
  { type: "finish" }
>;

function sanitizeFinishPart(part: FinishStreamPart): FinishStreamPart {
  const { providerMetadata: _providerMetadata, ...rest } = part;
  // A malformed provider can omit usage despite the declared type.
  const { raw: _rawUsage, ...usage } = ((part.usage as
    | FinishStreamPart["usage"]
    | undefined) ?? {}) as Record<string, unknown>;
  return {
    ...rest,
    usage: usage as FinishStreamPart["usage"],
    finishReason: { ...part.finishReason, raw: undefined },
  };
}

/**
 * Per-invocation view of a provider `LanguageModelV3` that keeps
 * provider-controlled warnings, raw stream payloads, request/response bodies,
 * and error text out of every AI SDK sink that derives its data from the model
 * boundary. Reports `v3` so the SDK passes it through unchanged.
 *
 * This is a local boundary only: it sits above the provider package and cannot
 * bound a provider's own logging (see the engine's `supportsPrivateContent`
 * gate). It never touches a process global.
 */
export function privateLanguageModelV3(
  model: unknown,
  options: { provider?: unknown } = {},
): PrivateLanguageModelV3 {
  const fallbackProvider = options.provider ?? "model";
  const version = (model as { specificationVersion?: unknown } | null)
    ?.specificationVersion;
  // A v2 model would trigger the SDK's own v2 compatibility warning before any
  // wrapper transform runs, so the private path fails closed instead.
  if (version !== "v3") {
    throw new PrivateCompletionError(fallbackProvider);
  }

  const v3 = model as PrivateLanguageModelV3;
  return {
    specificationVersion: "v3",
    provider: v3.provider,
    modelId: v3.modelId,
    supportedUrls: v3.supportedUrls,
    doGenerate() {
      // The private engine only streams. Refuse rather than forward a
      // potentially sensitive non-streaming request by accident.
      throw new PrivateCompletionError(fallbackProvider);
    },
    async doStream(callOptions) {
      const result = await v3.doStream(callOptions);
      // Intentionally forward only `stream`: dropping `result.request` and
      // `result.response` removes raw request/response bodies from the step
      // result, `start-step`, and every telemetry payload.
      return {
        stream: result.stream.pipeThrough(
          new TransformStream<
            PrivateLanguageModelV3StreamPart,
            PrivateLanguageModelV3StreamPart
          >({
            transform(part, controller) {
              // Never forward raw provider payloads.
              if (part.type === "raw") return;
              if (part.type === "stream-start") {
                // Empties recorded warnings so the SDK's logWarnings()
                // returns before it can reach console.warn.
                controller.enqueue({ ...part, warnings: [] });
                return;
              }
              if (part.type === "error") {
                // Canonicalize provider failure text before the SDK (and its
                // default onError) can see it.
                controller.enqueue({
                  ...part,
                  error: toPrivateCompletionError(part.error, fallbackProvider),
                });
                return;
              }
              if (part.type === "finish") {
                controller.enqueue(sanitizeFinishPart(part));
                return;
              }
              controller.enqueue(part);
            },
          }),
        ),
      };
    },
  };
}

/**
 * Canonicalizes an engine event on the private path. Non-stop events pass
 * through. The typed app-owned authentication failure is preserved exactly
 * (its code/provider/status drive the credential marker and are already free
 * of provider text); every other error stop is retyped so no raw error
 * message, error code, request id, upgrade url, or provider string escapes.
 */
export function toPrivateEngineEvent(
  event: EngineEvent,
  fallbackProvider: unknown = "model",
): EngineEvent {
  if (event.type === "tool-call-error") {
    return new PrivateCompletionError(fallbackProvider).stopEvent();
  }
  if (event.type !== "stop" || event.reason !== "error") return event;
  if (
    event.errorCode === "http_401" ||
    event.errorCode === "builder_auth_error"
  ) {
    const status =
      event.statusCode ?? (event.errorCode === "http_401" ? 401 : undefined);
    const canonical = new ProviderAuthenticationError(
      event.provider ?? "model",
      status,
    ).stopEvent();
    // Keep the existing identity only for an exact canonical event. A provider
    // can claim an auth code while attaching its response text or request id.
    const fields = Object.entries(canonical);
    if (
      Object.keys(event).length === fields.length &&
      fields.every(
        ([key, value]) =>
          (event as unknown as Record<string, unknown>)[key] === value,
      )
    )
      return event;
    return new PrivateCompletionError(fallbackProvider, {
      ...(status !== undefined ? { status } : {}),
    }).stopEvent();
  }
  return toPrivateCompletionError(event, fallbackProvider).stopEvent();
}
