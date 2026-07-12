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
