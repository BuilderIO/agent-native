import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { createComponent } from "../server/model/components-store.js";

/**
 * A component is a named snapshot of cells that other projects can import.
 *
 * The source makes this a first-class object - a component import cell
 * (`CellType.COMPONENT_IMPORT`) holds a `componentVersionId`, and components are
 * created from a selection of cells. This action is the create half: it captures
 * the chosen cells as they are now, so an importer renders what was captured
 * rather than whatever the source project says later.
 */
export default defineAction({
  description:
    "Create a reusable component from cells in a project, or list the components this workspace has.",
  agentTool: true,
  schema: z.object({
    operation: z.literal("create"),
    projectId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(120),
    cellIds: z.array(z.string().trim().min(1)).min(1).max(100),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const orgId = ctx?.orgId ?? "";
    if (orgId === "") {
      fail("A workspace is required to create a component.", {
        statusCode: 403,
      });
    }
    const scope = { ownerEmail: userEmail, orgId };

    const component = await createComponent(scope, {
      projectId: input.projectId,
      name: input.name,
      cellIds: input.cellIds,
      caller: ctx.caller,
    });
    return { component };
  },
});
