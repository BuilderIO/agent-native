import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/settings/useBuilderStatus",
  "@agent-native/toolkit/app/settings/useBuilderStatus",
);
