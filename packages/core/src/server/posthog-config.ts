
const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

function firstNonEmpty(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export interface PublicPostHogConfig {
  posthogKey: string;
  posthogHost: string;
  posthogErrorTracking: boolean;
}

export function resolvePublicPostHogConfig(): PublicPostHogConfig | undefined {
  const posthogKey = firstNonEmpty(
    process.env.POSTHOG_PUBLIC_KEY,
    process.env.VITE_POSTHOG_KEY,
    process.env.VITE_POSTHOG_PUBLIC_KEY,
  );
  if (!posthogKey) return undefined;

  const posthogHost = (
    firstNonEmpty(
      process.env.POSTHOG_PUBLIC_HOST,
      process.env.VITE_POSTHOG_HOST,
      process.env.POSTHOG_HOST,
    ) ?? POSTHOG_DEFAULT_HOST
  ).replace(/\/+$/, "");

  return {
    posthogKey,
    posthogHost,
    posthogErrorTracking:
      process.env.POSTHOG_ERROR_TRACKING?.trim().toLowerCase() !== "false",
  };
}

export function getPostHogClientConfigScript(): string | null {
  const config = resolvePublicPostHogConfig();
  if (!config) return null;

  return [
    "<script data-agent-native-posthog-config>",
    "window.__AGENT_NATIVE_CONFIG__=Object.assign({},window.__AGENT_NATIVE_CONFIG__,",
    JSON.stringify(config),
    ");",
    "</script>",
  ].join("");
}
