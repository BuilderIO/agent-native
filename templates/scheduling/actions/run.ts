import { runScript } from "@agent-native/core/scripts";
import { setSchedulingContext } from "@agent-native/scheduling/server";
import { getDb, schema } from "../server/db/index.js";

// Initialize scheduling context before running any action. Server plugins
// normally set this up, but CLI actions run in a fresh process and need an
// explicit init.
setSchedulingContext({
  getDb,
  schema,
  getCurrentUserEmail: () => process.env.USER_EMAIL ?? "local@localhost",
  getCurrentOrgId: () => undefined,
  publicBaseUrl: process.env.PUBLIC_URL,
});

runScript();
