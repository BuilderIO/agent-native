/**
 * Registration seam for an OpenTelemetry SDK.
 *
 * Core emits spans and metrics through structural provider interfaces and never
 * depends on the SDK or an exporter. A host (for example `@agent-native/otel`)
 * builds the SDK providers and hands them to core here. With nothing
 * registered, metrics are no-ops and tracing falls back to the global
 * `@opentelemetry/api` provider.
 *
 * `forceFlush()` is optional on both providers. When present, core calls it on
 * the awaited response hook, because serverless functions freeze between
 * invocations and a periodic export timer never fires.
 */

export interface ObservabilityTracerProvider {
  getTracer(name: string, version?: string): unknown;
  forceFlush?(): Promise<void>;
}

export interface ObservabilityMeterProvider {
  getMeter(name: string, version?: string): unknown;
  forceFlush?(): Promise<void>;
}

export interface ObservabilityProvider {
  tracerProvider?: ObservabilityTracerProvider;
  meterProvider?: ObservabilityMeterProvider;
}

let registeredProvider: ObservabilityProvider | undefined;

/**
 * Register the process's OpenTelemetry providers. A later registration
 * replaces an earlier one. Returns a function that unregisters this provider
 * if it is still the registered one.
 */
export function registerObservabilityProvider(
  provider: ObservabilityProvider,
): () => void {
  registeredProvider = provider;
  return () => {
    if (registeredProvider === provider) registeredProvider = undefined;
  };
}

export function getRegisteredObservabilityProvider():
  | ObservabilityProvider
  | undefined {
  return registeredProvider;
}
