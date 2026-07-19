import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/RemoteSelectionRings",
  "@agent-native/toolkit/collab-ui",
);

/** @deprecated @agent-native/core/client/components/RemoteSelectionRings moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export const RemoteSelectionRings =
  undefined as DeprecatedExport<"@agent-native/core/client/components/RemoteSelectionRings moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/RemoteSelectionRings moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export type RemoteSelectionRingsProps =
  DeprecatedExport<"@agent-native/core/client/components/RemoteSelectionRings moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/RemoteSelectionRings moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export type SelectionDescriptor =
  DeprecatedExport<"@agent-native/core/client/components/RemoteSelectionRings moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;
