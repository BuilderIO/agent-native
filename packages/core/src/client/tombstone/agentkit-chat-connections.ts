import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/agentkit-chat/connections",
  "@agent-native/toolkit/app/chat/agentkit-chat/connections",
);
