/**
 * `offer-download` — hand the user a file instead of directions to it.
 *
 * The agent writes artifacts with `workspaceWrite`/`workspace-files`, which
 * stores them as Resources. Those bytes were always retrievable, but nothing
 * gave the agent a way to surface them, so it improvised navigation
 * instructions for UI that does not exist. This action resolves a workspace
 * path to a real, access-scoped download URL and renders it as an applet.
 */

import { ACTION_CHAT_UI_DOWNLOAD_ARTIFACT_RENDERER } from "../action-ui.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { getWorkspaceFileMeta, type WorkspaceFilesScope } from "./store.js";

export interface DownloadArtifactResult {
  path: string;
  filename: string;
  url: string;
  sizeBytes: number;
  contentType: string;
  updatedAt: string;
}

function resolveScope(): WorkspaceFilesScope | null {
  const orgId = getRequestOrgId();
  if (orgId) return { scope: "org", scopeId: orgId };
  const email = getRequestUserEmail();
  if (email) return { scope: "user", scopeId: email };
  return null;
}

export function downloadFilenameFromPath(path: string): string {
  const segment = path.split("/").filter(Boolean).pop();
  return segment && segment.trim() ? segment.trim() : "download";
}

export function workspaceDownloadUrl(resourceId: string): string {
  return `/_agent-native/resources/${encodeURIComponent(resourceId)}?download`;
}

export function createOfferDownloadTool(): Record<string, ActionEntry> {
  return {
    "offer-download": {
      readOnly: true,
      chatUI: {
        renderer: ACTION_CHAT_UI_DOWNLOAD_ARTIFACT_RENDERER,
        title: "Download",
        description: "Renders a downloadable file as an inline download card.",
      },
      tool: {
        description: [
          "Give the user a one-click download card for a file you produced in the workspace.",
          "",
          "Call this immediately after writing any artifact the user asked for — a CSV, JSON, Markdown report, or similar. Pass the same path you wrote.",
          "",
          "Never tell the user to look for a file somewhere in the app's UI, and never paste a large file back into chat as text. Both are worse than this card: the card downloads the real bytes.",
        ].join("\n"),
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                'Workspace path of the file to offer, exactly as written, e.g. "exports/agent-credits-monthly.csv".',
            },
            label: {
              type: "string",
              description:
                "Optional short human label for the card, e.g. “Agent credits, last 9 months”. Defaults to the filename.",
            },
          },
          required: ["path"],
        },
      },

      run: async (args: Record<string, unknown>): Promise<unknown> => {
        const scope = resolveScope();
        if (!scope) {
          throw new Error(
            "offer-download requires an authenticated request context.",
          );
        }
        const path = String(args.path ?? "").trim();
        if (!path) throw new Error("offer-download requires a path.");

        const meta = await getWorkspaceFileMeta(scope, path);
        // A card pointing at a file that is not there is worse than an error:
        // the user clicks it and gets nothing, and the agent has already
        // claimed success. Fail loudly so the agent writes the file first.
        if (!meta) {
          throw new Error(
            `No workspace file at "${path}". Write it first (workspace-files write), then offer the download.`,
          );
        }

        const label = String(args.label ?? "").trim();
        const result: DownloadArtifactResult & { label?: string } = {
          path: meta.path,
          filename: downloadFilenameFromPath(meta.path),
          url: workspaceDownloadUrl(meta.id),
          sizeBytes: meta.sizeBytes,
          contentType: meta.contentType,
          updatedAt: meta.updatedAt,
          ...(label ? { label } : {}),
        };
        return result;
      },
    },
  };
}
