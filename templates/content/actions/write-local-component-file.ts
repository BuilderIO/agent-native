import { defineAction } from "@agent-native/core";
import { getLocalArtifactApp } from "@agent-native/core/local-artifacts";
import { z } from "zod";
import {
  localComponentWorkspaceId,
  localComponentWorkspaceScope,
  readLocalComponentWorkspacesSync,
  resolveLocalComponentWorkspacePath,
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

async function componentWorkspaces(
  scope: string,
): Promise<LocalComponentWorkspace[]> {
  const registered = readLocalComponentWorkspacesSync(undefined, scope);
  const app = await getLocalArtifactApp({
    appId: "content",
    defaults: CONTENT_LOCAL_DEFAULTS,
  });
  if (app.mode !== "local-files" || app.components.length === 0) {
    return registered;
  }
  const workspacePath = resolveLocalComponentWorkspacePath(app.workspaceRoot);
  const localFileWorkspace: LocalComponentWorkspace = {
    id: localComponentWorkspaceId(workspacePath),
    workspacePath,
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
    componentRoot: z
      .string()
      .optional()
      .describe(
        "Optional absolute component root returned by list-local-component-files. Use when writing a new file into a non-default component root.",
      ),
    content: z.string().describe("Full .tsx/.jsx/.ts/.js source to write"),
  }),
  run: async (
    { workspaceId, path: filePath, componentRoot, content },
    context,
  ) => {
    const scope = localComponentWorkspaceScope(context?.userEmail);
    const file = await writeLocalComponentFile({
      workspaceId,
      filePath,
      componentRoot,
      content,
      workspaces: await componentWorkspaces(scope),
    });
    return {
      ok: true,
      file,
    };
  },
});
