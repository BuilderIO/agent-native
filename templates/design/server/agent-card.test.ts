import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateAgentCard } from "@agent-native/core/a2a";
import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { generateActionRegistryForProject } from "@agent-native/core/vite";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const REQUIRED_DESIGN_ACTIONS = [
  "create-design",
  "generate-design",
  "get-design",
  "list-designs",
  "update-file",
  "navigate",
];

describe("design agent card", () => {
  it("advertises design domain actions from the generated static registry", async () => {
    generateActionRegistryForProject(projectRoot);

    const registryUrl =
      pathToFileURL(path.join(projectRoot, ".generated/actions-registry.ts"))
        .href + `?cacheBust=${Date.now()}`;
    const { default: modules } = await import(registryUrl);
    const actions = loadActionsFromStaticRegistry(modules);
    const card = generateAgentCard(
      {
        name: "Design",
        description: "Agent-native design agent",
        skills: Object.entries(actions).map(([name, entry]) => ({
          id: name,
          name,
          description: entry.tool.description,
        })),
        streaming: true,
      },
      "https://design.agent-native.com",
    );

    expect(card.name).toBe("Design");
    expect(card.description).toBe("Agent-native design agent");
    expect(card.skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(REQUIRED_DESIGN_ACTIONS),
    );
  });
});
