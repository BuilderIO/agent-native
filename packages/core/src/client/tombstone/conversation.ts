import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/conversation",
  "@agent-native/toolkit/app/chat/conversation/index",
);
