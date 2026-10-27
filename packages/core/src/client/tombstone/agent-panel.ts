import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/AgentPanel",
  "@agent-native/toolkit/app/chat/AgentPanel",
);
