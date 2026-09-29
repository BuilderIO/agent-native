import { z } from "zod";

import { defineAction } from "../../action.js";
import { resolveDeploymentSignInMethods } from "../../server/social-sign-in-providers.js";
import { requireOrgMember } from "../actions.js";
import { SIGN_IN_METHOD_ENV_VARS } from "../sign-in-methods.js";

export default defineAction({
  description:
    "List the sign-in methods this deployment offers (email and password, Google, GitHub) and the host environment variables that turn each social method on. Organization owners and admins only. Requiring one method for the organization is Organization sign-in, a separate setting.",
  http: { method: "GET" },
  schema: z.object({}),
  run: async (_args, ctx) => {
    await requireOrgMember(ctx, true);
    return {
      methods: resolveDeploymentSignInMethods(),
      envVars: SIGN_IN_METHOD_ENV_VARS,
    };
  },
});
