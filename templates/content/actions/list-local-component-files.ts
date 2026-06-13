import { defineAction } from "@agent-native/core";
import { getLocalArtifactApp } from "@agent-native/core/local-artifacts";
import { z } from "zod";
import {
  isLocalComponentAccessError,
  listLocalComponentFiles,
  localComponentWorkspaceId,
  type LocalComponentWorkspace,
  readLocalComponentWorkspacesSync,
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
  return {
    id: localComponentWorkspaceId(app.workspaceRoot),
    workspacePath: app.workspaceRoot,
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
  run: async () => {
    try {
      const workspaces = readLocalComponentWorkspacesSync();
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
