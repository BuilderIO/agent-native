import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isActionExposedToExternalAgents } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  loadActionsFromStaticRegistry,
  mergeCoreSharingActions,
} from "../server/action-discovery.js";
import {
  filterAgentTools,
  filterMcpOnlyActions,
} from "../server/agent-chat/action-filters-a2a.js";
import { generateActionRegistryForProject } from "../vite/action-types-plugin.js";
import type { MCPConfig } from "./build-server.js";
import { getBuiltinCrossAppTools } from "./builtin-tools.js";
import { DESTRUCTIVE_HINT_DECISIONS as decisions } from "./destructive-hint-decisions.fixture.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const FIXTURE = "packages/core/src/mcp/destructive-hint-decisions.fixture.ts";
const LOAD_TIMEOUT_MS = 180_000;

async function loadTemplateActions(appId: string) {
  const projectRoot = path.join(repoRoot, "templates", appId);
  generateActionRegistryForProject(projectRoot);
  const registry = await import(
    pathToFileURL(path.join(projectRoot, ".generated/actions-registry.ts"))
      .href + `?cacheBust=${Date.now()}`
  );
  return loadActionsFromStaticRegistry(registry.default);
}

async function loadCoreActions() {
  const actions: Record<string, ActionEntry> = {};
  await mergeCoreSharingActions(actions);
  Object.assign(
    actions,
    getBuiltinCrossAppTools({ name: "core", actions: {} } as MCPConfig),
  );
  return actions;
}

// Same exposure rule the external surface applies: MCP-only actions plus every
// agent tool, minus actions that opt out of external agents.
function externallyExposed(actions: Record<string, ActionEntry>) {
  return Object.entries({
    ...filterMcpOnlyActions(actions),
    ...filterAgentTools(actions),
  }).filter(([, entry]) => isActionExposedToExternalAgents(entry));
}

// What a host would read as `readOnlyHint`: the declared value, else the
// derived one. A tool that is not read-only needs a destructive decision.
function isAdvertisedReadOnly(entry: ActionEntry): boolean {
  return entry.mcpAnnotations
    ? entry.mcpAnnotations.readOnlyHint
    : entry.readOnly === true;
}

function mutatingTools(actions: Record<string, ActionEntry>) {
  return externallyExposed(actions).filter(
    ([, entry]) => !isAdvertisedReadOnly(entry),
  );
}

const templateIds = fs
  .readdirSync(path.join(repoRoot, "templates"), { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      fs.existsSync(path.join(repoRoot, "templates", entry.name, "actions")),
  )
  .map((entry) => entry.name)
  .sort();

describe("MCP destructiveHint decisions", () => {
  it("has a fixture section for every app and nothing else", () => {
    expect(Object.keys(decisions).sort()).toEqual(
      [...templateIds, "core"].sort(),
    );
  });

  it(
    "records a decision for every externally exposed mutating tool without declared annotations",
    async () => {
      const recorded = decisions;
      const apps: Array<[string, Record<string, ActionEntry>]> = [
        ["core", await loadCoreActions()],
        ...(await Promise.all(
          templateIds.map(
            async (appId) =>
              [appId, await loadTemplateActions(appId)] as [
                string,
                Record<string, ActionEntry>,
              ],
          ),
        )),
      ];
      // mergeCoreSharingActions swallows import failures, so a broken core
      // import would otherwise read as "fewer tools to decide".
      expect(Object.keys(apps[0]![1]).length).toBeGreaterThan(100);

      const missing: string[] = [];
      const stale: string[] = [];
      const doubled: string[] = [];
      for (const [appId, actions] of apps) {
        const mutating = mutatingTools(actions);
        // An action that declares mcpAnnotations has made its own decision, so
        // it needs no entry, but may keep one: the declaration wins either way.
        const needsDecision = mutating
          .filter(([, entry]) => !entry.mcpAnnotations)
          .map(([name]) => name);
        const section = recorded[appId]!;
        const all = [...section.destructive, ...section.nonDestructive];
        doubled.push(
          ...section.destructive
            .filter((name) => section.nonDestructive.includes(name))
            .map((name) => `${appId}/${name}`),
        );
        const known = new Set(mutating.map(([name]) => name));
        stale.push(
          ...all.filter((name) => !known.has(name)).map((n) => `${appId}/${n}`),
        );
        missing.push(
          ...needsDecision
            .filter((name) => !all.includes(name))
            .map((name) => `${appId}/${name}`),
        );
      }

      expect(
        missing,
        `These MCP tools can change data but have no reviewed destructiveHint decision. ` +
          `Declare mcpAnnotations on the action (readOnlyHint, destructiveHint, openWorldHint), or add the name ` +
          `to "destructive" (deletes, overwrites, or replaces user content, recoverable Trash included) or ` +
          `"nonDestructive" in ${FIXTURE}. Hosts use this hint to decide when to ask the user first.`,
      ).toEqual([]);
      expect(
        doubled,
        `Listed as both destructive and nonDestructive in ${FIXTURE}.`,
      ).toEqual([]);
      expect(
        stale,
        `These entries in ${FIXTURE} name an action that was removed, is read-only, or is hidden from external agents. Delete them.`,
      ).toEqual([]);
    },
    LOAD_TIMEOUT_MS,
  );
});
