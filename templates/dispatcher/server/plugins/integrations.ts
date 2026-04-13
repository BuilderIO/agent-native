import {
  createIntegrationsPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";
import {
  beforeDispatcherProcess,
  resolveDispatcherOwner,
} from "../lib/dispatcher-integrations.js";

export default createIntegrationsPlugin({
  actions: await autoDiscoverActions(import.meta.url),
  resolveOwner: resolveDispatcherOwner,
  beforeProcess: beforeDispatcherProcess,
});
