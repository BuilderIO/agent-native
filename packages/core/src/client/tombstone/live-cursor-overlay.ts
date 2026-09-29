import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/LiveCursorOverlay",
  "@agent-native/toolkit/collab-ui",
);

/** @deprecated @agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx */
export const LiveCursorOverlay =
  undefined as DeprecatedExport<"@agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx">;

/** @deprecated @agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx */
export type CursorMapFn =
  DeprecatedExport<"@agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx">;

/** @deprecated @agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx */
export type LiveCursorOverlayProps =
  DeprecatedExport<"@agent-native/core/client/components/LiveCursorOverlay moved to @agent-native/toolkit/collab-ui. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx">;
