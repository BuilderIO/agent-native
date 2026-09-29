import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/markdown",
  "@agent-native/toolkit/app/review",
);

/** @deprecated @agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx @agent-native/core@latest upgrade --codemods */
export const InlineMarkdown =
  undefined as DeprecatedExport<"@agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx @agent-native/core@latest upgrade --codemods */
export type InlineMarkdownProtectedSpan =
  DeprecatedExport<"@agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx @agent-native/core@latest upgrade --codemods */
export type InlineMarkdownProps =
  DeprecatedExport<"@agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx @agent-native/core@latest upgrade --codemods">;
