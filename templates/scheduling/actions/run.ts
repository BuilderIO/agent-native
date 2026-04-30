import { runScript } from "@agent-native/core/scripts";
import { setSchedulingContext } from "@agent-native/scheduling/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";
import { getDb, schema } from "../server/db/index.js";

// CLI actions run outside of an HTTP request, so request-context's
// AsyncLocalStorage is empty. Bridge the conventional CLI env vars
// (USER_EMAIL / ORG_ID) into the framework's AsyncLocalStorage-backed
// request context so accessFilter() and assertAccess() resolve a stable
// identity matching the CLI invocation. We use runWithRequestContext
// (not process.env mutation) so concurrent action invocations stay
// isolated.
const userEmail = process.env.AGENT_USER_EMAIL || process.env.USER_EMAIL;
const orgId = process.env.AGENT_ORG_ID || process.env.ORG_ID;

// Initialize scheduling context before running any action. Server plugins
// normally set this up, but CLI actions run in a fresh process and need an
// explicit init. Both accessors read from the framework request context
// so that scheduling repos see the same identity as the framework's
// accessFilter / assertAccess helpers.
setSchedulingContext({
  getDb,
  schema,
  getCurrentUserEmail: () => getRequestUserEmail(),
  getCurrentOrgId: () => getRequestOrgId(),
  publicBaseUrl: process.env.PUBLIC_URL,
});

runWithRequestContext({ userEmail, orgId }, () => {
  runScript();
});
