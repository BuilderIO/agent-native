import { createApp } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensurePersonalDefaults: vi.fn(async () => undefined),
  resourceGetByPath: vi.fn(),
  resourceList: vi.fn(),
  resourceListAllOwners: vi.fn(async () => []),
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
  getSession: vi.fn(),
}));

const routeHarness = vi.hoisted(() => ({
  initPromises: [] as Promise<void>[],
}));

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
  workspaceResourceOwner: (orgId?: string | null) =>
    orgId
      ? `__workspace__:__organization__:${encodeURIComponent(orgId)}`
      : "__workspace__",
  isWorkspaceResourceOwner: (owner: string) =>
    owner === "__workspace__" || owner.startsWith("__workspace__:"),
  ensurePersonalDefaults: (...args: any[]) =>
    mocks.ensurePersonalDefaults(...args),
  resourceGetByPath: (...args: any[]) => mocks.resourceGetByPath(...args),
  resourceList: (...args: any[]) => mocks.resourceList(...args),
  resourceListAllOwners: (...args: any[]) =>
    mocks.resourceListAllOwners(...args),
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

vi.mock("./framework-request-handler.js", () => ({
  awaitBootstrap: () => Promise.resolve(),
  getH3App: (nitroApp: { h3App: ReturnType<typeof createApp> }) =>
    nitroApp.h3App,
  markDefaultPluginProvided: vi.fn(),
  trackPluginInit: (_nitroApp: unknown, initPromise: Promise<void>) => {
    routeHarness.initPromises.push(initPromise);
  },
}));

vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  getSession: (...args: any[]) => mocks.getSession(...args),
}));

import {
  createAgentChatPlugin,
  loadResourcesForPrompt,
} from "./agent-chat-plugin.js";
import {
  promptResourceManifestSections,
  registerPromptContextProvider,
} from "./agent-chat/prompt-resources.js";
import {
  getRequestContext,
  getRequestOrgId,
  runWithRequestContext,
} from "./request-context.js";

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
  routeHarness.initPromises.length = 0;
  mocks.getSession.mockResolvedValue(null);
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

async function mountResourceRoutes(options?: {
  resolveOrgId?: (
    event: unknown,
  ) => string | null | undefined | Promise<string | null | undefined>;
}) {
  const h3App = createApp();
  createAgentChatPlugin({
    actions: () => ({}),
    a2aAgentDelegation: false,
    frameworkTools: "minimal",
    leanPrompt: true,
    mcp: { enabled: false },
    ...options,
  })({
    h3App,
    hooks: { hook: vi.fn() },
  });
  const initPromise = routeHarness.initPromises.at(-1);
  if (!initPromise) throw new Error("Agent chat routes did not initialize");
  await initPromise;
  return h3App;
}

async function fetchWithRequestContext(
  h3App: ReturnType<typeof createApp>,
  path: string,
  context: { userEmail?: string; orgId?: string; orgScope?: "personal" },
) {
  return runWithRequestContext(context, () =>
    h3App.fetch(new Request(`http://example.test${path}`)),
  );
}

describe("agent chat resource route organization scopes", () => {
  it("inherits the active request organization when no resolver is configured", async () => {
    const h3App = await mountResourceRoutes();
    expect(mocks.resourceListAllOwners).toHaveBeenCalledWith("jobs/");
    const resourceList = mocks.resourceList.getMockImplementation()!;
    const resourceListContexts: Array<{
      orgId: string | undefined;
      orgScope: "personal" | undefined;
    }> = [];
    mocks.resourceList.mockImplementation(async (...args) => {
      resourceListContexts.push({
        orgId: getRequestOrgId(),
        orgScope: getRequestContext()?.orgScope,
      });
      return resourceList(...args);
    });

    await fetchWithRequestContext(h3App, "/_agent-native/agent-chat/files", {
      userEmail: "user@example.test",
      orgId: "org-active",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", undefined, {
      orgId: "org-active",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      undefined,
      { orgId: "org-active" },
    );

    mocks.resourceList.mockClear();
    await fetchWithRequestContext(h3App, "/_agent-native/agent-chat/skills", {
      userEmail: "user@example.test",
      orgId: "org-active",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", "skills/", {
      orgId: "org-active",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      "skills/",
      { orgId: "org-active" },
    );

    mocks.resourceList.mockClear();
    resourceListContexts.length = 0;
    const mentions = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/mentions",
      { userEmail: "user@example.test", orgId: "org-active" },
    );
    await mentions.text();
    expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", undefined, {
      orgId: "org-active",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      undefined,
      { orgId: "org-active" },
    );
    expect(resourceListContexts).toContainEqual({
      orgId: "org-active",
      orgScope: undefined,
    });
  });

  it("inherits the active request organization when a resolver returns undefined", async () => {
    const h3App = await mountResourceRoutes({ resolveOrgId: () => undefined });
    const resourceList = mocks.resourceList.getMockImplementation()!;
    const resourceListContexts: Array<{
      orgId: string | undefined;
      orgScope: "personal" | undefined;
    }> = [];
    mocks.resourceList.mockImplementation(async (...args) => {
      resourceListContexts.push({
        orgId: getRequestOrgId(),
        orgScope: getRequestContext()?.orgScope,
      });
      return resourceList(...args);
    });

    const mentions = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/mentions",
      { userEmail: "user@example.test", orgId: "org-active" },
    );
    await mentions.text();

    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      undefined,
      { orgId: "org-active" },
    );
    expect(resourceListContexts).toContainEqual({
      orgId: "org-active",
      orgScope: undefined,
    });
  });

  it("passes an explicit organization resolver scope to no-owner skill reads", async () => {
    const h3App = await mountResourceRoutes({
      resolveOrgId: () => "org-resolved",
    });

    await fetchWithRequestContext(h3App, "/_agent-native/agent-chat/skills", {
      userEmail: "user@example.test",
      orgId: "org-active",
    });

    expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", "skills/", {
      orgId: "org-resolved",
    });
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      "skills/",
      { orgId: "org-resolved" },
    );
    expect(mocks.resourceGet).toHaveBeenCalledWith("skills_company_voice", {
      userEmail: undefined,
      orgId: "org-resolved",
    });
  });

  it.each([
    ["/_agent-native/agent-chat/files", undefined],
    ["/_agent-native/agent-chat/skills", "skills/"],
    ["/_agent-native/agent-chat/mentions", undefined],
  ])(
    "uses the resolver organization instead of the ambient organization for shared %s reads",
    async (path, prefix) => {
      const h3App = await mountResourceRoutes({
        resolveOrgId: () => "org-resolved",
      });

      const response = await fetchWithRequestContext(h3App, path, {
        userEmail: "user@example.test",
        orgId: "org-ambient",
      });
      if (path.endsWith("/mentions")) await response.text();

      expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", prefix, {
        orgId: "org-resolved",
      });
    },
  );

  it.each([
    ["/_agent-native/agent-chat/files", undefined],
    ["/_agent-native/agent-chat/skills", "skills/"],
    ["/_agent-native/agent-chat/mentions", undefined],
  ])(
    "preserves an explicit personal resolver scope for no-owner shared %s reads",
    async (path, prefix) => {
      const h3App = await mountResourceRoutes({ resolveOrgId: () => null });
      const resourceList = mocks.resourceList.getMockImplementation()!;
      const resourceListContexts: Array<{
        orgId: string | undefined;
        orgScope: "personal" | undefined;
      }> = [];
      mocks.resourceList.mockImplementation(async (...args) => {
        resourceListContexts.push({
          orgId: getRequestOrgId(),
          orgScope: getRequestContext()?.orgScope,
        });
        return resourceList(...args);
      });

      const response = await fetchWithRequestContext(h3App, path, {
        userEmail: "user@example.test",
        orgId: "org-ambient",
      });
      if (path.endsWith("/mentions")) await response.text();

      expect(mocks.resourceList).toHaveBeenCalledWith("__shared__", prefix, {
        orgId: null,
      });
      if (path.endsWith("/mentions")) {
        expect(resourceListContexts).toContainEqual({
          orgId: undefined,
          orgScope: "personal",
        });
      }
    },
  );

  it("preserves an explicit personal resolver scope for owned skills and mentions", async () => {
    mocks.getSession.mockResolvedValue({ email: "user@example.test" });
    const h3App = await mountResourceRoutes({ resolveOrgId: () => null });

    await fetchWithRequestContext(h3App, "/_agent-native/agent-chat/skills", {
      userEmail: "user@example.test",
      orgId: "org-active",
    });
    expect(mocks.resourceListAccessible).toHaveBeenCalledWith(
      "user@example.test",
      "skills/",
      { userEmail: "user@example.test", orgId: null },
    );
    expect(mocks.resourceGet).toHaveBeenCalledWith("skills_company_voice", {
      userEmail: "user@example.test",
      orgId: null,
    });

    mocks.resourceListAccessible.mockClear();
    const resourceListAccessible =
      mocks.resourceListAccessible.getMockImplementation()!;
    const resourceListAccessibleContexts: Array<{
      orgId: string | undefined;
      orgScope: "personal" | undefined;
    }> = [];
    mocks.resourceListAccessible.mockImplementation(async (...args) => {
      resourceListAccessibleContexts.push({
        orgId: getRequestOrgId(),
        orgScope: getRequestContext()?.orgScope,
      });
      return resourceListAccessible(...args);
    });
    const mentions = await fetchWithRequestContext(
      h3App,
      "/_agent-native/agent-chat/mentions",
      { userEmail: "user@example.test", orgId: "org-active" },
    );
    await mentions.text();
    expect(mocks.resourceListAccessible).toHaveBeenCalledWith(
      "user@example.test",
      undefined,
      { userEmail: "user@example.test", orgId: null },
    );
    expect(resourceListAccessibleContexts).toContainEqual({
      orgId: undefined,
      orgScope: "personal",
    });
  });

  it.each([
    "/_agent-native/agent-chat/files",
    "/_agent-native/agent-chat/skills",
    "/_agent-native/agent-chat/mentions",
  ])(
    "does not turn an organization resolver failure into a personal lookup for %s",
    async (path) => {
      const h3App = await mountResourceRoutes({
        resolveOrgId: () => {
          throw new Error("organization lookup failed");
        },
      });

      const response = await fetchWithRequestContext(h3App, path, {
        userEmail: "user@example.test",
        orgId: "org-active",
      });
      expect(response.status).toBe(500);
      expect(mocks.resourceList).not.toHaveBeenCalled();
      expect(mocks.resourceListAccessible).not.toHaveBeenCalled();
      expect(mocks.resourceGet).not.toHaveBeenCalled();
    },
  );
});

describe("promptResourceManifestSections", () => {
  it("accounts for runtime resource notes, budget notes, and available apps", () => {
    const sections = promptResourceManifestSections(`
<context-note>Personal memory remains available on demand.</context-note>
<context-budget-note>Some startup context was omitted.</context-budget-note>
<available-apps>Analytics (analytics) — Query product data.</available-apps>
`);

    expect(sections).toEqual([
      expect.objectContaining({
        label: "Resource availability note",
        provenance: "framework-core",
        governance: "required",
        content: "Personal memory remains available on demand.",
      }),
      expect.objectContaining({
        label: "Context budget note",
        provenance: "framework-core",
        governance: "required",
        content: "Some startup context was omitted.",
      }),
      expect.objectContaining({
        label: "Available workspace apps",
        provenance: "tools",
        governance: "required",
        content: "Analytics (analytics) — Query product data.",
      }),
    ]);
  });

  it("accounts for registered package context with explicit provenance", () => {
    const sections = promptResourceManifestSections(`
<prompt-context-provider id="creative-context" label="Published brand context" provenance="organization" governance="inherited" scope="org" path="context/brand-context.md">
<brand-context><color>#6633ff</color></brand-context>
</prompt-context-provider>
`);

    expect(sections).toEqual([
      expect.objectContaining({
        label: "Published brand context",
        provenance: "organization",
        governance: "inherited",
        content: "\n<brand-context><color>#6633ff</color></brand-context>\n",
        sourceRef: {
          path: "context/brand-context.md",
          scope: "org",
        },
      }),
    ]);
  });
});

describe("loadResourcesForPrompt", () => {
  it("uses runtime-scoped instructions and excludes development instructions", async () => {
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: "",
      agentsMd: "# Legacy instructions",
      runtimeAgentsMd: "# Runtime instructions",
      developmentAgentsMd: "# Development instructions",
      skills: {},
    });

    const prompt = await loadResourcesForPrompt("user@example.test");

    expect(prompt).toContain("# Runtime instructions");
    expect(prompt).not.toContain("# Development instructions");
    expect(prompt).not.toContain("# Legacy instructions");
  });

  it("loads bounded package context providers into every prompt path", async () => {
    const unregister = registerPromptContextProvider({
      id: "creative-context-test",
      load: async (context) => ({
        label: "Published brand context",
        provenance: context.orgId ? "organization" : "personal",
        governance: "inherited",
        sourceRef: {
          path: "context/brand-context.md",
          scope: context.orgId ? "org" : "user",
        },
        content: "<brand-context><font>Inter</font></brand-context>",
      }),
    });

    try {
      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        false,
        "slides",
        "org_example",
      );
      expect(prompt).toContain(
        '<prompt-context-provider id="creative-context-test"',
      );
      expect(prompt).toContain(
        "<brand-context><font>Inter</font></brand-context>",
      );
      expect(promptResourceManifestSections(prompt)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Published brand context",
            provenance: "organization",
          }),
        ]),
      );
    } finally {
      unregister();
    }
  });

  it("surfaces failures from prompt providers that fail closed", async () => {
    const unregister = registerPromptContextProvider({
      id: "creative-context-required-test",
      failOnError: true,
      load: async () => {
        throw new Error("Labs settings unavailable");
      },
    });

    try {
      await expect(
        loadResourcesForPrompt("user@example.test", false, "slides"),
      ).rejects.toThrow("Labs settings unavailable");
    } finally {
      unregister();
    }
  });

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
      { orgId: null },
    );
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      "instructions/",
      { orgId: null },
    );
    expect(mocks.resourceListAccessible).toHaveBeenCalledWith(
      "user@example.test",
      "skills/",
      { orgId: null },
    );
    expect(mocks.resourceList).toHaveBeenCalledWith(
      "__workspace__",
      undefined,
      {
        orgId: null,
      },
    );

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

  it("loads only the active organization's workspace defaults", async () => {
    const ownerA = "__workspace__:__organization__:org-a";
    const ownerB = "__workspace__:__organization__:org-b";
    const orgResources = new Map(
      [
        {
          id: "org_a_agents",
          owner: ownerA,
          path: "AGENTS.md",
          content: "# Org A Workspace Instructions",
        },
        {
          id: "org_a_guardrails",
          owner: ownerA,
          path: "instructions/guardrails.md",
          content: "# Org A Guardrails",
        },
        {
          id: "org_a_company",
          owner: ownerA,
          path: "context/company.md",
          content: "---\ntitle: Acme\ndescription: Org A company.\n---\n",
        },
        {
          id: "org_b_agents",
          owner: ownerB,
          path: "AGENTS.md",
          content: "# Org B Workspace Instructions",
        },
        {
          id: "org_b_guardrails",
          owner: ownerB,
          path: "instructions/guardrails.md",
          content: "# Org B Guardrails",
        },
        {
          id: "org_b_company",
          owner: ownerB,
          path: "context/company.md",
          content: "---\ntitle: Globex\ndescription: Org B company.\n---\n",
        },
      ].map((resource) => [
        resource.id,
        { ...resource, mimeType: "text/markdown" },
      ]),
    );
    const byOwner = (owner: string, prefix?: string) =>
      [...orgResources.values()].filter(
        (resource) =>
          resource.owner === owner &&
          (!prefix || resource.path.startsWith(prefix)),
      );
    mocks.resourceGetByPath.mockImplementation(
      async (owner, path) =>
        byOwner(owner).find((resource) => resource.path === path) ?? null,
    );
    mocks.resourceList.mockImplementation(async (owner, prefix) =>
      byOwner(owner, prefix).map(({ content, ...meta }) => meta),
    );
    mocks.resourceListAccessible.mockResolvedValue([]);
    mocks.resourceGet.mockImplementation(async (id) => orgResources.get(id));

    const prompt = await loadResourcesForPrompt(
      "user@example.test",
      false,
      "analytics",
      "org-a",
    );

    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(ownerA, "AGENTS.md", {
      orgId: "org-a",
    });
    expect(mocks.resourceGetByPath).not.toHaveBeenCalledWith(
      ownerB,
      "AGENTS.md",
      expect.anything(),
    );
    expect(mocks.resourceGetByPath).not.toHaveBeenCalledWith(
      "__workspace__",
      "AGENTS.md",
      expect.anything(),
    );
    expect(prompt).toContain("# Org A Workspace Instructions");
    expect(prompt).toContain("# Org A Guardrails");
    expect(prompt).toContain("`context/company.md` - Acme: Org A company.");
    expect(prompt).not.toContain("Org B");
    expect(prompt).not.toContain("Globex");
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
      'Read with `docs-search --slug "skill-deep-review"` before starting a task it applies to; reuse that page for subsequent steps in this turn.',
    );
    expect(prompt).toContain("do not repeat an equivalent docs-search lookup");
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

  it("keeps a saved personal AGENTS.md instruction in compact startup context", async () => {
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: "",
      agentsMd: "",
      skills: {},
    });
    mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
      if (path === "AGENTS.md") {
        return {
          content:
            owner === "user@example.test"
              ? "# Saved personal rule\n\nAlways preserve the user's requested output format."
              : `# ${owner} rule\n\n${"context ".repeat(2_000)}`,
        };
      }
      return null;
    });

    const prompt = await loadResourcesForPrompt("user@example.test", true);

    expect(prompt).toContain(
      "Always preserve the user's requested output format.",
    );
    expect(prompt).toContain("# Saved personal rule");
  });

  it("fails loudly when a durable AGENTS.md resource cannot be read", async () => {
    mocks.resourceGetByPath.mockImplementation(async (owner, path) => {
      if (owner === "user@example.test" && path === "AGENTS.md") {
        throw new Error("resource backend unavailable");
      }
      return null;
    });

    await expect(
      loadResourcesForPrompt("user@example.test", true),
    ).rejects.toThrow(
      "Unable to read durable AGENTS.md instructions for personal (user@example.test)",
    );
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

  it("keeps cross-app discovery and names what it dropped when compact context overflows", async () => {
    mocks.discoverAgents.mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, index) => ({
        id: index === 0 ? "analytics" : `app-${index}`,
        name: index === 0 ? "Analytics" : `App ${index}`,
        description: `Query product data ${index}. ${"capability detail ".repeat(20)}`,
      })) as never,
    );
    mocks.loadAgentsBundle.mockResolvedValueOnce({
      workspaceAgentsMd: `# Workspace\n${"workspace ".repeat(2_000)}`,
      agentsMd: `# Template\n${"template ".repeat(2_000)}`,
      skills: Object.fromEntries(
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
      ),
    });
    mocks.resourceGetByPath.mockImplementation(async (_owner, path) => {
      if (path === "AGENTS.md" || path === "LEARNINGS.md") {
        return { content: `# ${path}\n${"instruction ".repeat(2_000)}` };
      }
      return null;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const prompt = await loadResourcesForPrompt("user@example.test", true);

      expect(prompt).toContain("<available-apps>");
      expect(prompt).toContain("Analytics (analytics)");
      expect(prompt).toContain("describe-workspace-apps");
      expect(prompt).toContain("<context-note>");
      expect(prompt).toMatch(/section\(s\) did not fit the 48,000-character/);
      expect(prompt).toContain("Treat them as unread, not as absent");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("startup context exceeded"),
      );
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("required startup context alone exceeds"),
      );
      expect(promptResourceManifestSections(prompt)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Available workspace apps",
            governance: "required",
          }),
          expect.objectContaining({
            label: "Context budget note",
            governance: "required",
          }),
        ]),
      );
    } finally {
      warn.mockRestore();
    }
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
