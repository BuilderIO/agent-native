import { throwMovedAgentNativeModule } from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/db-admin",
  "@agent-native/toolkit/app/db-admin",
);
