import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/ui/hover-card",
  "@agent-native/toolkit/ui/hover-card",
);

/** @deprecated @agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const HoverCard =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const HoverCardContent =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;

/** @deprecated @agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx */
export const HoverCardTrigger =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-to-0-197.mdx">;
