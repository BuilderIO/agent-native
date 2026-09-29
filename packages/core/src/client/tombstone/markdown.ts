import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/markdown",
  "@agent-native/toolkit/app/review",
);

/** @deprecated @agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const InlineMarkdown =
  undefined as DeprecatedExport<"@agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type InlineMarkdownProtectedSpan =
  DeprecatedExport<"@agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export type InlineMarkdownProps =
  DeprecatedExport<"@agent-native/core/client/markdown moved to @agent-native/toolkit/app/review. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;
