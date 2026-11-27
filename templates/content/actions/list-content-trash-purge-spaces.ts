import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import type { ListContentTrashPurgeSpacesResponse } from "../shared/content-trash.js";
import { listTrashPurgeSpaces } from "./_content-trash-purge-scope.js";

export default defineAction({
  description:
    "List the workspaces whose Trash the signed-in user can see, and whether they may permanently empty each one (editor access).",
  mcpTool: false,
  readOnly: true,
  http: { method: "GET" },
  schema: z.object({}),
  outputSchema: z.object({
    spaces: z.array(
      z.object({
        spaceId: z.string(),
        name: z.string(),
        canPurge: z.boolean(),
      }),
    ),
  }),
  run: async (): Promise<ListContentTrashPurgeSpacesResponse> => {
    const email = getRequestUserEmail();
    if (!email)
      fail("Authentication required", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    return { spaces: await listTrashPurgeSpaces(email) };
  },
});
