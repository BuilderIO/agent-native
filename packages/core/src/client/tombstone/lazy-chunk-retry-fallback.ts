import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/lazy-chunk-retry-fallback",
  "@agent-native/toolkit/app/shared",
);

/** @deprecated @agent-native/core/client/lazy-chunk-retry-fallback moved to @agent-native/toolkit/app/shared. Run: npx @agent-native/core@latest upgrade --codemods */
export const LazyChunkRetryFallback =
  undefined as DeprecatedExport<"@agent-native/core/client/lazy-chunk-retry-fallback moved to @agent-native/toolkit/app/shared. Run: npx @agent-native/core@latest upgrade --codemods">;
