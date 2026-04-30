import { runScript } from "@agent-native/core/scripts";
import { runWithRequestContext } from "@agent-native/core/server/request-context";

const userEmail = process.env.AGENT_USER_EMAIL || process.env.USER_EMAIL;
const orgId = process.env.AGENT_ORG_ID || process.env.ORG_ID;

runWithRequestContext({ userEmail, orgId }, () => {
  runScript();
});
