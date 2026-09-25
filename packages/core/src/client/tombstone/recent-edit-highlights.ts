import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/RecentEditHighlights",
  "@agent-native/toolkit/collab-ui",
);

/** @deprecated @agent-native/core/client/components/RecentEditHighlights moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export const RecentEditHighlights =
  undefined as DeprecatedExport<"@agent-native/core/client/components/RecentEditHighlights moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/RecentEditHighlights moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export type RecentEditHighlightsProps =
  DeprecatedExport<"@agent-native/core/client/components/RecentEditHighlights moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;
