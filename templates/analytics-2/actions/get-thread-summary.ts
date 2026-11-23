import { defineAction, fail } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { workspaceChatScope } from "../app/lib/workspace-chat-scope.js";
import {
  currentApplicationId,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import {
  analyticsThreadRef,
  readAnalyticsThreadAccess,
} from "../server/model/analytics-thread-bootstrap.js";
import { latestAnalyticsThreadSequence } from "../server/model/analytics-thread-turns.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { snapshotRef } from "../server/model/notebook-operations/store.js";
import { threadBindingRef, threadId } from "../shared/analytics-thread.js";
import {
  draftHeadSchema,
  revisionSchema,
} from "../shared/notebook-snapshot-contract.js";

export default defineAction({
  description:
    "Read the title and ownership of one accessible conversation in the current app and workspace, including empty and archived conversations.",
  schema: z.object({ threadId }).strict(),
  outputSchema: z.object({
    thread: z.object({ id: z.string(), title: z.string(), owned: z.boolean() }),
    binding: threadBindingRef.nullable(),
    workingHead: draftHeadSchema.nullable(),
    listed: z.boolean(),
    canSubmit: z.boolean(),
    canShare: z.boolean(),
    throughSequence: revisionSchema.nullable(),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ threadId }, context) => {
    const current = await requireCurrentWorkspace();
    const appId = currentApplicationId(context);
    await ensureAnalyticsDatabase();
    const managed = await readAnalyticsThreadAccess(
      { ...current, appId },
      threadId,
    );
    if (managed) {
      return {
        thread: {
          id: threadId,
          title: managed.thread.title,
          owned: managed.owner,
        },
        binding: analyticsThreadRef(managed.binding),
        workingHead: managed.owner
          ? snapshotRef(current, managed.project).head
          : null,
        listed: managed.project.listed,
        canSubmit: managed.owner,
        canShare: managed.owner,
        throughSequence: managed.owner
          ? await latestAnalyticsThreadSequence(managed.binding.id)
          : null,
      };
    }
    const scope = workspaceChatScope(current.orgId, appId);
    const access = await resolveAccess(
      "chat_thread",
      threadId,
      { userEmail: current.ownerEmail, orgId: current.orgId },
      { skipResourceBody: true },
    );
    if (!access)
      fail("Thread not found in the active Analytics workspace.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    const result = await getDbExec().execute({
      sql: "SELECT id, title, owner_email, org_id, scope_type, scope_id FROM chat_threads WHERE id = ? AND org_id = ? AND scope_type = ? AND scope_id = ? LIMIT 1",
      args: [threadId, current.orgId, scope.type, scope.id],
    });
    const row = result.rows[0];
    const thread =
      row === undefined
        ? null
        : z
            .object({
              id: z.string(),
              title: z.string(),
              owner_email: z.string(),
              org_id: z.string(),
              scope_type: z.string(),
              scope_id: z.string(),
            })
            .parse(row);
    if (
      !thread ||
      thread.org_id !== current.orgId ||
      thread.scope_type !== scope.type ||
      thread.scope_id !== scope.id
    )
      fail("Thread not found in the active Analytics workspace.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    return {
      thread: {
        id: thread.id,
        title: thread.title,
        owned: thread.owner_email.toLowerCase() === current.ownerEmail,
      },
      binding: null,
      workingHead: null,
      listed: true,
      canSubmit: thread.owner_email.toLowerCase() === current.ownerEmail,
      canShare: thread.owner_email.toLowerCase() === current.ownerEmail,
      throughSequence: null,
    };
  },
});
