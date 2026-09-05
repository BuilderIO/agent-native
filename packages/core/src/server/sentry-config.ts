import { resolveDeployEnvironment } from "./deploy-environment.js";

function firstNonEmpty(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function resolveSentryDsnFromKeyProject(): string | undefined {
  const key = firstNonEmpty(
    process.env.SENTRY_CLIENT_KEY,
    process.env.VITE_SENTRY_CLIENT_KEY,
  );
  const projectId = firstNonEmpty(
    process.env.SENTRY_PROJECT_ID,
    process.env.VITE_SENTRY_PROJECT_ID,
  );
  const host = firstNonEmpty(
    process.env.SENTRY_INGEST_HOST,
    process.env.VITE_SENTRY_INGEST_HOST,
  );
  if (!key || !projectId || !host) return undefined;
  return `https://${key}@${host}/${projectId}`;
}

/** @deprecated Use `resolveDeployEnvironment()` — it is not Sentry-specific. */
export function resolveSentryEnvironment(): string {
  return resolveDeployEnvironment();
}

export function resolveServerSentryDsn(): string | undefined {
  return (
    firstNonEmpty(process.env.SENTRY_SERVER_DSN, process.env.SENTRY_DSN) ??
    resolveSentryDsnFromKeyProject()
  );
}

export function resolvePublicSentryDsn(): string | undefined {
  return (
    firstNonEmpty(
      process.env.SENTRY_CLIENT_DSN,
      process.env.VITE_SENTRY_CLIENT_DSN,
      process.env.VITE_SENTRY_DSN,
      process.env.SENTRY_DSN,
    ) ?? resolveSentryDsnFromKeyProject()
  );
}

export function getSentryClientConfigScript(): string | null {
  const dsn = resolvePublicSentryDsn();
  const deploymentEnvironment = resolveDeployEnvironment();
  const config = {
    ...(dsn
      ? {
          sentryDsn: dsn,
          sentryEnvironment: resolveSentryEnvironment(),
        }
      : {}),
    deploymentEnvironment,
  };

  return [
    "<script data-agent-native-sentry-config>",
    "window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,",
    JSON.stringify(config),
    ");",
    "</script>",
  ].join("");
}

/**
 * Hosted Realtime Gateway config for the client, or null for the in-process
 * (local) transport. Values are env-derived and identical for every visitor,
 * so this is safe inside the CDN-cached SSR shell (see `guard:ssr-cache-shell`).
 * The per-user subscribe token is NOT here — it is minted client-side after
 * load from `/_agent-native/realtime-token`.
 */
export function resolveRealtimeClientConfig(): {
  transport: "hosted";
  gatewayBaseUrl: string;
} | null {
  // One gate: the transport env var. Everything else is derivable, which is the
  // point — a self-registering app should need exactly one var, not three.
  //
  // This used to also require an explicit gateway URL, so that a mis-set env
  // could not point a CDN-cached shell at api.builder.io. That check moved
  // rather than disappeared: the shell now advertises the gateway, and the
  // app's own `/_agent-native/realtime-token` decides whether a channel exists
  // to talk on. No channel means a 404 and the client stays on local `/poll`,
  // so the failure is still closed — just one layer down, where it can tell the
  // difference between "not configured" and "configured elsewhere".
  //
  // Mirrored byte-for-byte by the worker emitter in `deploy/build.ts` and by
  // `hostedRealtimeTransportEnabled` in `server/poll.ts`; a skew between them
  // is a silent cross-writer version bug, so `realtime-transport-gate.spec.ts`
  // asserts all three agree.
  if (firstNonEmpty(process.env.AGENT_NATIVE_REALTIME_TRANSPORT) !== "hosted") {
    return null;
  }
  // config-ok: mirrored by the generated worker source in `deploy/build.ts`,
  // which has no app-config at runtime.
  const explicit = firstNonEmpty(process.env.AGENT_NATIVE_REALTIME_GATEWAY_URL);
  // config-ok: same mirrored emitter as above.
  const builderGateway = firstNonEmpty(process.env.BUILDER_GATEWAY_BASE_URL);
  const gatewayBaseUrl =
    explicit ||
    `${(builderGateway || "https://api.builder.io/agent-native/gateway/v1").replace(/\/+$/, "")}/realtime`;
  return { transport: "hosted", gatewayBaseUrl };
}

export function getRealtimeClientConfigScript(): string | null {
  const realtime = resolveRealtimeClientConfig();
  if (!realtime) return null;

  return [
    "<script data-agent-native-realtime-config>",
    "window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,",
    JSON.stringify({ realtime }),
    ");",
    "</script>",
  ].join("");
}
