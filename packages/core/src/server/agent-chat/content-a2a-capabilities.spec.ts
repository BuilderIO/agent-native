import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { dispatchIntegrationRoutingHint } from "../../../../dispatch/src/server/lib/dispatch-routing.js";
import { generateActionRegistryForProject } from "../../vite/action-types-plugin.js";
import { loadActionsFromStaticRegistry } from "../action-discovery.js";
import {
  buildAuthenticatedAgentA2ASkills,
  filterDirectA2AActions,
} from "./action-filters-a2a.js";

const contentProjectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../templates/content",
);

const ACTION_REGISTRY_TEST_TIMEOUT_MS = 60_000;

async function loadContentActions() {
  generateActionRegistryForProject(contentProjectRoot);

  const registryUrl =
    pathToFileURL(
      path.join(contentProjectRoot, ".generated/actions-registry.ts"),
    ).href + `?cacheBust=${Date.now()}`;
  const { default: modules } = await import(registryUrl);
  return loadActionsFromStaticRegistry(modules);
}

describe("Content authenticated A2A capabilities", () => {
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
