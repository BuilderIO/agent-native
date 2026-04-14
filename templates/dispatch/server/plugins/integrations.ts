import {
  createIntegrationsPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";
import {
  beforeDispatchProcess,
  resolveDispatchOwner,
} from "../lib/dispatch-integrations.js";

export default createIntegrationsPlugin({
  actions: await autoDiscoverActions(import.meta.url),
  resolveOwner: resolveDispatchOwner,
  beforeProcess: beforeDispatchProcess,
});
