import type { BrowserContext } from "@playwright/test";

export const BETA_E2E_TEST_TRAFFIC_HEADERS = {
  "X-Agent-Native-Test-Traffic": "beta-e2e",
} as const;

/** Mark browser code before any document script can initialize telemetry. */
export function installBetaE2ETrafficMarker(
  context: BrowserContext,
): Promise<void> {
  return context
    .addInitScript((marker) => {
      (
        window as Window & {
          __AGENT_NATIVE_SYNTHETIC_TRAFFIC__?: string;
        }
      ).__AGENT_NATIVE_SYNTHETIC_TRAFFIC__ = marker;
    }, "beta-e2e")
    .then(() => undefined);
}
