import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/AgentSidebar",
  "@agent-native/toolkit/app/chat/AgentSidebar",
);
