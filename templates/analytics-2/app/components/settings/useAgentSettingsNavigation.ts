import { useEffect } from "react";

/**
 * The shared integration dialog's "Add workspace credentials" closes itself and
 * asks the host app to open its own settings through `agent-panel:open-settings`
 * (`packages/toolkit/src/app/resources/McpIntegrationDialog.tsx:278` →
 * `openAgentSettings("secrets:HUBSPOT_MCP_CLIENT_ID")`). This app draws its own
 * Settings shell, so nothing was listening and the button closed the dialog and
 * left the person exactly where they were (sprint-analytics-2#791).
 *
 * This hook is the listener: a `secrets:<KEY>` request opens this app's Secrets
 * screen and keeps the key in the hash, which is the same address the shared
 * settings page uses.
 */
export const AGENT_SETTINGS_EVENT = "agent-panel:open-settings";

/** The route a `secrets:<KEY>` request should land on, or null for any other. */
export function settingsSectionHref(
  section: string | undefined,
): string | null {
  const value = (section ?? "").trim();
  if (!value.toLowerCase().startsWith("secrets:")) return null;
  return `/settings/secrets#${value}`;
}

export function useAgentSettingsNavigation(
  navigate: (to: string) => void,
): void {
  useEffect(() => {
    const onOpenSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: string } | undefined>)
        .detail;
      const href = settingsSectionHref(detail?.section);
      if (href) navigate(href);
    };
    window.addEventListener(AGENT_SETTINGS_EVENT, onOpenSettings);
    return () => {
      window.removeEventListener(AGENT_SETTINGS_EVENT, onOpenSettings);
    };
  }, [navigate]);
}
