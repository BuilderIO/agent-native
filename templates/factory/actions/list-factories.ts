import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  defaultFactoryDefinition,
  listFactoryDefinitions,
} from "../server/factory-graph/store.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "List the saved Factory definitions in the active workspace, including the default product-feedback Factory when it has not been persisted yet.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const rows = await listFactoryDefinitions(orgId);
    if (rows.some((row) => row.id === defaultFactoryDefinition().id)) {
      return rows;
    }
    return [
      {
        id: defaultFactoryDefinition().id,
        name: defaultFactoryDefinition().name,
        description: defaultFactoryDefinition().description,
        prompt: defaultFactoryDefinition().prompt,
        graphVersion: 1,
        updatedAt: null,
        virtual: true,
      },
      ...rows,
    ];
  },
});
