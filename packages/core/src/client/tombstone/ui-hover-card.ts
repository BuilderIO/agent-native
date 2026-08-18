import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/ui/hover-card",
  "@agent-native/toolkit/ui/hover-card",
);

/** @deprecated @agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx @agent-native/core@latest upgrade --codemods */
export const HoverCard =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx @agent-native/core@latest upgrade --codemods */
export const HoverCardContent =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx @agent-native/core@latest upgrade --codemods */
export const HoverCardTrigger =
  undefined as DeprecatedExport<"@agent-native/core/client/components/ui/hover-card moved to @agent-native/toolkit/ui/hover-card. Run: npx @agent-native/core@latest upgrade --codemods">;
