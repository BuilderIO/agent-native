import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/lazy-chunk-error-boundary",
  "@agent-native/toolkit/app/shared",
);

/** @deprecated @agent-native/core/client/lazy-chunk-error-boundary moved to @agent-native/toolkit/app/shared. Run: npx @agent-native/core@latest upgrade --codemods */
export const LazyChunkErrorBoundary =
  undefined as DeprecatedExport<"@agent-native/core/client/lazy-chunk-error-boundary moved to @agent-native/toolkit/app/shared. Run: npx @agent-native/core@latest upgrade --codemods">;
