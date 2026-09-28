import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { listApiKeys, type ApiKeysListing } from "../api-keys.js";

export default defineAction({
  description:
    'List the saved keys on Settings › API keys. `keys` holds the caller\'s own keys and, for organization owners and admins, the organization\'s (scope: "user" or "org"; storedScope is the row, where a "workspace" row is the organization\'s shared row or the caller\'s pre-organization solo row). Each key has its last four characters masked, what uses it (usedFor), the model provider it adds (manage those in Model), and whether the caller can replace, delete, or test it. `managed` lists keys another Settings page creates and rotates (Builder.io, storage, channels, calendar tokens, custom integration headers), read-only here: point the user at managedBy.route instead. `addable` lists registered keys nobody has saved yet. Members never see organization key masks. Deployment environment keys are not listed. Never returns a key value. To add or replace a value, send the user to Settings › API keys (open-settings-page with page api-keys); to delete, call preview-secret-removal, tell the user what stops, then delete-api-key.',
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx): Promise<ApiKeysListing> => {
    const email = ctx?.userEmail?.trim().toLowerCase();
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    return listApiKeys({ email, orgId: ctx?.orgId?.trim() || null });
  },
});
