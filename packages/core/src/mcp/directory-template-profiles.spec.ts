import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { CHATGPT_DIRECTORY_TOOL_NAMES as contentTools } from "../../../../templates/content/server/plugins/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_TOOL_NAMES as designTools } from "../../../../templates/design/server/plugins/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_TOOL_NAMES as slidesTools } from "../../../../templates/slides/server/plugins/chatgpt-directory-tools.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import { generateActionRegistryForProject } from "../vite/action-types-plugin.js";
import { validateMcpDirectoryProfile } from "./build-server.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const ACTION_REGISTRY_TEST_TIMEOUT_MS = 60_000;

const templateProfiles = [
  { appId: "slides", toolNames: slidesTools },
  { appId: "design", toolNames: designTools },
  { appId: "content", toolNames: contentTools },
] as const;

async function loadTemplateActions(appId: string) {
  const projectRoot = path.join(repoRoot, "templates", appId);
  generateActionRegistryForProject(projectRoot);
  const registrySource = fs.readFileSync(
    path.join(projectRoot, ".generated/actions-registry.ts"),
    "utf8",
  );
  const toolNames = templateProfiles.find(
    (profile) => profile.appId === appId,
  )?.toolNames;
  if (!toolNames)
    throw new Error(`Unknown ChatGPT directory template ${appId}.`);
  const modules = Object.fromEntries(
    await Promise.all(
      toolNames.map(async (name) => {
        const symbol = `a_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
        if (!registrySource.includes(`"${name}": ${symbol}`)) {
          throw new Error(`${appId} action registry is missing "${name}".`);
        }
        const actionUrl =
          pathToFileURL(path.join(projectRoot, "actions", `${name}.ts`)).href +
          `?cacheBust=${Date.now()}`;
        return [name, await import(actionUrl)];
      }),
    ),
  );
  return loadActionsFromStaticRegistry(modules);
}

describe("ChatGPT directory template profiles", () => {
  it.each(templateProfiles)(
    "$appId allowlist is registered, exposed, annotated, and narrowly scoped",
    async ({ appId, toolNames }) => {
      const actions = await loadTemplateActions(appId);

      expect(() =>
        validateMcpDirectoryProfile({
          name: `agent-native-${appId}`,
          appId,
          description: "ChatGPT directory profile validation",
          catalogMode: "directory",
          actions,
          productionActions: actions,
          directoryProfile: { connectorCatalog: [...toolNames] },
        }),
      ).not.toThrow();
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );
});
