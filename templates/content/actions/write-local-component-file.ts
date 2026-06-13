import { defineAction } from "@agent-native/core";
import { getLocalArtifactApp } from "@agent-native/core/local-artifacts";
import { z } from "zod";
import {
  localComponentWorkspaceId,
  readLocalComponentWorkspacesSync,
  registerLocalComponentWorkspace,
  type LocalComponentWorkspace,
  writeLocalComponentFile,
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

async function componentWorkspaces(): Promise<LocalComponentWorkspace[]> {
  const registered = readLocalComponentWorkspacesSync();
  const app = await getLocalArtifactApp({
    appId: "content",
    defaults: CONTENT_LOCAL_DEFAULTS,
  });
  if (app.mode !== "local-files" || app.components.length === 0) {
    return registered;
  }
  const localFileWorkspace: LocalComponentWorkspace = {
    id: localComponentWorkspaceId(app.workspaceRoot),
    workspacePath: app.workspaceRoot,
    componentPaths: app.components,
    updatedAt: new Date().toISOString(),
  };
  return [
    localFileWorkspace,
    ...registered.filter((workspace) => workspace.id !== localFileWorkspace.id),
  ];
}

export default defineAction({
  description:
    "Create or update a React component file in a registered local Content components folder. Use after list-local-component-files identifies the workspaceId.",
  schema: z.object({
    workspaceId: z
      .string()
      .min(1)
      .describe("Workspace ID returned by list-local-component-files"),
    path: z
      .string()
      .min(1)
      .describe("Relative path under the workspace components folder"),
    content: z.string().describe("Full .tsx/.jsx/.ts/.js source to write"),
  }),
  run: async ({ workspaceId, path: filePath, content }) => {
    const file = await writeLocalComponentFile({
      workspaceId,
      filePath,
      content,
      workspaces: await componentWorkspaces(),
    });
    await registerLocalComponentWorkspace({
      workspacePath: file.workspacePath,
    });
    return {
      ok: true,
      file,
    };
  },
});
