/**
 * Public PostHog config for the browser.
 *
 * PostHog project API keys are publishable — that is how `posthog-js` ships in
 * every customer's bundle — so this mirrors how the Sentry client DSN already
 * reaches the browser: env-derived, identical for every visitor, and therefore
 * safe inside the CDN-cached SSR shell (see `guard:ssr-cache-shell`).
 *
 * The browser sends exceptions straight to PostHog rather than relaying them
 * through `/_agent-native/track`: that route requires a resolved session by
 * design, so relaying would silently drop every signed-out crash — exactly the
 * class of failure that looks like "no errors" instead of "no reporting".
 */

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

/**
 * Resolve the browser-facing PostHog config, or `undefined` when none is set.
 *
 * Note this deliberately does NOT fall back to `POSTHOG_API_KEY`: a
 * server-only personal/private key must never be inlined into the public HTML
 * shell. Operators opt into browser capture by setting a public key explicitly.
 */
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
