import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/LiveCursorOverlay",
  "@agent-native/toolkit/collab-ui",
);

/** @deprecated @agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export const LiveCursorOverlay =
  undefined as DeprecatedExport<"@agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export type CursorMapFn =
  DeprecatedExport<"@agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export type LiveCursorOverlayProps =
  DeprecatedExport<"@agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;
