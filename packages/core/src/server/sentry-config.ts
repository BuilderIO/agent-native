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

export function resolveSentryEnvironment(): string {
  return (
    firstNonEmpty(
      process.env.SENTRY_ENVIRONMENT,
      process.env.NETLIFY_CONTEXT,
      process.env.VERCEL_ENV,
      process.env.NODE_ENV,
    ) ?? "production"
  );
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
  if (!dsn) return null;

  const config = {
    sentryDsn: dsn,
    sentryEnvironment: resolveSentryEnvironment(),
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
  // Fail closed: emit hosted config only when BOTH the transport is hosted AND
  // an explicit gateway URL is set. No production default — this ships into the
  // CDN-cached shell served to every visitor, so a mis-set staging/preview/
  // self-hosted env must stay on the local transport rather than silently
  // point every browser at api.builder.io. This gating is mirrored byte-for-
  // byte in the worker emitter in `deploy/build.ts` (kept in sync deliberately).
  if (firstNonEmpty(process.env.AGENT_NATIVE_REALTIME_TRANSPORT) !== "hosted") {
    return null;
  }
  const gatewayBaseUrl = firstNonEmpty(
    process.env.AGENT_NATIVE_REALTIME_GATEWAY_URL,
  );
  if (!gatewayBaseUrl) return null;
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
