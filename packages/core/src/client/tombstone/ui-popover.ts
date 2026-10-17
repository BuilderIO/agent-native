import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/ui/popover",
  "@agent-native/toolkit/ui/popover",
);

/** @deprecated @agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx */
export const Popover =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx">;

/** @deprecated @agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx */
export const PopoverAnchor =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx">;

/** @deprecated @agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx */
export const PopoverContent =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx">;

/** @deprecated @agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx */
export const PopoverTrigger =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx agent-native upgrade --codemods. Migration guide: https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx">;
