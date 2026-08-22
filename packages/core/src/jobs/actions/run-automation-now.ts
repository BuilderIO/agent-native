import { z } from "zod";

import { defineAction } from "../../action.js";
import { queueAutomationRunNow } from "../run-now.js";

export default defineAction({
  description:
    "Run one personal or organization automation immediately. This is an explicit send/run action and may perform the automation's real side effects. Pass a flat `name` or a nested `path` such as jobs/factories/<id>/factory-slack-feedback.md — not both.",
  agentTool: false,
  schema: z
    .object({
      name: z.string().min(1).optional(),
      path: z.string().min(1).optional(),
      scope: z.enum(["personal", "organization"]).default("personal"),
    })
    .refine((value) => Boolean(value.name) !== Boolean(value.path), {
      message: "Specify either an automation name or a path, not both.",
    }),
  run: async ({ name, path, scope }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return queueAutomationRunNow({
      userEmail: ctx.userEmail,
      orgId: ctx.orgId,
      appId: ctx.appId,
      scope,
      ...(path ? { path } : { name }),
      requestHeaders: ctx.requestHeaders,
    });
  },
});
