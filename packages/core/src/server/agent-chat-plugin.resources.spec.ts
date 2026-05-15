import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensurePersonalDefaults: vi.fn(async () => undefined),
  resourceGetByPath: vi.fn(),
  resourceList: vi.fn(),
  resourceListAccessible: vi.fn(),
  resourceGet: vi.fn(),
  discoverAgents: vi.fn(async () => []),
}));

vi.mock("../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  ensurePersonalDefaults: (...args: any[]) =>
    mocks.ensurePersonalDefaults(...args),
  resourceGetByPath: (...args: any[]) => mocks.resourceGetByPath(...args),
  resourceList: (...args: any[]) => mocks.resourceList(...args),
  resourceListAccessible: (...args: any[]) =>
    mocks.resourceListAccessible(...args),
  resourceGet: (...args: any[]) => mocks.resourceGet(...args),
}));

vi.mock("./agent-discovery.js", () => ({
  discoverAgents: (...args: any[]) => mocks.discoverAgents(...args),
}));

vi.mock("./agents-bundle.js", () => ({
  loadAgentsBundle: vi.fn(async () => ({
    workspaceAgentsMd: "",
    agentsMd: "",
    skills: {},
  })),
  generateSkillsPromptBlock: vi.fn(() => ""),
}));

import { loadResourcesForPrompt } from "./agent-chat-plugin.js";

const resourcesById = new Map([
  [
    "instructions_guardrails",
    {
      id: "instructions_guardrails",
      path: "instructions/guardrails.md",
      owner: "__shared__",
      mimeType: "text/markdown",
      content: "# Workspace Guardrails\n\nProtect customer data.",
    },
  ],
  [
    "context_brand",
    {
      id: "context_brand",
      path: "context/brand.md",
      owner: "__shared__",
      mimeType: "text/markdown",
      content:
        "# Brand Guidelines\n\nUse direct language and keep claims grounded.",
    },
  ],
  [
    "context_messaging",
    {
      id: "context_messaging",
      path: "context/messaging.md",
      owner: "__shared__",
      mimeType: "text/markdown",
      content:
        "---\ntitle: Messaging\ndescription: Core value props and proof points.\n---\n\n# Messaging",
    },
  ],
  [
    "skills_company_voice",
    {
      id: "skills_company_voice",
      path: "skills/company-voice/SKILL.md",
      owner: "__shared__",
      mimeType: "text/markdown",
      content:
        "---\nname: company-voice\ndescription: Use the company voice for customer-facing copy.\n---\n\n# Company Voice",
    },
  ],
]);

function meta(id: string) {
  const resource = resourcesById.get(id);
  if (!resource) throw new Error(`Missing test resource ${id}`);
  const { content, ...rest } = resource;
  return rest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
    if (owner === "__shared__" && path === "AGENTS.md") {
      return { content: "# Shared Instructions\n\nUse workspace context." };
    }
    if (owner === "__shared__" && path === "LEARNINGS.md") {
      return { content: "# Learnings\n\n- Prefer concise updates." };
    }
    if (owner === "user@example.test" && path === "memory/MEMORY.md") {
      return { content: "# Memory Index\n\n" };
    }
    return null;
  });
  mocks.resourceList.mockImplementation(async (owner, prefix) => {
    if (owner !== "__shared__") return [];
    if (prefix === "instructions/") {
      return [meta("instructions_guardrails")];
    }
    if (prefix === "skills/") {
      return [meta("skills_company_voice")];
    }
    return [
      { id: "shared_agents", path: "AGENTS.md", mimeType: "text/markdown" },
      meta("instructions_guardrails"),
      meta("skills_company_voice"),
      meta("context_brand"),
      meta("context_messaging"),
    ];
  });
  mocks.resourceListAccessible.mockResolvedValue([
    meta("skills_company_voice"),
  ]);
  mocks.resourceGet.mockImplementation(async (id) => resourcesById.get(id));
});

describe("loadResourcesForPrompt", () => {
  it("loads shared global instructions and indexes shared reference resources", async () => {
    const prompt = await loadResourcesForPrompt("user@example.test");

    expect(mocks.ensurePersonalDefaults).toHaveBeenCalledWith(
      "user@example.test",
    );
    expect(prompt).toContain('<resource name="AGENTS.md" scope="shared"');
    expect(prompt).toContain(
      '<resource name="instructions/guardrails.md" scope="shared-instruction"',
    );
    expect(prompt).toContain("Protect customer data.");
    expect(prompt).toContain("<resource-skills>");
    expect(prompt).toContain("`company-voice` at resource");
    expect(prompt).toContain("<workspace-resources>");
    expect(prompt).toContain("`context/brand.md` - Brand Guidelines");
    expect(prompt).toContain(
      "`context/messaging.md` - Messaging: Core value props and proof points.",
    );
    expect(prompt).not.toContain(
      "<workspace-resources>\nShared workspace reference resources are available for company, brand, positioning, persona, product, or domain context. Use `resource-read --path <path> --scope shared` when a task may depend on them; do not assume their contents without reading the relevant file.\n\n- `instructions/guardrails.md`",
    );
  });
});
