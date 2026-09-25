# @agent-native/otel

OpenTelemetry SDK wiring for Agent-Native apps. It builds a meter provider and a tracer provider with OTLP exporters and registers them with `@agent-native/core` through `registerObservabilityProvider()`.

It does nothing unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so apps can depend on it unconditionally.

```ts
// server/plugins/otel.ts
import { defineNitroPlugin } from "@agent-native/core/server";
import { startAgentNativeOtel } from "@agent-native/otel";

export default defineNitroPlugin(() => {
  startAgentNativeOtel();
});
```

Configuration uses the standard OpenTelemetry variables:

| Variable                                    | Effect                                                         |
| ------------------------------------------- | -------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`               | Turns export on; `/v1/metrics` and `/v1/traces` are appended   |
| `OTEL_EXPORTER_OTLP_HEADERS`                | Headers sent with every export, e.g. `Authorization=Bearer%20…` |
| `OTEL_SERVICE_NAME`                         | `service.name`                                                 |
| `OTEL_RESOURCE_ATTRIBUTES`                  | Extra resource attributes, e.g. `deployment.environment.name`  |
| `OTEL_TRACES_SAMPLER` / `_ARG`              | Trace sampling, e.g. `parentbased_traceidratio` / `0.01`       |
| `OTEL_METRICS_EXPORTER=none`                | Turns metrics off                                              |
| `OTEL_TRACES_EXPORTER=none`                 | Turns traces off                                               |

Metrics use cumulative temporality with a random `service.instance.id` per process, so each process is its own series. On serverless runtimes (Netlify, AWS Lambda, Vercel) core force-flushes both providers on every response, capped at 2 seconds; elsewhere metrics export every 60 seconds.
