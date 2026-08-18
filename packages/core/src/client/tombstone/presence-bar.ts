import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/PresenceBar",
  "@agent-native/toolkit/collab-ui",
);

/** @deprecated @agent-native/core/client/components/PresenceBar moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export const PresenceBar =
  undefined as DeprecatedExport<"@agent-native/core/client/components/PresenceBar moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/PresenceBar moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export type PresenceBarProps =
  DeprecatedExport<"@agent-native/core/client/components/PresenceBar moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;
