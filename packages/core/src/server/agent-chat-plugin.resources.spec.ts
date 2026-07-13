import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensurePersonalDefaults: vi.fn(async () => undefined),
  resourceGetByPath: vi.fn(),
  resourceList: vi.fn(),
  resourceListAccessible: vi.fn(),
  resourceGet: vi.fn(),
  resourcePut: vi.fn(async () => undefined),
  discoverAgents: vi.fn(async () => []),
  loadAgentsBundle: vi.fn(async () => ({
    workspaceAgentsMd: "",
    agentsMd: "",
    skills: {},
  })),
  generateSkillsPromptBlock: vi.fn(() => ""),
}));

// Mirror the real `getRuntimeSkills`: drop `scope: dev` skills, keep the rest.
function runtimeSkillsFromBundle(bundle: { skills?: Record<string, any> }) {
  return Object.values(bundle.skills ?? {}).filter(
    (skill: any) => skill?.meta?.scope !== "dev",
  );
}

vi.mock("../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? decodeURIComponent(owner.slice("__organization__:".length))
      : null,
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${encodeURIComponent(orgId)}` : "__shared__",
  ensurePersonalDefaults: (...args: any[]) =>
    mocks.ensurePersonalDefaults(...args),
  resourceGetByPath: (...args: any[]) => mocks.resourceGetByPath(...args),
  resourceList: (...args: any[]) => mocks.resourceList(...args),
  resourceListAccessible: (...args: any[]) =>
    mocks.resourceListAccessible(...args),
  resourceGet: (...args: any[]) => mocks.resourceGet(...args),
  resourcePut: (...args: any[]) => mocks.resourcePut(...args),
}));

vi.mock("./agent-discovery.js", () => ({
  discoverAgents: (...args: any[]) => mocks.discoverAgents(...args),
}));

vi.mock("./agents-bundle.js", () => ({
  loadAgentsBundle: (...args: any[]) => mocks.loadAgentsBundle(...args),
  generateSkillsPromptBlock: (...args: any[]) =>
    mocks.generateSkillsPromptBlock(...args),
  getRuntimeSkills: (bundle: any) => runtimeSkillsFromBundle(bundle),
}));

import { loadResourcesForPrompt } from "./agent-chat-plugin.js";

const resourcesById = new Map([
  [
    "instructions_guardrails",
    {
      id: "instructions_guardrails",
      path: "instructions/guardrails.md",
      owner: "__workspace__",
      mimeType: "text/markdown",
      content: "# Workspace Guardrails\n\nProtect customer data.",
    },
  ],
  [
    "shared_instructions_guardrails",
    {
      id: "shared_instructions_guardrails",
      path: "instructions/guardrails.md",
      owner: "__shared__",
      mimeType: "text/markdown",
      content: "# Organization Guardrails\n\nNarrow workspace guardrails.",
    },
  ],
  [
    "personal_instructions_guardrails",
    {
      id: "personal_instructions_guardrails",
      path: "instructions/guardrails.md",
      owner: "user@example.test",
      mimeType: "text/markdown",
      content: "# Personal Guardrails\n\nPrefer concise local overrides.",
    },
  ],
  [
    "context_brand",
    {
      id: "context_brand",
      path: "context/brand.md",
      owner: "__workspace__",
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
      owner: "__workspace__",
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
      owner: "__workspace__",
      mimeType: "text/markdown",
      content:
        "---\nname: company-voice\ndescription: Workspace voice default.\n---\n\n# Company Voice",
    },
  ],
  [
    "skills_dev_only",
    {
      id: "skills_dev_only",
      path: "skills/dev-only/SKILL.md",
      owner: "__workspace__",
      mimeType: "text/markdown",
      content:
        "---\nname: dev-only\ndescription: Development-only workflow.\nscope: dev\n---\n\n# Dev Only",
    },
  ],
  [
    "shared_skills_company_voice",
    {
      id: "shared_skills_company_voice",
      path: "skills/company-voice/SKILL.md",
      owner: "__shared__",
      mimeType: "text/markdown",
      content:
        "---\nname: company-voice\ndescription: Organization voice override.\n---\n\n# Company Voice",
    },
  ],
  [
    "personal_skills_company_voice",
    {
      id: "personal_skills_company_voice",
      path: "skills/company-voice/SKILL.md",
      owner: "user@example.test",
      mimeType: "text/markdown",
      content:
        "---\nname: company-voice\ndescription: Personal voice override.\n---\n\n# Company Voice",
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
  mocks.loadAgentsBundle.mockResolvedValue({
    workspaceAgentsMd: "",
    agentsMd: "",
    skills: {},
  });
  mocks.generateSkillsPromptBlock.mockReturnValue("");
  mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
    if (owner === "__workspace__" && path === "AGENTS.md") {
      return { content: "# Workspace Instructions\n\nUse global context." };
    }
    if (owner === "__shared__" && path === "AGENTS.md") {
      return {
        content: "# Organization Instructions\n\nOverride workspace defaults.",
      };
    }
    if (owner === "user@example.test" && path === "AGENTS.md") {
      return {
        content: "# Personal Instructions\n\nOverride organization defaults.",
      };
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
    if (owner === "__workspace__") {
      if (prefix === "instructions/") {
        return [meta("instructions_guardrails")];
      }
      if (prefix === "skills/") {
        return [meta("skills_company_voice"), meta("skills_dev_only")];
      }
      return [
        {
          id: "workspace_agents",
          path: "AGENTS.md",
          mimeType: "text/markdown",
          owner,
        },
        meta("instructions_guardrails"),
        meta("skills_company_voice"),
        meta("skills_dev_only"),
        meta("context_brand"),
        meta("context_messaging"),
      ];
    }
    if (owner === "user@example.test") {
      if (prefix === "instructions/") {
        return [meta("personal_instructions_guardrails")];
      }
      if (prefix === "skills/") {
        return [meta("personal_skills_company_voice")];
      }
      return [
        { id: "personal_agents", path: "AGENTS.md", mimeType: "text/markdown" },
        meta("personal_instructions_guardrails"),
        meta("personal_skills_company_voice"),
      ];
    }
    if (owner !== "__shared__") return [];
    if (prefix === "instructions/") {
      return [meta("shared_instructions_guardrails")];
    }
    if (prefix === "skills/") {
      return [meta("shared_skills_company_voice")];
    }
    return [
      { id: "shared_agents", path: "AGENTS.md", mimeType: "text/markdown" },
      meta("shared_instructions_guardrails"),
      meta("shared_skills_company_voice"),
    ];
  });
  mocks.resourceListAccessible.mockResolvedValue([
    meta("skills_company_voice"),
    meta("skills_dev_only"),
    meta("shared_skills_company_voice"),
    meta("personal_skills_company_voice"),
  ]);
  mocks.resourceGet.mockImplementation(async (id) => resourcesById.get(id));
});

describe("loadResourcesForPrompt", () => {
  it("assembles the same inherited workspace context for every app without sync writes", async () => {
    const analyticsPrompt = await loadResourcesForPrompt(
      "user@example.test",
      false,
      "analytics",
    );
    const mailPrompt = await loadResourcesForPrompt(
      "user@example.test",
      false,
      "mail",
    );

    expect(analyticsPrompt).toBe(mailPrompt);
    expect(mocks.resourcePut).not.toHaveBeenCalled();
    expect(mocks.discoverAgents).toHaveBeenCalledWith("analytics");
    expect(mocks.discoverAgents).toHaveBeenCalledWith("mail");

    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
      "__workspace__",
      "AGENTS.md",
    );
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      "instructions/",
    );
    expect(mocks.resourceListAccessible).toHaveBeenCalledWith(
      "user@example.test",
      "skills/",
      { orgId: null },
    );
    expect(mocks.resourceList).toHaveBeenCalledWith("__workspace__");

    expect(analyticsPrompt).toContain(
      '<resource name="instructions/guardrails.md" scope="workspace-instruction"',
    );
    expect(analyticsPrompt).toContain(
      '`company-voice` at resource `skills/company-voice/SKILL.md` (personal) - Personal voice override. Use the `resources` tool with `action: "read"`',
    );
    expect(analyticsPrompt).toContain(
      '<workspace-resources scope="workspace">',
    );
    expect(analyticsPrompt).toContain(
      "Workspace reference resources are inherited by every app",
    );

    expect(analyticsPrompt.indexOf("Workspace Guardrails")).toBeLessThan(
      analyticsPrompt.indexOf("Organization Guardrails"),
    );
    expect(analyticsPrompt.indexOf("Organization Guardrails")).toBeLessThan(
      analyticsPrompt.indexOf("Personal Guardrails"),
    );
    expect(analyticsPrompt).not.toContain("Workspace voice default.");
    expect(analyticsPrompt).not.toContain("Organization voice override.");
  });

  it("loads inherited workspace instructions and indexes workspace reference resources", async () => {
    const prompt = await loadResourcesForPrompt("user@example.test");

    expect(mocks.ensurePersonalDefaults).toHaveBeenCalledWith(
      "user@example.test",
    );
    expect(prompt).toContain('<resource name="AGENTS.md" scope="workspace"');
    expect(prompt).toContain('<resource name="AGENTS.md" scope="shared"');
    expect(prompt).toContain('<resource name="AGENTS.md" scope="personal"');
    expect(prompt).toContain(
      '<resource name="instructions/guardrails.md" scope="workspace-instruction"',
    );
    expect(prompt).toContain(
      '<resource name="instructions/guardrails.md" scope="shared-instruction"',
    );
    expect(prompt).toContain(
      '<resource name="instructions/guardrails.md" scope="personal-instruction"',
    );
    expect(prompt).toContain("Protect customer data.");
    expect(prompt.indexOf('scope="workspace"')).toBeLessThan(
      prompt.indexOf('scope="shared"'),
    );
    expect(prompt.indexOf('scope="shared"')).toBeLessThan(
      prompt.indexOf('scope="personal"'),
    );
    expect(prompt.indexOf("Workspace Guardrails")).toBeLessThan(
      prompt.indexOf("Organization Guardrails"),
    );
    expect(prompt.indexOf("Organization Guardrails")).toBeLessThan(
      prompt.indexOf("Personal Guardrails"),
    );
    expect(prompt).toContain("<resource-skills>");
    expect(prompt).toContain("`company-voice` at resource");
    expect(prompt).toContain("(personal) - Personal voice override.");
    expect(prompt).toContain(
      'Use the `resources` tool with `action: "read"`, `path: "skills/company-voice/SKILL.md"` and `scope: "personal"`',
    );
    expect(prompt).not.toContain("resource-read --path");
    expect(prompt).not.toContain("Workspace voice default.");
    expect(prompt).not.toContain("Organization voice override.");
    expect(prompt).toContain('<workspace-resources scope="workspace">');
    expect(prompt).toContain("`context/brand.md` - Brand Guidelines");
    expect(prompt).toContain(
      "`context/messaging.md` - Messaging: Core value props and proof points.",
    );
    expect(prompt).not.toContain("Use `resource-read --path <path>");
  });

  it("points compact bundled skills at their docs-search skill slugs", async () => {
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: "",
      agentsMd: "",
      skills: {
        "deep-review": {
          meta: {
            name: "deep-review",
            description: "Use when reviewing risky changes.",
            scope: "both",
          },
          content: "---\nname: deep-review\n---\n# Deep Review",
          dir: ".agents/skills/deep-review",
          extraFiles: [],
        },
      },
    });

    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt).toContain("<skills-summary>");
    expect(prompt).toContain("Prefer concise updates.");
    expect(prompt).toContain(
      'Read with `docs-search --slug "skill-deep-review"` before starting a task it applies to.',
    );
    expect(prompt).toContain("Do not use MCP resource reads for these skills.");
    expect(prompt).not.toContain("Use `docs-search` to read a skill");
  });

  it("indexes instruction files instead of inlining their markdown in compact mode", async () => {
    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt).toContain(
      '<instruction-resources scope="workspace-instruction">',
    );
    expect(prompt).toContain("`instructions/guardrails.md`");
    expect(prompt).not.toContain("Protect customer data.");
    expect(prompt).not.toContain("Narrow workspace guardrails.");
    expect(prompt).not.toContain("Prefer concise local overrides.");
  });

  it("keeps aggregate compact startup resources within a fixed budget", async () => {
    const skills = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [
        `skill-${index}`,
        {
          meta: {
            name: `skill-${index}`,
            description: `Runtime workflow ${index} ${"detail ".repeat(40)}`,
            scope: "both",
          },
          content: `# Skill ${index}`,
          dir: `.agents/skills/skill-${index}`,
          extraFiles: [],
        },
      ]),
    );
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: `# Workspace\n${"workspace ".repeat(2_000)}`,
      agentsMd: `# Template\n${"template ".repeat(2_000)}`,
      skills,
    });
    mocks.resourceGetByPath.mockImplementation(async (_owner, path) => {
      if (path === "AGENTS.md" || path === "LEARNINGS.md") {
        return { content: `# ${path}\n${"instruction ".repeat(2_000)}` };
      }
      return null;
    });

    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt.length).toBeLessThan(49_000);
    expect(prompt).toContain("<context-budget-note>");
    expect(prompt).toContain("docs-search");
    expect(prompt).toContain("tool-search");
  });

  it("excludes scope: dev skills from the compact skills summary", async () => {
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: "",
      agentsMd: "",
      skills: {
        "runtime-skill": {
          meta: {
            name: "runtime-skill",
            description: "Visible at runtime.",
            scope: "both",
          },
          content: "---\nname: runtime-skill\n---\n# Runtime",
          dir: ".agents/skills/runtime-skill",
          extraFiles: [],
        },
        "dev-only-skill": {
          meta: {
            name: "dev-only-skill",
            description: "For the human coding agent only.",
            scope: "dev",
          },
          content: "---\nname: dev-only-skill\n---\n# Dev only",
          dir: ".agents/skills/dev-only-skill",
          extraFiles: [],
        },
      },
    });

    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt).toContain("<skills-summary>");
    expect(prompt).toContain("`runtime-skill`");
    expect(prompt).not.toContain("dev-only-skill");
  });

  it("excludes scope: dev resource skills from the runtime prompt", async () => {
    const prompt = await loadResourcesForPrompt("user@example.test");

    expect(prompt).toContain("`company-voice` at resource");
    expect(prompt).not.toContain("dev-only");
    expect(prompt).not.toContain("Development-only workflow.");
  });

  it("caps an oversized shared LEARNINGS.md instead of inlining it in full in the non-lazy (compact: false) path", async () => {
    const hugeLearnings = `# Learnings\n${"- prior incident detail.\n".repeat(3_000)}`;
    mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
      if (owner === "__shared__" && path === "LEARNINGS.md") {
        return { content: hugeLearnings };
      }
      return null;
    });

    const prompt = await loadResourcesForPrompt("user@example.test", false);

    expect(hugeLearnings.length).toBeGreaterThan(30_000);
    expect(prompt).toContain('<resource name="LEARNINGS.md" scope="shared"');
    expect(prompt).toContain("truncated after 30,000 characters");
    expect(prompt).toContain('Use the `resources` tool with `action: "read"`');
    // The full oversized content must not have been inlined verbatim.
    expect(prompt.length).toBeLessThan(hugeLearnings.length);
  });

  it("caps an oversized personal memory/MEMORY.md instead of inlining it in full in the non-lazy (compact: false) path", async () => {
    const hugeMemory = `# Memory Index\n${"- long-term fact.\n".repeat(3_000)}`;
    mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
      if (owner === "user@example.test" && path === "memory/MEMORY.md") {
        return { content: hugeMemory };
      }
      return null;
    });

    const prompt = await loadResourcesForPrompt("user@example.test", false);

    expect(hugeMemory.length).toBeGreaterThan(30_000);
    expect(prompt).toContain(
      '<resource name="memory/MEMORY.md" scope="personal"',
    );
    expect(prompt).toContain("truncated after 30,000 characters");
    expect(prompt.length).toBeLessThan(hugeMemory.length);
  });
});
