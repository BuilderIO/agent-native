import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/feedback",
  "@agent-native/toolkit/app/feedback",
);
