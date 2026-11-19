import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { createDashboardFolder } from "../server/lib/dashboard-folders-store";
import { guardWrite, idempotencyKeyArg } from "../server/lib/guarded-writes";

export default defineAction({
  description:
    "Create a personal dashboard folder, or a shared one visible to the active organization. Put dashboards in it with set-dashboard-folder.",
  schema: z.object({
    name: z.string().min(1).max(120),
    scope: z.enum(["personal", "shared"]),
    idempotencyKey: idempotencyKeyArg,
  }),
  http: { method: "POST" },
  mcpTool: true,
  run: async ({ name, scope, idempotencyKey }, actionContext) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const ctx = { email, orgId: getRequestOrgId() || null };
    const guard = guardWrite({
      action: "create-dashboard-folder",
      // The server names the folder, so every create shares one target.
      target: { kind: "dashboard-folder", id: "" },
      caller: actionContext?.caller,
      scope: ctx,
      idempotencyKey,
      request: { name: name.trim(), scope },
    });
    guard.requireKey();
    const outcome = await guard.run(
      async () => undefined,
      () =>
        guard.active
          ? createDashboardFolder(name, scope, ctx, guard.onCommit)
          : createDashboardFolder(name, scope, ctx),
    );
    if ("replayed" in outcome) {
      return {
        folderId: outcome.replayed.writeReceipt.target.id,
        ...outcome.replayed,
      };
    }
    const folder = outcome.written;
    return { folder, ...guard.resultFields(folder) };
  },
});
