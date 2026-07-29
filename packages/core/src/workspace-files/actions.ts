import { z } from "zod";

import { ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER } from "../action-ui.js";
import { defineAction } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { getWorkspaceFileMeta, type WorkspaceFilesScope } from "./store.js";

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

function fileName(path: string): string {
  return path.split("/").at(-1) || path;
}

function isTextWorkspaceFile(contentType: string): boolean {
  const mimeType = contentType.split(";")[0].trim().toLowerCase();
  return mimeType.startsWith("text/") || mimeType === "application/json";
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
    if (!isTextWorkspaceFile(file.contentType)) {
      throw new Error(
        `Workspace file "${path}" has unsupported content type "${file.contentType}". show-workspace-file currently supports text files and application/json.`,
      );
    }

    return {
      file: {
        resourceId: file.id,
        path: file.path,
        name: fileName(file.path),
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        updatedAt: file.updatedAt,
      },
    };
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
