import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/composer",
  "@agent-native/toolkit/app/chat/composer/index",
);
