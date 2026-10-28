import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/observability",
  "@agent-native/toolkit/app/observability",
);
