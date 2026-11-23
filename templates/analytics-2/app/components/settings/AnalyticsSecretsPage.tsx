import { SecretsSection } from "@agent-native/toolkit/app/settings";
import { useLocation } from "react-router";

/** The key a `#secrets:<KEY>` hash points at, or undefined for any other hash. */
export function secretFocusKeyFromHash(hash: string): string | undefined {
  const key = /^#secrets:(.+)$/i.exec(hash.trim())?.[1];
  if (key === undefined) return undefined;
  try {
    return decodeURIComponent(key);
  } catch (error) {
    if (error instanceof URIError) return key;
    throw error;
  }
}

/**
 * Settings > Secrets. The shared list hides keys that are not set yet unless one
 * is focused, so a deep link such as the HubSpot MCP dialog's "Add workspace
 * credentials" (`#secrets:HUBSPOT_MCP_CLIENT_ID`) must pass its key through or
 * the entry it promised never appears.
 */
export function AnalyticsSecretsPage() {
  const { hash } = useLocation();
  const focusKey = secretFocusKeyFromHash(hash);
  return focusKey === undefined ? (
    <SecretsSection />
  ) : (
    <SecretsSection focusKey={focusKey} />
  );
}
