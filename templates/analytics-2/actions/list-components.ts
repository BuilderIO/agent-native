import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  listComponents,
  readComponent,
} from "../server/model/components-store.js";

/**
 * Reads the workspace's components, or one component with the cells it captured.
 *
 * This is a GET because both readers are queries: the Components panel and the
 * component import cell. Writes stay on `manage-component`.
 */
export default defineAction({
  description:
    "List the components this workspace can import, or read one with the cells it captured.",
  agentTool: true,
  schema: z.object({
    componentId: z.string().trim().min(1).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async ({ componentId }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const scope = { ownerEmail: userEmail, orgId: ctx?.orgId ?? "" };
    if (scope.orgId === "") {
      fail("A workspace is required to read components.", { statusCode: 403 });
    }
    if (componentId === undefined) {
      return { components: await listComponents(scope) };
    }
    const found = await readComponent(scope, componentId, ctx.caller);
    if (!found) {
      fail("That component could not be read.", { statusCode: 404 });
    }
    return found;
  },
});
