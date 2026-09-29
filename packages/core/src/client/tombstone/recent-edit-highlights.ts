import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/RecentEditHighlights",
  "@agent-native/toolkit/collab-ui",
);

/** @deprecated @agent-native/core/client/components/RecentEditHighlights moved to @agent-native/toolkit/collab-ui. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const RecentEditHighlights =
  undefined as DeprecatedExport<"@agent-native/core/client/components/RecentEditHighlights moved to @agent-native/toolkit/collab-ui. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/components/RecentEditHighlights moved to @agent-native/toolkit/collab-ui. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type RecentEditHighlightsProps =
  DeprecatedExport<"@agent-native/core/client/components/RecentEditHighlights moved to @agent-native/toolkit/collab-ui. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;
