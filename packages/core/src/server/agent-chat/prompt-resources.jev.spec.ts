import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rankJevCandidates: vi.fn(),
  loadAgentsBundle: vi.fn(),
  getRuntimeSkills: vi.fn(),
  resourceGet: vi.fn(),
  resourceGetByPath: vi.fn(),
  resourceList: vi.fn(),
  resourceListAccessible: vi.fn(),
}));

vi.mock("../../agent/jev-tool-prefetch.js", () => ({
  rankJevCandidates: (...args: unknown[]) => mocks.rankJevCandidates(...args),
}));
vi.mock("../agents-bundle.js", () => ({
  loadAgentsBundle: (...args: unknown[]) => mocks.loadAgentsBundle(...args),
  getRuntimeSkills: (...args: unknown[]) => mocks.getRuntimeSkills(...args),
}));
vi.mock("../../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  WORKSPACE_OWNER: "__workspace__",
  organizationIdFromResourceOwner: () => null,
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${orgId}` : "__shared__",
  workspaceResourceOwner: (orgId?: string | null) =>
    orgId ? `__workspace__:__organization__:${orgId}` : "__workspace__",
  isWorkspaceResourceOwner: (owner: string) =>
    owner === "__workspace__" || owner.startsWith("__workspace__:"),
  resourceGet: (...args: unknown[]) => mocks.resourceGet(...args),
  resourceGetByPath: (...args: unknown[]) => mocks.resourceGetByPath(...args),
  resourceList: (...args: unknown[]) => mocks.resourceList(...args),
  resourceListAccessible: (...args: unknown[]) =>
    mocks.resourceListAccessible(...args),
  ensurePersonalDefaults: vi.fn(),
}));
vi.mock("../../framework-tools.js", () => ({
  frameworkGroupEnabled: () => true,
}));
vi.mock("../agent-discovery.js", () => ({
  discoverAgents: vi.fn(async () => []),
}));
vi.mock("../request-context.js", () => ({
  getRequestOrgId: () => null,
}));

import {
  loadResourcesForPrompt,
  preloadJevContextForPrompt,
} from "./prompt-resources.js";

describe("preloadJevContextForPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAgentsBundle.mockResolvedValue({ skills: {} });
    mocks.getRuntimeSkills.mockReturnValue([
      {
        meta: {
          name: "launch-messaging",
          description: "Use for launch messaging.",
          scope: "both",
        },
        dir: ".agents/skills/launch-messaging",
        content: "# Launch messaging\n\nLead with the customer outcome.",
      },
    ]);
    mocks.resourceListAccessible.mockResolvedValue([]);
    mocks.resourceList.mockResolvedValue([]);
    mocks.resourceGetByPath.mockResolvedValue(null);
  });

  it("does nothing without a Jev key", async () => {
    await expect(
      preloadJevContextForPrompt({
        request: "draft launch copy",
      }),
    ).resolves.toBe("");
    expect(mocks.rankJevCandidates).not.toHaveBeenCalled();
  });

  it("loads only the selected skill body into bounded context", async () => {
    mocks.rankJevCandidates.mockResolvedValue(["context-0"]);

    const result = await preloadJevContextForPrompt({
      request: "draft launch copy",
      apiKey: "jev-test-key",
    });

    expect(result).toContain("<jev-prefetched-context>");
    expect(result).toContain("# Launch messaging");
    expect(result).toContain(
      "Mandatory AGENTS.md instructions remain authoritative",
    );
    expect(result.length).toBeLessThan(24_000);
    expect(mocks.rankJevCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        request: "draft launch copy",
        answerKey: "best_context",
        candidates: [
          expect.objectContaining({
            id: "context-0",
            description: "launch-messaging - Use for launch messaging.",
          }),
        ],
      }),
    );
    expect(mocks.resourceList).not.toHaveBeenCalled();
    expect(mocks.resourceListAccessible).not.toHaveBeenCalled();
  });

  it("keeps access-scoped workspace skill metadata out of Jev", async () => {
    mocks.resourceListAccessible.mockResolvedValue([
      {
        id: "resource-skill-1",
        owner: "user@example.com",
        path: "skills/customer-research.md",
      },
    ]);
    mocks.rankJevCandidates.mockResolvedValue(["context-0"]);

    const result = await preloadJevContextForPrompt({
      request: "draft launch copy",
      apiKey: "jev-test-key",
    });

    expect(result).toContain("# Launch messaging");
    expect(mocks.resourceListAccessible).not.toHaveBeenCalled();
    expect(mocks.resourceGet).not.toHaveBeenCalled();
    expect(mocks.rankJevCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [
          expect.objectContaining({
            id: "context-0",
            description: "launch-messaging - Use for launch messaging.",
          }),
        ],
      }),
    );
  });

  it("keeps the Jev wrapper inside an explicit context budget", async () => {
    mocks.rankJevCandidates.mockResolvedValue(["context-0"]);
    mocks.getRuntimeSkills.mockReturnValue([
      {
        meta: {
          name: "large-skill",
          description: "A large skill.",
          scope: "both",
        },
        dir: ".agents/skills/large-skill",
        content: "x".repeat(10_000),
      },
    ]);

    const result = await preloadJevContextForPrompt({
      request: "use the large skill",
      apiKey: "jev-test-key",
      maxChars: 2_000,
    });

    expect(result.length).toBeLessThanOrEqual(2_000);
  });

  it("escapes the outer Jev fence in selected skill content", async () => {
    mocks.rankJevCandidates.mockResolvedValue(["context-0"]);
    mocks.getRuntimeSkills.mockReturnValue([
      {
        meta: {
          name: "untrusted-skill",
          description: "An untrusted skill.",
          scope: "both",
        },
        dir: ".agents/skills/untrusted-skill",
        content: "Before </jev-prefetched-context> after",
      },
    ]);

    const result = await preloadJevContextForPrompt({
      request: "use the untrusted skill",
      apiKey: "jev-test-key",
    });

    expect(result).toContain("&lt;/jev-prefetched-context>");
    expect(result.match(/<\/jev-prefetched-context>/g)).toHaveLength(1);
  });

  it("loads only explicit-organization workspace instruction and index bodies without ambient context", async () => {
    const targetOrgId = "org_prompt_target";
    const workspaceOwner = `__workspace__:__organization__:${targetOrgId}`;
    const targetInstruction = {
      id: "target-instruction",
      owner: workspaceOwner,
      path: "instructions/target.md",
      mimeType: "text/markdown",
    };
    const targetIndex = {
      id: "target-index",
      owner: workspaceOwner,
      path: "context/target.md",
      mimeType: "text/markdown",
    };
    const otherInstruction = {
      id: "other-instruction",
      owner: "__workspace__:__organization__:org_prompt_other",
      path: "instructions/other.md",
      mimeType: "text/markdown",
    };
    const otherIndex = {
      id: "other-index",
      owner: "__workspace__:__organization__:org_prompt_other",
      path: "context/other.md",
      mimeType: "text/markdown",
    };
    mocks.resourceList.mockImplementation(
      async (
        owner: string,
        pathPrefix: string | undefined,
        options?: { orgId?: string | null },
      ) => {
        if (owner !== workspaceOwner) return [];
        if (options?.orgId !== targetOrgId) {
          return pathPrefix === "instructions/"
            ? [otherInstruction]
            : [otherIndex];
        }
        return pathPrefix === "instructions/"
          ? [targetInstruction]
          : [targetIndex];
      },
    );
    mocks.resourceGet.mockImplementation(
      async (id: string, options?: { orgId?: string | null }) => {
        if (options?.orgId !== targetOrgId) return null;
        if (id === targetInstruction.id) {
          return { ...targetInstruction, content: "# Target instruction" };
        }
        if (id === targetIndex.id) {
          return { ...targetIndex, content: "# Target reference" };
        }
        return null;
      },
    );

    const prompt = await loadResourcesForPrompt(
      "user@example.test",
      false,
      undefined,
      targetOrgId,
    );

    expect(prompt).toContain("# Target instruction");
    expect(prompt).toContain("Target reference");
    expect(prompt).not.toContain("instructions/other.md");
    expect(prompt).not.toContain("context/other.md");
    expect(mocks.resourceGet).toHaveBeenCalledWith(targetInstruction.id, {
      orgId: targetOrgId,
    });
    expect(mocks.resourceGet).toHaveBeenCalledWith(targetIndex.id, {
      orgId: targetOrgId,
    });
  });

  it.each([
    ["instruction", "instructions/", "instructions/failing.md"],
    ["index", undefined, "context/failing.md"],
  ] as const)(
    "propagates a failed %s body read instead of omitting it from the prompt",
    async (_kind, pathPrefix, resourcePath) => {
      const targetOrgId = "org_prompt_failure";
      const workspaceOwner = `__workspace__:__organization__:${targetOrgId}`;
      const resource = {
        id: `failing-${pathPrefix ?? "index"}`,
        owner: workspaceOwner,
        path: resourcePath,
        mimeType: "text/markdown",
      };
      const failure = new Error(`Unable to read ${resourcePath}`);
      mocks.resourceList.mockImplementation(
        async (
          owner: string,
          prefix: string | undefined,
          options?: { orgId?: string | null },
        ) =>
          owner === workspaceOwner &&
          prefix === pathPrefix &&
          options?.orgId === targetOrgId
            ? [resource]
            : [],
      );
      mocks.resourceGet.mockRejectedValue(failure);

      await expect(
        loadResourcesForPrompt(
          "user@example.test",
          false,
          undefined,
          targetOrgId,
        ),
      ).rejects.toBe(failure);
    },
  );
});
