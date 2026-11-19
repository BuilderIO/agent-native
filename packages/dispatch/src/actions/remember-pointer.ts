import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { authorizeDispatchAdmin } from "../server/lib/app-roles.js";
import { rememberPointer } from "../server/lib/pointers-store.js";

export default defineAction({
  description:
    'Remember that a name the user uses (an alias such as "todo list") points to a specific object in a workspace app, such as a doc, deck, or board. Call it when the user says "X is my Y" or "my Y is this <app item or link>". Later requests that mention the alias open that object instead of the app the request would otherwise route to.',
  schema: z
    .object({
      alias: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe('What the user calls it, e.g. "todo list".'),
      appId: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe("Id of the workspace app that owns the object."),
      objectId: z.string().trim().max(500).optional(),
      url: z.string().trim().max(2000).optional(),
      scope: z
        .enum(["user", "org"])
        .default("user")
        .describe(
          '"user" (default) is private to this user; "org" is shared with the organization and needs an administrator.',
        ),
    })
    .refine((value) => value.objectId || value.url, {
      message: "Give an objectId or a url.",
    }),
  outputSchema: z.object({ alias: z.string(), path: z.string() }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  mcpTool: true,
  run: async (args, ctx) => {
    const owner = getRequestUserEmail();
    if (!owner)
      fail("no_authenticated_user", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    const orgId = getRequestOrgId() ?? null;
    if (args.scope === "org") {
      if (!orgId)
        fail("Organization scope needs an active organization.", {
          errorCode: "invalid_input",
          statusCode: 400,
        });
      await authorizeDispatchAdmin(args, ctx);
    }
    return rememberPointer({ ...args, owner, orgId });
  },
});
