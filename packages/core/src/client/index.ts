/**
 * @deprecated Import from a focused @agent-native/core/client/* entrypoint instead.
 * Compatibility aggregation for Core's headless client APIs only.
 */
export * from "./agent-chat/index.js";
export * from "./desktop-local-code-change.js";
export * from "./hooks/index.js";
export * from "./navigation/index.js";
export * from "./host/index.js";
export * from "./widgets/index.js";
export * from "./i18n.js";
export * from "./feature-flags/index.js";
export * from "./launchdarkly/index.js";
export * from "./labs/index.js";
export * from "./experiments/index.js";
export * from "./org/index.js";

export { withBuilderUtmTrackingParams } from "../shared/builder-link-tracking.js";
export * from "./route-chunk-recovery.js";
export * from "./analytics.js";
export * from "./track.js";
export * from "../collab/client.js";
export * from "../collab/agent-identity.js";
export * from "../collab/presence.js";
export * from "../collab/follow-mode.js";
export * from "./resources/index.js";
export * from "./history/index.js";
export * from "./review/index.js";
export { BUILT_IN_SETUP_READINESS_UI_IDS } from "./setup-connections/catalog.js";
export * from "./integrations/index.js";
export * from "./automation.js";
export {
  useDevOverlayShortcut,
  registerDevPanel,
  unregisterDevPanel,
  listDevPanels,
  subscribeDevPanels,
  useDevOption,
  clearAllDevOverlayStorage,
  devOptionKey,
  DEV_OVERLAY_STORAGE_PREFIX,
  type DevPanel,
  type DevOption,
  type DevBooleanOption,
  type DevSelectOption,
  type DevStringOption,
  type DevActionOption,
  type DevOptionValue,
} from "./dev-overlay/index.js";
export * from "./sharing/index.js";
export * from "./onboarding/index.js";
export * from "../collab/recent-edits.js";
export * from "../collab/undo.js";
export * from "../collab/client-struct.js";
export * from "./blocks/server.js";
