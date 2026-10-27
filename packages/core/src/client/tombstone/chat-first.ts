import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/chat-first",
  "@agent-native/toolkit/app/chat/chat-first",
);
