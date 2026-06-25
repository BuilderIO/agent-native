import { defineAction } from "@agent-native/core";
import { getLocalArtifactApp } from "@agent-native/core/local-artifacts";
import { z } from "zod";

import {
  isLocalComponentAccessError,
  listLocalComponentFiles,
  localComponentWorkspaceId,
  localComponentWorkspaceScope,
  type LocalComponentWorkspace,
  readLocalComponentWorkspacesSync,
  resolveLocalComponentWorkspacePath,
} from "../shared/local-component-workspaces.js";

const CONTENT_LOCAL_DEFAULTS = {
  roots: [
    { name: "Docs", path: "docs", kind: "docs", extensions: [".md", ".mdx"] },
    { name: "Blog", path: "blog", kind: "blog", extensions: [".md", ".mdx"] },
    {
      name: "Content",
      path: "content",
      kind: "content",
      extensions: [".md", ".mdx"],
    },
    {
      name: "Resources",
      path: "resources",
      kind: "resources",
      extensions: [".md", ".mdx"],
    },
  ],
  components: "components",
  hide: ["**/_*.md", "**/_*.mdx"],
};

async function localFileModeComponentWorkspace(): Promise<LocalComponentWorkspace | null> {
  const app = await getLocalArtifactApp({
    appId: "content",
    defaults: CONTENT_LOCAL_DEFAULTS,
  });
  if (app.mode !== "local-files" || app.components.length === 0) return null;
  const workspacePath = resolveLocalComponentWorkspacePath(app.workspaceRoot);
  return {
    id: localComponentWorkspaceId(workspacePath),
    workspacePath,
    componentPaths: app.components,
    updatedAt: new Date().toISOString(),
  };
}

export default defineAction({
  description:
    "List component source files in local Content component workspaces registered from Local File Mode or Desktop folder picks.",
  readOnly: true,
  http: { method: "GET" },
  schema: z.object({}),
  run: async (_args, context) => {
    try {
      const scope = localComponentWorkspaceScope(context?.userEmail);
      const workspaces = readLocalComponentWorkspacesSync(undefined, scope);
      const localFileModeWorkspace = await localFileModeComponentWorkspace();
      const allWorkspaces = localFileModeWorkspace
        ? [
            localFileModeWorkspace,
            ...workspaces.filter(
              (workspace) => workspace.id !== localFileModeWorkspace.id,
            ),
          ]
        : workspaces;
      const files = await listLocalComponentFiles({
        scope,
        workspaces: allWorkspaces,
      });
      return {
        workspaces: allWorkspaces,
        files,
      };
    } catch (error) {
      if (isLocalComponentAccessError(error)) {
        return {
          workspaces: [],
          files: [],
        };
      }
      throw error;
    }
  },
});
