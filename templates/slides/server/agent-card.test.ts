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

const REQUIRED_SLIDES_ACTIONS = [
  "create-deck",
  "add-slide",
  "get-deck",
  "list-decks",
  "update-slide",
  "navigate",
];

describe("slides agent card", () => {
  it("advertises slides domain actions from the generated static registry", async () => {
    generateActionRegistryForProject(projectRoot);

    const registryUrl =
      pathToFileURL(path.join(projectRoot, ".generated/actions-registry.ts"))
        .href + `?cacheBust=${Date.now()}`;
    const { default: modules } = await import(registryUrl);
    const actions = loadActionsFromStaticRegistry(modules);
    const card = generateAgentCard(
      {
        name: "Slides",
        description: "Agent-native slides agent",
        skills: Object.entries(actions).map(([name, entry]) => ({
          id: name,
          name,
          description: entry.tool.description,
        })),
        streaming: true,
      },
      "https://slides.agent-native.com",
    );

    expect(card.name).toBe("Slides");
    expect(card.description).toBe("Agent-native slides agent");
    expect(card.skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(REQUIRED_SLIDES_ACTIONS),
    );
  });
});
