import { z } from "zod";

import { ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER } from "../action-ui.js";
import { defineAction } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  getWorkspaceFileMeta,
  toWorkspaceFileCard,
  type WorkspaceFilesScope,
} from "./store.js";

const workspaceFileResultSchema = z.object({
  file: z.object({
    resourceId: z.string().min(1),
    path: z.string().min(1),
    name: z.string().min(1),
    contentType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    updatedAt: z.string().min(1),
  }),
});

export type WorkspaceFileActionResult = z.infer<
  typeof workspaceFileResultSchema
>;

function currentWorkspaceScope(): WorkspaceFilesScope {
  const orgId = getRequestOrgId();
  if (orgId) return { scope: "org", scopeId: orgId };

  const userEmail = getRequestUserEmail();
  if (userEmail) return { scope: "user", scopeId: userEmail };

  throw new Error(
    "show-workspace-file requires an authenticated request context.",
  );
}

export const showWorkspaceFileAction = defineAction({
  description:
    "Render a workspace file as a downloadable card in chat. Call this after writing a user-requested export or other durable file with workspaceWrite; a file export is not complete until this action succeeds and the download card appears. The path must exactly match an existing file in the current organization or personal workspace.",
  schema: z.object({
    path: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Exact workspace-relative path returned by workspaceWrite, for example "exports/report.csv".',
      ),
  }),
  outputSchema: workspaceFileResultSchema,
  outputErrorStrategy: "strict",
  http: false,
  readOnly: true,
  chatUI: {
    renderer: ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER,
    title: "Workspace file",
    description: "A private, downloadable workspace file.",
  },
  run: async ({ path }) => {
    const file = await getWorkspaceFileMeta(currentWorkspaceScope(), path);
    if (!file) {
      throw new Error(`Workspace file not found: "${path}"`);
    }

    // The card only ever renders name/size/type + a download link — it never
    // inlines file content — so every content type, binary included, is safe
    // to show here.
    return { file: toWorkspaceFileCard(file) };
  },
});

export function createWorkspaceFileActionEntries(): Record<
  string,
  ActionEntry
> {
  return {
    "show-workspace-file": showWorkspaceFileAction,
  };
}
