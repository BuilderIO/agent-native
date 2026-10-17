import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/error-boundary",
  "@agent-native/toolkit/app/shared/ErrorBoundary",
);
