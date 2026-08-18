import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/ui/popover",
  "@agent-native/toolkit/ui/popover",
);

/** @deprecated @agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx @agent-native/core@latest upgrade --codemods */
export const Popover =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx @agent-native/core@latest upgrade --codemods */
export const PopoverAnchor =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx @agent-native/core@latest upgrade --codemods */
export const PopoverContent =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx @agent-native/core@latest upgrade --codemods */
export const PopoverTrigger =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/popover moved to @agent-native/toolkit/ui/popover. Run: npx @agent-native/core@latest upgrade --codemods">;
