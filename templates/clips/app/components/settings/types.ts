import type { BuilderConnectStartOptions } from "@agent-native/core/client/settings";

/**
 * The Builder.io connection as the settings sections need it. Video storage
 * and AI setup both offer the same connect affordance, so the settings page
 * owns the flow and hands this view of it to each section.
 */
export interface BuilderConnection {
  connected: boolean;
  loading: boolean;
  connecting: boolean;
  orgName: string | null;
  start: (options?: BuilderConnectStartOptions) => void;
}
