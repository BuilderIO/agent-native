import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateAgentCard } from "@agent-native/core/a2a";
import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { describe, expect, it } from "vitest";

import {
  buildAuthenticatedAgentA2ASkills,
  filterDirectA2AActions,
} from "../../../packages/core/src/server/agent-chat/action-filters-a2a.js";
import { dispatchIntegrationRoutingHint } from "../../../packages/dispatch/src/server/lib/dispatch-routing.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const REQUIRED_CONTENT_ACTIONS = [
  "create-document",
  "get-document",
  "list-documents",
  "search-documents",
  "update-document",
  "move-document",
  "navigate",
  "upsert-database-item-by-key",
];

const ACTION_REGISTRY_TEST_TIMEOUT_MS = 60_000;

async function loadContentActions() {
  generateActionRegistryForProject(projectRoot);

  const registryUrl =
    pathToFileURL(path.join(projectRoot, ".generated/actions-registry.ts"))
      .href + `?cacheBust=${Date.now()}`;
  const { default: modules } = await import(registryUrl);
  return loadActionsFromStaticRegistry(modules);
}

describe("content agent card", () => {
  it(
    "advertises content domain actions from the generated static registry",
    async () => {
      const actions = await loadContentActions();
      const card = generateAgentCard(
        {
          name: "Content",
          description: "Agent-native content agent",
          skills: Object.entries(actions).map(([name, entry]) => ({
            id: name,
            name,
            description: entry.tool.description,
          })),
          streaming: true,
        },
        "https://content.agent-native.com",
      );

      expect(card.name).toBe("Content");
      expect(card.description).toBe("Agent-native content agent");
      expect(card.skills.map((skill) => skill.id)).toEqual(
        expect.arrayContaining(REQUIRED_CONTENT_ACTIONS),
      );
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );

  it(
    "publishes bounded reads and message-only intake mutations for generic Dispatch delegation",
    async () => {
      const actions = await loadContentActions();
      const externalAgentOptions = {
        connectorCatalog: [
          "list-content-databases",
          "describe-content-database",
        ],
      };
      const skills = buildAuthenticatedAgentA2ASkills(
        actions,
        externalAgentOptions,
      );
      const skillsById = new Map(skills.map((skill) => [skill.id, skill]));

      for (const actionName of [
        "list-content-databases",
        "describe-content-database",
      ]) {
        expect(skillsById.get(actionName)).toMatchObject({ readOnly: true });
        expect(skillsById.get(actionName)?.inputSchema).toBeDefined();
      }
      expect(skillsById.get("list-content-databases")?.description).toContain(
        "user-authored description",
      );

      for (const actionName of [
        "submit-content-database-form",
        "add-database-item",
        "update-document",
        "set-document-property",
      ]) {
        expect(skillsById.get(actionName)).toMatchObject({ readOnly: false });
        expect(skillsById.get(actionName)?.inputSchema).toBeUndefined();
      }

      const directlyInvocable = filterDirectA2AActions(
        actions,
        externalAgentOptions,
      );
      expect(directlyInvocable).toHaveProperty("list-content-databases");
      expect(directlyInvocable).toHaveProperty("describe-content-database");
      expect(directlyInvocable).not.toHaveProperty("get-content-database");
      expect(directlyInvocable).not.toHaveProperty(
        "submit-content-database-form",
      );
      expect(directlyInvocable).not.toHaveProperty("update-document");

      const intakeHint = dispatchIntegrationRoutingHint(
        "Add this design request to the editorial intake database",
      );
      expect(intakeHint?.targetAgent).toBeUndefined();
      expect(intakeHint?.instruction).toContain("discovered app capabilities");

      expect(
        dispatchIntegrationRoutingHint(
          "Design a visual mockup for the editorial intake screen",
        ),
      ).toMatchObject({ targetAgent: "design" });
    },
    ACTION_REGISTRY_TEST_TIMEOUT_MS,
  );
});
