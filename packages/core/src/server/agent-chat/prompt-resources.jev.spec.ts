import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../../app-config/store.js";
import type { DiscoveredAgentsWithDirectoryStatus } from "../agent-discovery.js";

const mocks = vi.hoisted(() => ({
  useRealRanker: { value: false },
  rankJevCandidates: vi.fn(),
  track: vi.fn(),
  loadAgentsBundle: vi.fn(),
  generateSkillsPromptBlock: vi.fn(() => ""),
  getRuntimeSkills: vi.fn(),
  getRuntimeSkillsForUser: vi.fn(),
  getEnabledSkillLabsForUser: vi.fn(),
  requestOrgId: vi.fn(() => null),
  requestUserEmail: vi.fn(() => undefined),
  discoverAgentsWithDirectoryStatus: vi.fn(
    async (): Promise<DiscoveredAgentsWithDirectoryStatus> => ({
      agents: [],
      directory: { status: "available" as const },
    }),
  ),
  resourceGet: vi.fn(),
  resourceGetByPath: vi.fn(),
  resourceList: vi.fn(),
  resourceListAccessible: vi.fn(),
  requestRunContext: vi.fn((): Record<string, unknown> | null => null),
}));

vi.mock("../../agent/jev-tool-prefetch.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../agent/jev-tool-prefetch.js")
  >("../../agent/jev-tool-prefetch.js");
  return {
    JEV_TIMEOUT_MS: 750,
    rankJevCandidates: (...args: unknown[]) => mocks.rankJevCandidates(...args),
    // The stub can only say selected or no-match; `useRealRanker` runs the
    // real ranker so its failed and timed_out outcomes reach the preload.
    rankJevCandidatesWithStatus: async (
      ...args: Parameters<typeof actual.rankJevCandidatesWithStatus>
    ) => {
      if (mocks.useRealRanker.value) {
        return actual.rankJevCandidatesWithStatus(...args);
      }
      const ids = (await mocks.rankJevCandidates(...args)) as string[];
      return {
        status: ids.length > 0 ? "selected" : "no-match",
        ids,
      };
    },
  };
});
vi.mock("../agents-bundle.js", () => ({
  loadAgentsBundle: (...args: unknown[]) => mocks.loadAgentsBundle(...args),
  generateSkillsPromptBlock: (...args: unknown[]) =>
    mocks.generateSkillsPromptBlock(...args),
  getRuntimeSkills: (...args: unknown[]) => mocks.getRuntimeSkills(...args),
  getRuntimeSkillsForUser: (...args: unknown[]) =>
    mocks.getRuntimeSkillsForUser(...args),
  getEnabledSkillLabsForUser: (...args: unknown[]) =>
    mocks.getEnabledSkillLabsForUser(...args),
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
  frameworkGroupEnabled: (
    disabled: ReadonlySet<string> | undefined,
    group: string,
  ) => !disabled?.has(group),
}));
vi.mock("../../tracking/registry.js", () => ({ track: mocks.track }));
vi.mock("../agent-discovery.js", () => ({
  discoverAgentsWithDirectoryStatus: (...args: unknown[]) =>
    mocks.discoverAgentsWithDirectoryStatus(...args),
}));
vi.mock("../request-context.js", () => ({
  getRequestContext: () => null,
  getRequestOrgId: () => mocks.requestOrgId(),
  getRequestUserEmail: () => mocks.requestUserEmail(),
  getRequestRunContext: () => mocks.requestRunContext(),
}));

import { registerAgentContextAgentFilter } from "../agent-context-agents.js";
import {
  loadResourcesForPrompt,
  preloadJevContextForPrompt,
  preloadJevContextWithStatus,
  promptResourceManifestSections,
} from "./prompt-resources.js";

describe("resource skill reference selection and bounded refill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAppConfigForTests();
    mocks.loadAgentsBundle.mockResolvedValue({
      workspaceAgentsMd: "",
      agentsMd: "",
      skills: {},
    });
    mocks.getRuntimeSkillsForUser.mockResolvedValue([]);
    mocks.generateSkillsPromptBlock.mockReturnValue("");
    mocks.getEnabledSkillLabsForUser.mockResolvedValue(new Set());
    mocks.resourceList.mockResolvedValue([]);
    mocks.resourceGetByPath.mockResolvedValue(null);
    mocks.requestOrgId.mockReturnValue(null);
    mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
      agents: [],
      directory: { status: "available" },
    });
  });
  afterEach(() => {
    resetAppConfigForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function candidate(
    index: number,
    frontmatter = "",
    owner = "user@example.test",
  ) {
    const id = `candidate-${String(index).padStart(3, "0")}`;
    return {
      id,
      path: `skills/${id}/SKILL.md`,
      owner,
      mimeType: "text/markdown",
      updatedAt: 1000 - index,
      content: `---\nname: ${id}\ndescription: Short workflow.\n${frontmatter}\n---\nBody ${id}`,
    };
  }

  function catalog(entries: ReturnType<typeof candidate>[]) {
    mocks.resourceListAccessible.mockResolvedValue(
      entries.map(({ content, ...metadata }) => metadata),
    );
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    mocks.resourceGet.mockImplementation(async (id: string) => byId.get(id));
  }

  function skillNames(prompt: string) {
    return [...prompt.matchAll(/^- `([^`]+)` at resource /gm)].map(
      (match) => match[1],
    );
  }

  it("filters supporting paths before hydration while preserving flat Markdown skills and invocation-time config", async () => {
    const reference = {
      ...candidate(0),
      path: "skills/topic/references/guide.md",
    };
    const flat = { ...candidate(1), path: "skills/legacy.md" };
    const nested = candidate(2);
    catalog([reference, flat, nested]);
    const defaultPrompt = await loadResourcesForPrompt(
      "user@example.test",
      true,
    );
    expect(skillNames(defaultPrompt)).toEqual([
      reference.id,
      flat.id,
      nested.id,
    ]);
    expect(mocks.resourceGet).toHaveBeenCalledTimes(3);
    expect(mocks.generateSkillsPromptBlock).not.toHaveBeenCalled();

    defineAppConfig({
      agent: { promptSkills: { includeSupportingFiles: false } },
    });
    mocks.resourceGet.mockClear();
    const filteredPrompt = await loadResourcesForPrompt("user@example.test");
    expect(skillNames(filteredPrompt)).toEqual([flat.id, nested.id]);
    expect(mocks.resourceGet).toHaveBeenCalledTimes(2);
    expect(mocks.resourceGet).not.toHaveBeenCalledWith(
      reference.id,
      expect.anything(),
    );
    expect(mocks.generateSkillsPromptBlock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      { includeSupportingFiles: false },
    );
    resetAppConfigForTests();
    await loadResourcesForPrompt("user@example.test");
    expect(mocks.generateSkillsPromptBlock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      { includeSupportingFiles: true },
    );
  });

  it("refills past 81 excluded candidates to 40 eligible distinct skills", async () => {
    const exclusions = [
      "scope: dev",
      "user-invocable: false",
      "requires-lab: disabled.lab",
    ];
    const excluded = Array.from({ length: 81 }, (_, index) =>
      candidate(index, exclusions[index % exclusions.length]),
    );
    const eligible = Array.from({ length: 40 }, (_, index) =>
      candidate(index + 81),
    );
    catalog([...excluded, ...eligible]);
    const prompt = await loadResourcesForPrompt("user@example.test", true);
    expect(skillNames(prompt)).toEqual(eligible.map((entry) => entry.id));
    expect(mocks.resourceGet).toHaveBeenCalledTimes(121);
    expect(prompt).not.toContain("more skills omitted");
    expect(prompt).not.toContain("uninspected candidates remain");
  });

  it("preserves scope priority and accepted-name deduplication across batches", async () => {
    const personal = candidate(0);
    const excluded = Array.from({ length: 39 }, (_, index) =>
      candidate(index + 1, "user-invocable: false"),
    );
    const duplicate = {
      ...candidate(40, "", "__shared__"),
      content: personal.content.replace(
        "Short workflow.",
        "Lower priority duplicate.",
      ),
    };
    const replacement = {
      ...candidate(41, "", "__shared__"),
      content: excluded[0].content.replace(
        "user-invocable: false",
        "user-invocable: true",
      ),
    };
    const workspace = candidate(42, "", "__workspace__");
    catalog([workspace, duplicate, replacement, ...excluded, personal]);
    const prompt = await loadResourcesForPrompt("user@example.test", true);
    expect(skillNames(prompt)).toEqual([
      personal.id,
      excluded[0].id,
      workspace.id,
    ]);
    expect(prompt).not.toContain("Lower priority duplicate.");
    expect(prompt).not.toContain("more skills omitted");
    expect(mocks.resourceGet).toHaveBeenCalledTimes(43);
  });

  it("does not start another hydration batch after filling 40 entries", async () => {
    const entries = Array.from({ length: 121 }, (_, index) =>
      candidate(index, index === 0 ? "scope: dev" : ""),
    );
    catalog(entries);
    let completed = 0;
    const completedAtStart: number[] = [];
    mocks.resourceGet.mockImplementation(async (id: string) => {
      completedAtStart.push(completed);
      await Promise.resolve();
      completed++;
      return entries.find((entry) => entry.id === id);
    });
    const prompt = await loadResourcesForPrompt("user@example.test", true);
    expect(skillNames(prompt)).toEqual(
      entries.slice(1, 41).map((entry) => entry.id),
    );
    expect(prompt).toContain("more skills omitted");
    expect(prompt).toContain("uninspected candidates remain");
    expect(mocks.resourceGet).toHaveBeenCalledTimes(80);
    expect(completedAtStart.slice(0, 40)).toEqual(Array(40).fill(0));
    expect(completedAtStart.slice(40)).toEqual(Array(40).fill(40));
    expect(mocks.resourceGet).not.toHaveBeenCalledWith(
      entries[80].id,
      expect.anything(),
    );
  });

  it.each([60, 121])(
    "retains readerless confirmed omissions with %i candidates",
    async (count) => {
      const entries = Array.from({ length: count }, (_, index) =>
        candidate(index, index === 0 ? "scope: dev" : ""),
      );
      catalog(entries);
      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        true,
        undefined,
        null,
        {
          runtimeToolHints: false,
          skillReadTool: null,
        },
      );
      expect(prompt).toContain(
        "<resource-skills>\n...more skills omitted from the startup summary.",
      );
      expect(prompt.includes("uninspected candidates remain")).toBe(count > 80);
      expect(prompt.match(/scope="personal"/g)).toHaveLength(40);
      for (const entry of entries.slice(1, 41))
        expect(prompt).toContain(`Body ${entry.id}`);
      expect(prompt).not.toContain(`Body ${entries[41].id}`);
      expect(prompt).not.toContain("`resources`");
      expect(prompt).not.toContain("docs-search");
      expect(prompt).not.toContain("tool-search");
      expect(mocks.resourceGet).toHaveBeenCalledTimes(Math.min(count, 80));
    },
  );

  it("retains the omission notice when the final hydrated batch fills the summary", async () => {
    const entries = Array.from({ length: 60 }, (_, index) =>
      candidate(index, index === 0 ? "scope: dev" : ""),
    );
    catalog(entries);
    const prompt = await loadResourcesForPrompt("user@example.test", true);
    expect(skillNames(prompt)).toEqual(
      entries.slice(1, 41).map((entry) => entry.id),
    );
    expect(mocks.resourceGet).toHaveBeenCalledTimes(60);
    expect(prompt).toContain("more skills omitted");
    expect(prompt).not.toContain("uninspected candidates remain");
  });

  it("exhausts a short catalog and counts failed and empty reads without inventing omissions", async () => {
    const entries = [candidate(0), candidate(1), candidate(2)];
    catalog(entries);
    mocks.resourceGet.mockImplementation(async (id: string) => {
      if (id === entries[0].id) throw new Error("Optional read failed");
      return id === entries[1].id ? { ...entries[1], content: "" } : entries[2];
    });
    const prompt = await loadResourcesForPrompt("user@example.test", true);
    expect(skillNames(prompt)).toEqual([entries[2].id]);
    expect(mocks.resourceGet).toHaveBeenCalledTimes(3);
    expect(prompt).not.toContain("uninspected candidates remain");
    expect(prompt).not.toContain("more skills omitted");
  });

  it("does not infer omissions from 80 reads when all 40 eligible skills fit", async () => {
    const entries = Array.from({ length: 80 }, (_, index) =>
      candidate(index, index < 40 ? "scope: dev" : ""),
    );
    catalog(entries);
    const prompt = await loadResourcesForPrompt("user@example.test", true);
    expect(skillNames(prompt)).toEqual(
      entries.slice(40).map((entry) => entry.id),
    );
    expect(mocks.resourceGet).toHaveBeenCalledTimes(80);
    expect(prompt).not.toContain("more skills omitted");
    expect(prompt).not.toContain("uninspected candidates remain");
  });

  it.each([false, true])(
    "classifies the fetched tail without extra reads or Labs (eligible replacement: %s)",
    async (eligibleReplacement) => {
      const entries = Array.from({ length: 48 }, (_, index) =>
        candidate(
          index,
          index === 0 || index === 41
            ? "scope: dev"
            : index === 42
              ? "user-invocable: false"
              : index === 43
                ? "requires-lab: tail.lab"
                : "",
        ),
      );
      entries[44].content = entries[1].content;
      entries[45].content = eligibleReplacement
        ? entries[0].content.replace("scope: dev", "scope: runtime")
        : "";
      catalog(entries);
      mocks.resourceGet.mockImplementation(async (id: string) => {
        if (id === entries[46].id) return null;
        if (id === entries[47].id) throw new Error("Optional tail read failed");
        return entries.find((entry) => entry.id === id);
      });
      const prompt = await loadResourcesForPrompt("user@example.test", true);
      expect(skillNames(prompt)).toEqual(
        entries.slice(1, 41).map((entry) => entry.id),
      );
      expect(prompt.includes("more skills omitted")).toBe(eligibleReplacement);
      expect(prompt).not.toContain("uninspected candidates remain");
      expect(mocks.resourceGet).toHaveBeenCalledTimes(48);
      expect(mocks.getEnabledSkillLabsForUser).toHaveBeenCalledExactlyOnceWith(
        ["tail.lab"],
        "user@example.test",
      );
    },
  );

  it.each([true, false])(
    "reports an unread tail without claiming a proven omission (runtime hints: %s)",
    async (runtimeToolHints) => {
      const entries = Array.from({ length: 41 }, (_, index) =>
        candidate(index),
      );
      catalog(entries);
      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        true,
        undefined,
        null,
        { runtimeToolHints, skillReadTool: null },
      );
      expect(mocks.resourceGet).toHaveBeenCalledTimes(40);
      expect(prompt).toContain(
        "Skill inspection is incomplete after 40 candidate read attempts; uninspected candidates remain.",
      );
      expect(prompt).not.toContain("more skills omitted");
      if (runtimeToolHints)
        expect(skillNames(prompt)).toEqual(
          entries.slice(0, 40).map((entry) => entry.id),
        );
      else {
        expect(prompt.match(/scope="personal"/g)).toHaveLength(40);
        expect(prompt).not.toContain("`resources`");
        expect(prompt).not.toContain("docs-search");
        expect(prompt).not.toContain("tool-search");
      }
    },
  );

  it.each([true, false])(
    "omits an exhausted all-excluded skill catalog (runtime hints: %s)",
    async (runtimeToolHints) => {
      catalog(
        Array.from({ length: 80 }, (_, index) =>
          candidate(index, "scope: dev"),
        ),
      );
      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        true,
        undefined,
        null,
        { runtimeToolHints, skillReadTool: null },
      );
      expect(skillNames(prompt)).toEqual([]);
      expect(mocks.resourceGet).toHaveBeenCalledTimes(80);
      expect(prompt).not.toContain("<resource-skills>");
      expect(prompt).not.toContain("more skills omitted");
      expect(prompt).not.toContain("uninspected candidates remain");
    },
  );

  it.each([0, 3])(
    "stops at 200 attempts and reports uninspected candidates with %i accepted skills",
    async (accepted) => {
      const entries = Array.from({ length: 201 }, (_, index) =>
        candidate(index, index < accepted ? "" : "scope: dev"),
      );
      catalog(entries);
      const prompt = await loadResourcesForPrompt("user@example.test", true);
      expect(skillNames(prompt)).toEqual(
        entries.slice(0, accepted).map((entry) => entry.id),
      );
      expect(prompt).toContain(
        "Skill inspection is incomplete after 200 candidate read attempts; uninspected candidates remain.",
      );
      expect(mocks.resourceGet).toHaveBeenCalledTimes(200);
      expect(
        prompt.includes("The following workspace skills are available"),
      ).toBe(accepted > 0);
      expect(promptResourceManifestSections(prompt)).toContainEqual(
        expect.objectContaining({
          label: "Workspace resource skills",
          governance: "inherited",
        }),
      );
      expect(mocks.resourceGet).not.toHaveBeenCalledWith(
        entries[200].id,
        expect.anything(),
      );
    },
  );

  it.each([0, 3])(
    "retains readerless partial bodies and an inspection notice with %i accepted skills without tool hints",
    async (accepted) => {
      const entries = Array.from({ length: 201 }, (_, index) =>
        candidate(index, index < accepted ? "" : "scope: dev"),
      );
      catalog(entries);
      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        true,
        undefined,
        null,
        { runtimeToolHints: false, skillReadTool: null },
      );
      expect(prompt).toContain(
        "Skill inspection is incomplete after 200 candidate read attempts; uninspected candidates remain.",
      );
      expect(prompt.match(/scope="personal"/g) ?? []).toHaveLength(accepted);
      for (const entry of entries.slice(0, accepted))
        expect(prompt).toContain(`Body ${entry.id}`);
      expect(prompt).not.toContain("`resources`");
      expect(prompt).not.toContain("docs-search");
      expect(prompt).not.toContain("tool-search");
      expect(mocks.resourceGet).toHaveBeenCalledTimes(200);
    },
  );

  it.each([
    { accepted: 0, runtimeToolHints: true },
    { accepted: 3, runtimeToolHints: true },
    { accepted: 0, runtimeToolHints: false },
    { accepted: 3, runtimeToolHints: false },
  ])(
    "finishes a slow first batch without refilling (accepted: $accepted, runtime hints: $runtimeToolHints)",
    async ({ accepted, runtimeToolHints }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(0);
      const entries = Array.from({ length: 81 }, (_, index) =>
        candidate(
          index,
          index < accepted ? "requires-lab: enabled.lab" : "scope: dev",
        ),
      );
      catalog(entries);
      mocks.resourceListAccessible.mockImplementation(async () => {
        vi.setSystemTime(10_000);
        return entries.map(({ content, ...metadata }) => metadata);
      });
      mocks.resourceGet.mockImplementation(async (id: string) => {
        vi.setSystemTime(12_000);
        return entries.find((entry) => entry.id === id);
      });
      mocks.getEnabledSkillLabsForUser.mockResolvedValue(
        new Set(["enabled.lab"]),
      );
      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        true,
        undefined,
        null,
        { runtimeToolHints, skillReadTool: null, promptPreloadDeadlineAt: -1 },
      );
      expect(mocks.resourceGet).toHaveBeenCalledTimes(40);
      expect(
        prompt.includes("The following workspace skills are available"),
      ).toBe(runtimeToolHints && accepted > 0);
      expect(prompt).toContain(
        "Skill inspection is incomplete after 40 candidate read attempts; uninspected candidates remain.",
      );
      if (runtimeToolHints) {
        expect(skillNames(prompt)).toEqual(
          entries.slice(0, accepted).map((entry) => entry.id),
        );
      } else {
        expect(prompt.match(/scope="personal"/g) ?? []).toHaveLength(accepted);
        for (const entry of entries.slice(0, accepted))
          expect(prompt).toContain(`Body ${entry.id}`);
        expect(prompt).not.toContain("`resources`");
        expect(prompt).not.toContain("docs-search");
      }
      if (accepted > 0)
        expect(mocks.getEnabledSkillLabsForUser).toHaveBeenCalledWith(
          Array(accepted).fill("enabled.lab"),
          "user@example.test",
        );
    },
  );

  it("guarantees the first batch even when the next clock observation reaches the deadline", async () => {
    catalog([candidate(0)]);
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 2_000;
      return now;
    });
    const prompt = await loadResourcesForPrompt("user@example.test", true);
    expect(skillNames(prompt)).toEqual([candidate(0).id]);
    expect(mocks.resourceGet).toHaveBeenCalledTimes(1);
  });

  it("keeps a later batch started just before the deadline and stops at the deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const entries = Array.from({ length: 121 }, (_, index) =>
      candidate(
        index,
        index % 40 === 0 ? "requires-lab: enabled.lab" : "scope: dev",
      ),
    );
    catalog(entries);
    mocks.getEnabledSkillLabsForUser.mockImplementation(async () => {
      vi.setSystemTime(
        mocks.getEnabledSkillLabsForUser.mock.calls.length === 1
          ? 1_999
          : 2_000,
      );
      return new Set(["enabled.lab"]);
    });
    const prompt = await loadResourcesForPrompt("user@example.test", true);
    expect(skillNames(prompt)).toEqual([entries[0].id, entries[40].id]);
    expect(mocks.resourceGet).toHaveBeenCalledTimes(80);
    expect(mocks.getEnabledSkillLabsForUser).toHaveBeenCalledTimes(2);
    expect(prompt).toContain(
      "Skill inspection is incomplete after 80 candidate read attempts; uninspected candidates remain.",
    );
  });

  it("fails closed on Lab resolution in a later batch after accepting an earlier skill even after the budget expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    mocks.discoverAgentsWithDirectoryStatus.mockRejectedValue(
      new Error("Early discovery failure"),
    );
    const entries = Array.from({ length: 40 }, (_, index) =>
      candidate(index, index === 0 ? "" : "scope: dev"),
    );
    catalog([...entries, candidate(40, "requires-lab: later.lab")]);
    mocks.resourceGet.mockImplementation(async (id: string) => {
      if (id === "candidate-040") {
        vi.setSystemTime(2_001);
        return candidate(40, "requires-lab: later.lab");
      }
      return entries.find((entry) => entry.id === id);
    });
    mocks.getEnabledSkillLabsForUser.mockRejectedValue(
      new Error("Later Labs unavailable"),
    );
    await expect(
      loadResourcesForPrompt("user@example.test", true),
    ).rejects.toThrow("Later Labs unavailable");
    expect(mocks.resourceGet).toHaveBeenCalledTimes(41);
    expect(mocks.discoverAgentsWithDirectoryStatus).toHaveBeenCalledOnce();
    expect(mocks.getEnabledSkillLabsForUser).toHaveBeenCalledWith(
      ["later.lab"],
      "user@example.test",
    );
  });

  it.each([false, true])(
    "settles discovery during slow skill refill (discovery fails: %s)",
    async (fails) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const entries = Array.from({ length: 41 }, (_, index) =>
        candidate(index, index < 40 ? "scope: dev" : ""),
      );
      catalog(entries);
      let releaseSkill: () => void = vi.fn();
      const skillRead = new Promise<void>((resolve) => {
        releaseSkill = resolve;
      });
      let notifySkillStarted: () => void = vi.fn();
      const skillStarted = new Promise<void>((resolve) => {
        notifySkillStarted = resolve;
      });
      mocks.resourceGet.mockImplementation(async (id: string) => {
        if (id === entries[40].id) {
          notifySkillStarted();
          await skillRead;
        }
        return entries.find((entry) => entry.id === id);
      });
      mocks.discoverAgentsWithDirectoryStatus.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            setTimeout(
              () =>
                fails
                  ? reject(new Error("Directory failed"))
                  : resolve({
                      agents: [
                        {
                          id: "slides",
                          name: "Slides",
                          description: "Create slide decks",
                          url: "https://slides.example.test",
                        },
                      ],
                      directory: { status: "available" },
                    }),
              100,
            );
          }),
      );
      const loading = loadResourcesForPrompt(
        "user@example.test",
        true,
        "chat",
        null,
        { promptPreloadDeadlineAt: 1_300 },
      );
      await skillStarted;
      await vi.advanceTimersByTimeAsync(2_000);
      releaseSkill();
      const prompt = await loading;
      expect(skillNames(prompt)).toEqual([entries[40].id]);
      expect(mocks.resourceGet).toHaveBeenCalledTimes(41);
      expect(
        mocks.discoverAgentsWithDirectoryStatus,
      ).toHaveBeenCalledExactlyOnceWith("chat", {
        includePersonalAgents: false,
      });
      expect(prompt).toContain(
        fails
          ? "unavailable (discovery-failed)"
          : "Org app directory status: available.",
      );
      if (!fails) expect(prompt).toContain("Slides (slides)");
      expect(prompt.indexOf("<available-apps>")).toBeGreaterThan(
        prompt.indexOf("</resource-skills>"),
      );
    },
  );

  it.each(["expired", "disabled"])(
    "does not invoke %s discovery",
    async (mode) => {
      catalog([candidate(0)]);
      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        true,
        undefined,
        null,
        {
          promptPreloadDeadlineAt: mode === "expired" ? -1 : Date.now() + 1_300,
          disabledFrameworkGroups:
            mode === "disabled" ? new Set(["workspaceApps"]) : undefined,
        },
      );
      expect(mocks.discoverAgentsWithDirectoryStatus).not.toHaveBeenCalled();
      expect(prompt.includes("<available-apps>")).toBe(mode === "expired");
      if (mode === "expired")
        expect(prompt).toContain("unavailable (discovery-timed-out)");
    },
  );
});

describe("preloadJevContextForPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useRealRanker.value = false;
    mocks.loadAgentsBundle.mockResolvedValue({
      skills: {},
      agentsMd: "",
      runtimeAgentsMd: "",
      workspaceAgentsMd: "",
    });
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
    mocks.getRuntimeSkillsForUser.mockImplementation(
      (_bundle: unknown, userEmail?: string) =>
        userEmail === "disabled@example.test" ? [] : mocks.getRuntimeSkills(),
    );
    mocks.resourceListAccessible.mockResolvedValue([]);
    mocks.resourceList.mockResolvedValue([]);
    mocks.resourceGetByPath.mockResolvedValue(null);
    mocks.requestOrgId.mockReturnValue(null);
    mocks.requestUserEmail.mockReturnValue(undefined);
    mocks.requestRunContext.mockReturnValue(null);
    mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
      agents: [],
      directory: { status: "available" },
    });
  });

  it.each([false, true])(
    "projects delegated resource context without dead runtime hints (compact: %s)",
    async (compact) => {
      const owner = "user@example.test";
      mocks.loadAgentsBundle.mockResolvedValue({
        skills: {},
        agentsMd: "",
        runtimeAgentsMd: "STATIC_APP_RULE ".repeat(5_000),
      });
      mocks.resourceGetByPath.mockImplementation(
        async (_owner: string, path: string) =>
          path === "memory/INSTRUCTIONS.md"
            ? { content: "PERSONAL_MEMORY_RULE ".repeat(5_000) }
            : null,
      );
      const instruction = {
        id: "instruction",
        owner,
        path: "instructions/workflow.md",
        mimeType: "text/markdown",
      };
      mocks.resourceList.mockImplementation(
        async (resourceOwner: string, prefix?: string) =>
          resourceOwner === owner && prefix === "instructions/"
            ? [instruction]
            : [],
      );
      mocks.resourceGet.mockResolvedValue({
        ...instruction,
        content: "EAGER_WORKFLOW_RULE",
      });

      const prompt = await loadResourcesForPrompt(
        owner,
        compact,
        undefined,
        null,
        {
          runtimeToolHints: false,
          skillReadTool: "docs-search",
          disabledFrameworkGroups: new Set(["workspaceApps"]),
        },
      );
      expect(prompt).toContain("STATIC_APP_RULE");
      expect(prompt).toContain('docs-search --slug "agents-template"');
      expect(prompt).toContain("PERSONAL_MEMORY_RULE");
      expect(prompt).toContain("EAGER_WORKFLOW_RULE");
      expect(prompt).not.toContain("`resources`");
      expect(prompt).not.toContain("<instruction-resources");
      expect(prompt).not.toContain("<workspace-resources");
      expect(prompt).not.toContain("<available-apps>");
      expect(prompt).not.toContain("call-agent");
    },
  );

  it("includes bundled skill text eagerly when a delegated registry has no static reader", async () => {
    const prompt = await loadResourcesForPrompt(
      "user@example.test",
      true,
      undefined,
      null,
      {
        runtimeToolHints: false,
        skillReadTool: null,
        disabledFrameworkGroups: new Set(["workspaceApps"]),
      },
    );
    expect(prompt).toContain("Lead with the customer outcome.");
    expect(prompt).not.toContain("docs-search");
    expect(prompt).not.toContain("`resources`");
  });

  it("ranks workspace apps deterministically before applying the 30-app prompt limit", async () => {
    const candidates = Array.from({ length: 32 }, (_, index) => ({
      id: `app-${String(index + 1).padStart(2, "0")}`,
      name: `App ${String(index + 1).padStart(2, "0")}`,
      description: "General workspace app.",
      source: "workspace" as const,
    }));
    mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
      agents: candidates,
      directory: { status: "available" },
    });

    const prompt = await loadResourcesForPrompt(
      "user@example.test",
      false,
      undefined,
      null,
    );
    const appBlock = prompt.match(
      /<available-apps>[\s\S]*?<\/available-apps>/,
    )?.[0];

    expect(appBlock).toBeDefined();
    expect(appBlock).toContain("- App 01 (app-01)");
    expect(appBlock).toContain("- App 30 (app-30)");
    expect(appBlock).not.toContain("- App 31 (app-31)");
    expect(appBlock).not.toContain("- App 32 (app-32)");
    expect(appBlock?.match(/^\- App /gm)).toHaveLength(30);
    expect(appBlock?.indexOf("- App 01 (app-01)")).toBeLessThan(
      appBlock?.indexOf("- App 02 (app-02)") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("states how to search when workspace apps are omitted", async () => {
    mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
      agents: Array.from({ length: 32 }, (_, index) => ({
        id: `app-${String(index + 1).padStart(2, "0")}`,
        name: `App ${String(index + 1).padStart(2, "0")}`,
        description: "General workspace app.",
        source: "workspace" as const,
      })),
      directory: { status: "available" },
    });

    const prompt = await loadResourcesForPrompt(
      "user@example.test",
      false,
      undefined,
      null,
    );

    expect(prompt).toContain(
      '+2 more — search with describe-workspace-apps query="<capability you need>".',
    );
  });

  it.each([
    ["explicit options", (query: string) => ({ requestText: query })],
    [
      "request context",
      (query: string) => {
        mocks.requestRunContext.mockReturnValue({ appDiscoveryQuery: query });
        return undefined;
      },
    ],
  ] as const)(
    "uses QR request text from %s to include a matching app past the initial 30",
    async (_source, optionsForQuery) => {
      const candidates = Array.from({ length: 30 }, (_, index) => ({
        id: `distractor-${String(index + 1).padStart(2, "0")}`,
        name: `Distractor ${String(index + 1).padStart(2, "0")}`,
        description: "General workspace app.",
        source: "workspace" as const,
      }));
      candidates.push({
        id: "qr-maker",
        name: "QR Maker",
        description: "Create and export QR codes.",
        source: "workspace",
      });
      mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
        agents: candidates,
        directory: { status: "available" },
      });
      const query = "Create a QR code";
      const options = optionsForQuery(query);

      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        false,
        undefined,
        null,
        options,
      );
      const appBlock = prompt.match(
        /<available-apps>[\s\S]*?<\/available-apps>/,
      )?.[0];

      expect(appBlock).toContain("- QR Maker (qr-maker)");
    },
  );

  it("does nothing without a Jev key", async () => {
    await expect(
      preloadJevContextForPrompt({
        request: "draft launch copy",
      }),
    ).resolves.toBe("");
    expect(mocks.rankJevCandidates).not.toHaveBeenCalled();
  });

  const qrRoutingCases = [
    { request: "give me a QR code", selfAppId: undefined },
    {
      request: "add a QR code to this slide",
      selfAppId: "slides",
    },
    { request: "QR for this clip", selfAppId: "clips" },
  ];
  const qrRoutingApps = [
    {
      id: "qr",
      name: "QR Code Generator",
      description: "Generate scannable QR code images.",
      whenToUse: [
        "Create a QR code for Slack.",
        "Insert the generated QR image into a slide.",
        "Make a QR code for a clip link.",
      ],
      aliases: ["QR", "QR code"],
      source: "workspace" as const,
      url: "https://qr.example.test",
      color: "#fff",
    },
    {
      id: "slides",
      name: "Slides",
      description: "Create and edit slide decks.",
      source: "workspace" as const,
      url: "https://slides.example.test",
      color: "#fff",
    },
    {
      id: "clips",
      name: "Clips",
      description: "Record and share screen recordings.",
      source: "workspace" as const,
      url: "https://clips.example.test",
      color: "#fff",
    },
  ];
  const qrRoutingDistractors = [
    {
      id: "mail",
      name: "Mail",
      description: "Send and receive email messages.",
      aliases: ["email"],
      source: "builtin" as const,
    },
    {
      id: "assets",
      name: "Assets",
      description: "Search and manage files, images, and media.",
      source: "workspace" as const,
    },
    {
      id: "content",
      name: "Content",
      description: "Draft, edit, and publish pages.",
      source: "workspace" as const,
    },
    {
      id: "analytics",
      name: "Analytics",
      description: "Explore reports, charts, and metrics.",
      source: "workspace" as const,
    },
    ...Array.from({ length: 26 }, (_, index) => ({
      id: `workspace-app-${index + 1}`,
      name: `Workspace ${index + 1}`,
      description: `Manage records and code for workspace ${index + 1}.`,
      source: "workspace" as const,
    })),
  ];

  it.each(qrRoutingCases)(
    "selects QR in the first three of a realistic 30-app directory for $request without Jev",
    async ({ request, selfAppId }) => {
      mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
        agents: [...qrRoutingApps, ...qrRoutingDistractors].filter(
          (agent) => agent.id !== selfAppId,
        ),
        directory: { status: "available" },
      });

      const result = await preloadJevContextWithStatus({
        request,
        appRequest: request,
        selfAppId,
      });

      expect(result.appSelection?.selectedIds.slice(0, 3)).toContain("qr");
      expect(result.relevantAppsContext).toContain('call-agent agent="qr"');
    },
  );

  it.each(qrRoutingCases)(
    "keeps Jev's QR pick in the first three of a realistic 30-app directory for $request",
    async ({ request, selfAppId }) => {
      mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
        agents: [...qrRoutingApps, ...qrRoutingDistractors].filter(
          (agent) => agent.id !== selfAppId,
        ),
        directory: { status: "available" },
      });
      mocks.rankJevCandidates.mockImplementation(
        async (options: { candidateStateKey: string }) =>
          options.candidateStateKey === "candidate_app" ? ["app:qr"] : [],
      );

      const result = await preloadJevContextWithStatus({
        request,
        appRequest: request,
        selfAppId,
        directApiKey: "org-jev-test-key",
      });

      expect(result.appSelection?.selectedIds.slice(0, 3)).toContain("qr");
      expect(result.relevantAppsContext).toContain('call-agent agent="qr"');
      expect(mocks.rankJevCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          request,
          candidateStateKey: "candidate_app",
          answerKey: "best_app",
          directApiKey: "org-jev-test-key",
        }),
      );
    },
  );

  it.each(qrRoutingCases)(
    "selects the QR app deterministically for $request when Jev is unavailable",
    async ({ request, selfAppId }) => {
      mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
        agents: qrRoutingApps.filter((agent) => agent.id !== selfAppId),
        directory: { status: "available" },
      });

      const result = await preloadJevContextWithStatus({
        request,
        appRequest: request,
        selfAppId,
      });

      expect(result.relevantAppsContext).toContain('selected-ids="qr"');
      expect(result.relevantAppsContext).toContain('call-agent agent="qr"');
      expect(result.appSelection).toMatchObject({
        status: "selected",
        selectedIds: ["qr"],
      });
      expect(result.appSelection?.latencyMs).toBeGreaterThanOrEqual(0);
    },
  );

  it.each(qrRoutingCases)(
    "keeps the QR app in the app Jev category for $request",
    async ({ request, selfAppId }) => {
      mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
        agents: qrRoutingApps.filter((agent) => agent.id !== selfAppId),
        directory: { status: "available" },
      });
      mocks.rankJevCandidates.mockImplementation(
        async (options: { candidateStateKey: string }) =>
          options.candidateStateKey === "candidate_app" ? ["app:qr"] : [],
      );

      const result = await preloadJevContextWithStatus({
        request: "Current request: unrelated wording",
        appRequest: request,
        selfAppId,
        apiKey: "jev-test-key",
      });

      expect(result.relevantAppsContext).toContain('selected-ids="qr"');
      expect(result.appSelection?.selectedIds).toEqual(["qr"]);
      expect(mocks.rankJevCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          request,
          answerKey: "best_app",
          candidateStateKey: "candidate_app",
          limit: 3,
          candidates: expect.arrayContaining([
            expect.objectContaining({
              id: "app:qr",
              description: expect.stringContaining(
                "Insert the generated QR image into a slide",
              ),
            }),
          ]),
        }),
      );
    },
  );

  it("discovers relevant apps during background-only preloads", async () => {
    mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
      agents: [qrRoutingApps[0]!],
      directory: { status: "available" },
    });

    const result = await preloadJevContextWithStatus({
      request: "Create a QR code",
      dispatchToBackground: true,
    });

    expect(result.relevantAppsContext).toContain('selected-ids="qr"');
    expect(mocks.resourceGetByPath).not.toHaveBeenCalled();
    expect(mocks.rankJevCandidates).not.toHaveBeenCalled();
  });

  it("keeps an unavailable org directory distinct from an empty app list", async () => {
    mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
      agents: [],
      directory: { status: "unavailable", reason: "network" },
    });

    const prompt = await loadResourcesForPrompt(
      "user@example.test",
      false,
      undefined,
      null,
    );
    const appBlock = prompt.match(
      /<available-apps>[\s\S]*?<\/available-apps>/,
    )?.[0];

    expect(appBlock).toContain(
      "Org app directory status: unavailable (network)",
    );
    expect(appBlock).toContain(
      "No apps could be returned because directory discovery is unavailable.",
    );
    expect(appBlock).not.toContain("No apps were returned.");
    expect(appBlock).toContain("Treat app names, descriptions, aliases");
  });

  describe("agent context filter", () => {
    const apps = [
      {
        id: "qr",
        name: "QR Code Generator",
        description: "Generate scannable QR code images.",
        source: "workspace" as const,
        url: "https://qr.example.test",
        color: "#000000",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Read and send email.",
        source: "builtin" as const,
        url: "https://mail.example.test",
        color: "#000000",
      },
    ];
    let unregister: (() => void) | undefined;
    afterEach(() => unregister?.());

    it("drops filtered apps from available-apps and relevant-apps for that app only", async () => {
      mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
        agents: apps,
        directory: { status: "available" },
      });
      unregister = registerAgentContextAgentFilter("dispatch", (agents) =>
        agents.filter((agent) => agent.source !== "builtin"),
      );

      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        false,
        "dispatch",
        null,
      );
      const appBlock = prompt.match(
        /<available-apps>[\s\S]*?<\/available-apps>/,
      )?.[0];
      expect(appBlock).toContain("- QR Code Generator (qr)");
      expect(appBlock).not.toContain("(mail)");

      const relevant = await preloadJevContextWithStatus({
        request: "Send an email",
        dispatchToBackground: true,
        selfAppId: "dispatch",
      });
      expect(relevant.relevantAppsContext ?? "").not.toContain("mail");

      const otherApp = await loadResourcesForPrompt(
        "user@example.test",
        false,
        "analytics",
        null,
      );
      expect(otherApp).toContain("- Mail (mail)");
    });

    it("reports a failing filter as failed discovery, not the unfiltered list", async () => {
      mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
        agents: apps,
        directory: { status: "available" },
      });
      unregister = registerAgentContextAgentFilter("dispatch", () => {
        throw new Error("setting unreadable");
      });

      const prompt = await loadResourcesForPrompt(
        "user@example.test",
        false,
        "dispatch",
        null,
      );
      const appBlock = prompt.match(
        /<available-apps>[\s\S]*?<\/available-apps>/,
      )?.[0];
      expect(appBlock).toContain("unavailable (discovery-failed)");
      expect(appBlock).not.toContain("(mail)");
    });
  });

  it("keeps app discovery within the prompt preload deadline", async () => {
    mocks.discoverAgentsWithDirectoryStatus.mockReturnValue(
      new Promise(() => {}),
    );

    const prompt = await loadResourcesForPrompt(
      "user@example.test",
      false,
      undefined,
      null,
      { promptPreloadDeadlineAt: Date.now() + 25 },
    );
    const appBlock = prompt.match(
      /<available-apps>[\s\S]*?<\/available-apps>/,
    )?.[0];

    expect(appBlock).toContain(
      "Org app directory status: unavailable (discovery-timed-out)",
    );
    expect(mocks.discoverAgentsWithDirectoryStatus).toHaveBeenCalledOnce();
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
        answerKey: "best_skill",
        candidateStateKey: "candidate_skill",
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

  it("filters Lab-gated skills from JEV candidates per user", async () => {
    mocks.rankJevCandidates.mockResolvedValue(["context-0"]);

    const disabled = await preloadJevContextForPrompt({
      request: "reuse approved context",
      owner: "disabled@example.test",
      apiKey: "jev-test-key",
    });
    expect(disabled).not.toContain("# Launch messaging");
    expect(mocks.rankJevCandidates).not.toHaveBeenCalled();

    const enabled = await preloadJevContextForPrompt({
      request: "reuse approved context",
      owner: "enabled@example.test",
      apiKey: "jev-test-key",
    });
    expect(enabled).toContain("# Launch messaging");
    expect(mocks.getRuntimeSkillsForUser).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "disabled@example.test",
    );
    expect(mocks.getRuntimeSkillsForUser).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "enabled@example.test",
    );
  });

  it("prefetches Jev context with a saved personal key and no deployment key", async () => {
    mocks.rankJevCandidates.mockResolvedValue(["context-0"]);

    const result = await preloadJevContextForPrompt({
      request: "draft launch copy",
      personalApiKey: " user-jev-key ",
    });

    expect(result).toContain("# Launch messaging");
    expect(mocks.rankJevCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: undefined,
        personalApiKey: "user-jev-key",
        answerKey: "best_skill",
      }),
    );
  });

  it("includes RAG fallback references when Jev is not connected", async () => {
    const result = await preloadJevContextForPrompt({
      request: "How many active users last month?",
      candidates: [
        {
          id: "analytics-reference-1",
          description: "Analytics dictionary entry; retrieval rank 1.",
          metadata: { kind: "analytics-reference" },
          name: "Active users",
          scope: "analytics-catalog",
          content:
            "Metric: active users. Query: SELECT COUNT(DISTINCT user_id).",
        },
      ],
      fallbackCandidateIds: ["analytics-reference-1"],
    });

    expect(result).toContain("<resource");
    expect(result).toContain("Metric: active users");
    expect(mocks.rankJevCandidates).not.toHaveBeenCalled();
  });

  it("keeps a high-similarity reference when Jev selects only a skill", async () => {
    mocks.rankJevCandidates.mockImplementation(
      async (options: { candidateStateKey: string }) =>
        options.candidateStateKey === "candidate_skill" ? ["context-0"] : [],
    );

    const result = await preloadJevContextForPrompt({
      request: "How many active users last month?",
      apiKey: "jev-test-key",
      candidates: [
        {
          id: "analytics-reference-1",
          description: "Approved active users definition.",
          metadata: { kind: "analytics-reference", similarity: "0.82" },
          name: "Active users",
          scope: "analytics-catalog",
          content:
            "Metric: active users. Query: SELECT COUNT(DISTINCT user_id).",
        },
      ],
      fallbackCandidateIds: ["analytics-reference-1"],
    });

    expect(result).toContain("# Launch messaging");
    expect(result).toContain("Metric: active users");
    expect(mocks.rankJevCandidates).toHaveBeenCalledTimes(2);
  });

  it("injects selected Analytics references before long selected skills", async () => {
    mocks.getRuntimeSkills.mockReturnValue(
      ["one", "two", "three"].map((name, index) => ({
        meta: {
          name: `large-skill-${name}`,
          description: "A large skill.",
          scope: "both",
        },
        dir: `.agents/skills/large-skill-${name}`,
        content: `SKILL_BODY_${index} ${"x".repeat(10_000)}`,
      })),
    );
    mocks.rankJevCandidates.mockImplementation(
      async (options: { candidateStateKey: string }) =>
        options.candidateStateKey === "candidate_skill"
          ? ["context-0", "context-1", "context-2"]
          : ["analytics-reference-1"],
    );

    const result = await preloadJevContextForPrompt({
      request: "How many active users last month?",
      appId: "analytics",
      apiKey: "jev-test-key",
      candidates: [
        {
          id: "analytics-reference-1",
          description: "Approved active users definition.",
          metadata: { kind: "analytics-reference" },
          name: "Active users",
          scope: "analytics-catalog",
          content:
            "Metric: active users. Query: SELECT COUNT(DISTINCT user_id).",
        },
      ],
    });

    expect(result).toContain("Metric: active users.");
    expect(result.indexOf("Metric: active users.")).toBeLessThan(
      result.indexOf("SKILL_BODY_0"),
    );
  });

  it("keeps a high-similarity reference when Jev returns no match", async () => {
    mocks.rankJevCandidates.mockResolvedValue([]);

    const result = await preloadJevContextForPrompt({
      request: "What is the weather?",
      apiKey: "jev-test-key",
      candidates: [
        {
          id: "analytics-reference-1",
          description: "An unrelated Analytics definition.",
          metadata: { kind: "analytics-reference", similarity: "0.74" },
          name: "Active users",
          scope: "analytics-catalog",
          content: "Metric: active users.",
        },
      ],
      fallbackCandidateIds: ["analytics-reference-1"],
    });

    expect(result).toContain("Metric: active users.");
  });

  it("honors a no-match for references below the similarity floor", async () => {
    mocks.rankJevCandidates.mockResolvedValue([]);

    const result = await preloadJevContextForPrompt({
      request: "What is the weather?",
      apiKey: "jev-test-key",
      candidates: [
        {
          id: "analytics-reference-1",
          description: "An unrelated Analytics definition.",
          metadata: { kind: "analytics-reference", similarity: "0.1" },
          name: "Unrelated definition",
          scope: "analytics-catalog",
          content: "Metric: unrelated.",
        },
      ],
      fallbackCandidateIds: ["analytics-reference-1"],
    });

    expect(result).toBe("");
  });

  it("keeps high-similarity reference fallback without starting expired Jev work", async () => {
    const requestRunContext: Record<string, unknown> = {};
    mocks.requestRunContext.mockReturnValue(requestRunContext);
    const result = await preloadJevContextForPrompt({
      request: "How many active users last month?",
      apiKey: "jev-test-key",
      appId: "analytics",
      contextPrefetchDeadlineAt: Date.now() - 1,
      candidates: [
        {
          id: "analytics-reference-1",
          description: "Approved active users definition.",
          metadata: { kind: "analytics-reference", similarity: "0.82" },
          name: "Active users",
          scope: "analytics-catalog",
          content: "Metric: active users.",
        },
      ],
      fallbackCandidateIds: ["analytics-reference-1"],
    });

    expect(result).toContain("Metric: active users.");
    expect(mocks.rankJevCandidates).not.toHaveBeenCalled();
    expect(mocks.resourceGetByPath).not.toHaveBeenCalled();
    expect(requestRunContext.analyticsJevPrefetch).toEqual({
      preloadedReferenceCount: 1,
    });
  });

  describe("status", () => {
    const reference = {
      id: "analytics-reference-1",
      description: "Approved active users definition.",
      metadata: { kind: "analytics-reference", similarity: "0.82" },
      name: "Active users",
      scope: "analytics-catalog",
      content: "Metric: active users.",
    };

    it("is empty, not degraded, when nothing relevant exists", async () => {
      mocks.getRuntimeSkills.mockReturnValue([]);

      await expect(
        preloadJevContextWithStatus({
          request: "What is the weather?",
          apiKey: "jev-test-key",
        }),
      ).resolves.toMatchObject({ context: "", status: "empty" });
    });

    it("is timed_out when the deadline passed before anything could load", async () => {
      await expect(
        preloadJevContextWithStatus({
          request: "How many active users last month?",
          apiKey: "jev-test-key",
          contextPrefetchDeadlineAt: Date.now() - 1,
        }),
      ).resolves.toMatchObject({ context: "", status: "timed_out" });
    });

    it("keeps resource prefetch timeouts visible alongside app-selection context", async () => {
      mocks.resourceGetByPath.mockImplementation(() => new Promise(() => {}));
      mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
        agents: [],
        directory: { status: "unavailable", reason: "network" },
      });

      const result = await preloadJevContextWithStatus({
        request: "Find a workspace app for QR codes",
        owner: "user@example.test",
        contextPrefetchDeadlineAt: Date.now() + 25,
      });

      expect(result).toMatchObject({
        context: "",
        status: "timed_out",
        appSelection: {
          status: "unavailable",
          directoryStatus: "unavailable",
        },
      });
      expect(result.relevantAppsContext).toContain(
        "The workspace app directory is not currently available.",
      );
    }, 2_000);

    it("preserves unavailable discovery when the preload has no candidates", async () => {
      mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
        agents: [],
        directory: { status: "unavailable", reason: "network" },
      });

      const result = await preloadJevContextWithStatus({
        request: "Find a workspace app for QR codes",
        appDiscoveryOnly: true,
      });

      expect(result).toMatchObject({
        context: "",
        status: "ok",
        appSelection: {
          status: "unavailable",
          directoryStatus: "unavailable",
        },
      });
      expect(result.relevantAppsContext).toContain(
        'directory-status="unavailable (network)"',
      );
      expect(result.relevantAppsContext).toContain(
        "The workspace app directory is not currently available.",
      );
    });

    it("does not report a directory outage when workspace apps are disabled", async () => {
      const result = await preloadJevContextWithStatus({
        request: "How many active users last month?",
        workspaceAppsEnabled: false,
        candidates: [reference],
        fallbackCandidateIds: [reference.id],
      });

      expect(result.context).toContain("Metric: active users.");
      expect(result.appSelection).toBeUndefined();
      expect(result.relevantAppsContext).toBeUndefined();
      expect(mocks.discoverAgentsWithDirectoryStatus).not.toHaveBeenCalled();
    });

    it("surfaces a timed-out app ranker to the model and diagnostics", async () => {
      mocks.discoverAgentsWithDirectoryStatus.mockResolvedValue({
        agents: [qrRoutingApps[0]!],
        directory: { status: "available" },
      });
      mocks.rankJevCandidates.mockImplementation(
        () => new Promise<string[]>(() => {}),
      );

      const result = await preloadJevContextWithStatus({
        request: "unrelated request",
        appRequest: "unrelated request",
        appDiscoveryOnly: true,
        apiKey: "jev-test-key",
        contextPrefetchDeadlineAt: Date.now() + 25,
      });

      expect(result.appSelection).toMatchObject({ status: "timed_out" });
      expect(result.relevantAppsContext).toContain(
        '<relevant-apps status="timed_out"',
      );
      expect(result.relevantAppsContext).toContain("App ranking timed out.");
      expect(result.relevantAppsContext).toContain("describe-workspace-apps");
    }, 2_000);

    it("surfaces app ranking failure when ranking throws and nothing was injected", async () => {
      mocks.rankJevCandidates.mockRejectedValue(new Error("ranker down"));

      await expect(
        preloadJevContextWithStatus({
          request: "How many active users last month?",
          apiKey: "jev-test-key",
        }),
      ).resolves.toMatchObject({
        context: "",
        status: "failed",
        appSelection: { status: "failed" },
        relevantAppsContext: expect.stringContaining("App ranking failed."),
      });
    });

    describe("with the real ranker", () => {
      const builderAuth = {
        authorization: "Bearer test-token",
        spaceId: null,
        userId: null,
      };
      const preload = (
        extra: Partial<Parameters<typeof preloadJevContextWithStatus>[0]> = {},
      ) =>
        preloadJevContextWithStatus({
          request: "draft launch copy",
          builderAuth,
          ...extra,
        });

      beforeEach(() => {
        mocks.useRealRanker.value = true;
        vi.spyOn(console, "warn").mockImplementation(() => {});
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it("surfaces app ranking failure when the request errors", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => new Response("nope", { status: 500 })),
        );

        await expect(preload()).resolves.toMatchObject({
          context: "",
          status: "failed",
          appSelection: { status: "failed" },
          relevantAppsContext: expect.stringContaining("App ranking failed."),
        });
      });

      it("surfaces app ranking timeout when the request outlives its own timeout", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn(
            (_url: unknown, init?: RequestInit) =>
              new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () =>
                  reject(new DOMException("aborted", "AbortError")),
                );
              }),
          ),
        );

        await expect(preload()).resolves.toMatchObject({
          context: "",
          status: "timed_out",
          appSelection: { status: "timed_out" },
          relevantAppsContext: expect.stringContaining(
            "App ranking timed out.",
          ),
        });
      });

      it("surfaces app ranking failure when the ranking response is unusable", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn(
            async () =>
              new Response(
                JSON.stringify({
                  answers: {
                    best_skill: { probabilities: { "context-0": 2 } },
                  },
                }),
              ),
          ),
        );

        await expect(preload()).resolves.toMatchObject({
          context: "",
          status: "failed",
          appSelection: { status: "failed" },
          relevantAppsContext: expect.stringContaining("App ranking failed."),
        });
      });

      it("still injects the fallback reference when the ranking fails", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => new Response("nope", { status: 500 })),
        );

        const result = await preload({
          appId: "analytics",
          // Below the similarity floor, so only the fallback can inject it.
          candidates: [
            {
              ...reference,
              metadata: { kind: "analytics-reference", similarity: "0.1" },
            },
          ],
          fallbackCandidateIds: ["analytics-reference-1"],
        });

        expect(result.status).toBe("ok");
        expect(result.context).toContain("Metric: active users.");
      });
    });

    it("is ok when a fallback reference was still injected after the deadline", async () => {
      const result = await preloadJevContextWithStatus({
        request: "How many active users last month?",
        apiKey: "jev-test-key",
        appId: "analytics",
        contextPrefetchDeadlineAt: Date.now() - 1,
        candidates: [reference],
        fallbackCandidateIds: ["analytics-reference-1"],
      });

      expect(result.status).toBe("ok");
      expect(result.context).toContain("Metric: active users.");
    });
  });

  it("loads only the selected memory body and ranks its short index summary", async () => {
    const owner = "user@example.test";
    const memoryIndex = [
      "# Memory Index",
      ...Array.from(
        { length: 7 },
        (_, index) =>
          `- [unrelated-${index}](unrelated-${index}.md) — Unrelated note ${index}.`,
      ),
      "- [selected-memory](selected-memory.md) — Prefer the verified Analytics dictionary and BigQuery source dialect.",
    ].join("\n");
    mocks.resourceGetByPath.mockImplementation(
      async (resourceOwner: string, path: string) =>
        resourceOwner === owner && path === "memory/MEMORY.md"
          ? { content: memoryIndex }
          : resourceOwner === owner && path === "memory/selected-memory.md"
            ? {
                content:
                  "---\ntype: feedback\ndescription: query style\n---\nRead the verified data dictionary, then run the live query.",
              }
            : null,
    );
    mocks.rankJevCandidates.mockImplementation(
      async (options: {
        candidates: Array<{ id: string; description: string }>;
      }) => {
        const selected = options.candidates.find((candidate) =>
          candidate.description.includes("verified Analytics dictionary"),
        );
        return selected ? [selected.id] : [];
      },
    );

    const result = await preloadJevContextForPrompt({
      request: "How do we query Analytics data?",
      apiKey: "jev-test-key",
      owner,
      orgId: "org-test",
      appId: "analytics",
    });

    expect(result).toContain("Read the verified data dictionary");
    expect(mocks.rankJevCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({
            id: expect.stringMatching(/^personal-memory-/),
            description:
              "Personal memory: Prefer the verified Analytics dictionary and BigQuery source dialect.",
          }),
        ]),
      }),
    );
    expect(mocks.rankJevCandidates.mock.calls[0]?.[0]).not.toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({
          description: expect.stringContaining(
            "Read the verified data dictionary",
          ),
        }),
      ]),
    });
    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
      owner,
      "memory/MEMORY.md",
      {
        orgId: "org-test",
      },
    );
    expect(
      mocks.resourceGetByPath.mock.calls.map(([resourceOwner, path]) => [
        resourceOwner,
        path,
      ]),
    ).toEqual([
      [owner, "memory/MEMORY.md"],
      ["__organization__:org-test", "memory/MEMORY.md"],
      [owner, "memory/selected-memory.md"],
    ]);
    const rankedCandidates = mocks.rankJevCandidates.mock.calls.flatMap(
      ([options]) =>
        (options as { candidates: Array<{ description: string }> }).candidates,
    );
    expect(JSON.stringify(rankedCandidates)).not.toContain(
      "Read the verified data dictionary",
    );
  });

  it("preloads an exact-term personal memory without Jev", async () => {
    const owner = "user@example.test";
    mocks.resourceGetByPath.mockImplementation(
      async (resourceOwner: string, path: string) =>
        resourceOwner === owner && path === "memory/MEMORY.md"
          ? {
              content:
                "# Memory Index\n- [wife-contact](wife-contact.md) — My wife's name and email address.",
            }
          : resourceOwner === owner && path === "memory/wife-contact.md"
            ? { content: "My wife Alex can be reached at alex@example.test." }
            : null,
    );

    const result = await preloadJevContextForPrompt({
      request: "Email my wife about dinner.",
      owner,
    });

    expect(result).toContain("My wife Alex can be reached");
    expect(mocks.rankJevCandidates).not.toHaveBeenCalled();
    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
      owner,
      "memory/wife-contact.md",
      { orgId: undefined },
    );
  });

  it.each([
    ["a short exact term", "Who is Mom?", "Mom's contact details."],
    ["Arabic", "أرسل بريدًا إلى زوجتي", "زوجتي وعنوان بريدها الإلكتروني."],
    ["Chinese", "给妻子发邮件", "妻子联系人的邮箱地址。"],
  ])(
    "preloads a personal memory for %s without Jev",
    async (_label, request, description) => {
      const owner = "user@example.test";
      mocks.resourceGetByPath.mockImplementation(
        async (resourceOwner: string, path: string) =>
          resourceOwner === owner && path === "memory/MEMORY.md"
            ? {
                content: `# Memory Index\n- [contact](contact.md) — ${description}`,
              }
            : resourceOwner === owner && path === "memory/contact.md"
              ? { content: `Saved contact: ${description}` }
              : null,
      );

      const result = await preloadJevContextForPrompt({ request, owner });

      expect(result).toContain(`Saved contact: ${description}`);
      expect(mocks.rankJevCandidates).not.toHaveBeenCalled();
    },
  );

  it("does not start another selected memory read after the shared budget expires", async () => {
    const owner = "user@example.test";
    const startedBodyPaths: string[] = [];
    mocks.resourceGetByPath.mockImplementation(
      async (_resourceOwner: string, path: string) => {
        if (path === "memory/MEMORY.md") {
          return {
            content:
              "# Memory Index\n- [first](first.md) — First confirmed preference.\n- [second](second.md) — Second confirmed preference.",
          };
        }
        startedBodyPaths.push(path);
        if (startedBodyPaths.length === 1) return new Promise(() => {});
        return { content: "Second memory body." };
      },
    );
    mocks.getRuntimeSkills.mockReturnValue([]);
    mocks.rankJevCandidates.mockImplementation(
      (options: {
        candidateStateKey: string;
        candidates: Array<{ id: string }>;
      }) =>
        options.candidateStateKey === "candidate_memory"
          ? options.candidates.map((candidate) => candidate.id)
          : [],
    );

    await preloadJevContextForPrompt({
      request: "Use the saved preferences.",
      apiKey: "jev-test-key",
      owner,
      contextPrefetchDeadlineAt: Date.now() + 100,
    });

    expect(startedBodyPaths).toHaveLength(1);
  });

  it("does not inject a lexical memory fallback after Jev explicitly returns no-match", async () => {
    const owner = "user@example.test";
    mocks.resourceGetByPath.mockImplementation(
      async (resourceOwner: string, path: string) =>
        resourceOwner === owner && path === "memory/MEMORY.md"
          ? {
              content:
                "# Memory Index\n- [query-preference](query-preference.md) — Prefer BigQuery STRING instead of ILIKE for Analytics.",
            }
          : resourceOwner === owner && path === "memory/query-preference.md"
            ? {
                content:
                  "---\ntype: feedback\ndescription: query preference\n---\nDo not reuse this stale query preference.",
              }
            : null,
    );
    mocks.rankJevCandidates.mockResolvedValue([]);

    const result = await preloadJevContextForPrompt({
      request: "Prefer BigQuery STRING instead of ILIKE for Analytics.",
      apiKey: "jev-test-key",
      owner,
      orgId: "org-test",
    });

    expect(result).not.toContain("stale query preference");
    expect(
      mocks.resourceGetByPath.mock.calls.map(([resourceOwner, path]) => [
        resourceOwner,
        path,
      ]),
    ).toEqual([
      [owner, "memory/MEMORY.md"],
      ["__organization__:org-test", "memory/MEMORY.md"],
    ]);
  });

  it("loads only org-scoped memory for the active org and rejects index traversal", async () => {
    const owner = "user@example.test";
    const orgId = "org-a";
    const orgOwner = "__organization__:org-a";
    const otherOrgOwner = "__organization__:org-b";
    mocks.getRuntimeSkills.mockReturnValue([]);
    mocks.resourceGetByPath.mockImplementation(
      async (resourceOwner: string, path: string) => {
        if (resourceOwner === owner && path === "memory/MEMORY.md") return null;
        if (resourceOwner === orgOwner && path === "memory/MEMORY.md") {
          return {
            content: [
              "# Memory Index",
              "- [other-org](../other-org.md) — Never read this cross-org entry.",
              "- [dialect](dialect.md) — Use BigQuery STRING instead of ILIKE.",
            ].join("\n"),
          };
        }
        if (resourceOwner === orgOwner && path === "memory/dialect.md") {
          return { content: "For this organization, use BigQuery STRING." };
        }
        if (resourceOwner === otherOrgOwner && path === "memory/other-org.md") {
          return { content: "This must stay in another organization." };
        }
        return null;
      },
    );
    mocks.rankJevCandidates.mockImplementation((input: any) => {
      const candidate = input.candidates.find(
        (item: any) =>
          item.metadata?.kind === "personal-memory" &&
          item.metadata?.scope === "current-org",
      );
      return candidate ? [candidate.id] : [];
    });

    const result = await preloadJevContextForPrompt({
      request: "How should I query active users?",
      apiKey: "jev-test-key",
      owner,
      orgId,
    });

    expect(result).toContain("For this organization, use BigQuery STRING.");
    expect(result).not.toContain("This must stay in another organization.");
    const reads = mocks.resourceGetByPath.mock.calls.map(
      ([resourceOwner, path]) => [resourceOwner, path],
    );
    expect(reads).toContainEqual([orgOwner, "memory/MEMORY.md"]);
    expect(reads).toContainEqual([orgOwner, "memory/dialect.md"]);
    expect(reads).not.toContainEqual([owner, "memory/dialect.md"]);
    expect(reads).not.toContainEqual([otherOrgOwner, "memory/MEMORY.md"]);
    expect(reads).not.toContainEqual([otherOrgOwner, "memory/other-org.md"]);
  });

  it("skips Jev and memory retrieval before background dispatch", async () => {
    await expect(
      preloadJevContextForPrompt({
        request: "How do we query Analytics data?",
        apiKey: "jev-test-key",
        owner: "user@example.test",
        appId: "analytics",
        dispatchToBackground: true,
      }),
    ).resolves.toBe("");

    expect(mocks.resourceGetByPath).not.toHaveBeenCalled();
    expect(mocks.rankJevCandidates).not.toHaveBeenCalled();
  });

  it.each([
    ["worker", { dispatchToBackground: false }],
    ["internal continuation", { internalContinuation: true }],
  ] as const)(
    "injects Analytics references and records their count in a %s prompt",
    async (_mode, requestOptions) => {
      const requestRunContext: Record<string, unknown> = {
        isBackgroundWorker: true,
      };
      mocks.requestRunContext.mockReturnValue(requestRunContext);
      mocks.getRuntimeSkills.mockReturnValue([]);

      const result = await preloadJevContextForPrompt({
        request: "How many active users last month?",
        appId: "analytics",
        ...requestOptions,
        candidates: [
          {
            id: "analytics-reference-1",
            description: "Approved active users definition.",
            metadata: { kind: "analytics-reference" },
            name: "Active users",
            scope: "analytics-catalog",
            content: "Metric: active users.",
          },
        ],
        fallbackCandidateIds: ["analytics-reference-1"],
      });

      expect(result).toContain("Metric: active users.");
      expect(requestRunContext.analyticsJevPrefetch).toEqual({
        preloadedReferenceCount: 1,
      });
    },
  );

  it("uses lexical reference fallbacks when Jev outlives the shared budget", async () => {
    mocks.getRuntimeSkills.mockReturnValue([]);
    const signals: AbortSignal[] = [];
    mocks.rankJevCandidates.mockImplementation(
      (options: { signal?: AbortSignal }) => {
        if (options.signal) signals.push(options.signal);
        return new Promise<string[]>(() => {});
      },
    );

    const result = await preloadJevContextForPrompt({
      request: "How many active users last month?",
      apiKey: "jev-test-key",
      contextPrefetchDeadlineAt: Date.now() + 100,
      candidates: [
        {
          id: "analytics-reference-1",
          description: "Approved active users definition.",
          metadata: { kind: "analytics-reference" },
          name: "Active users",
          scope: "analytics-catalog",
          content: "Metric: active users.",
        },
      ],
      fallbackCandidateIds: ["analytics-reference-1"],
    });

    expect(result).toContain("Metric: active users.");
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("records privacy-safe Analytics Jev selection counts", async () => {
    mocks.rankJevCandidates.mockResolvedValue(["analytics-reference-1"]);

    await preloadJevContextForPrompt({
      request: "How many active users last month?",
      apiKey: "jev-test-key",
      appId: "analytics",
      candidates: [
        {
          id: "analytics-reference-1",
          kind: "analytics-reference",
          description: "A private metric label",
          metadata: { kind: "analytics-reference" },
          name: "Private dashboard name",
          scope: "analytics-catalog",
          content: "Private SQL body",
        },
      ],
    });

    await vi.waitFor(() =>
      expect(mocks.track).toHaveBeenCalledWith(
        "jev_context_prefetch",
        expect.objectContaining({
          jev_configured: true,
          jev_status: "selected",
          selection_source: "jev",
          candidate_analytics_reference_count: 1,
          selected_analytics_reference_count: 1,
        }),
      ),
    );
    const trackedProperties = mocks.track.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(trackedProperties)).not.toContain("Private");
    expect(JSON.stringify(trackedProperties)).not.toContain("SQL");
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

  it("uses the explicit organization instead of conflicting ambient scope for every prompt resource layer", async () => {
    const targetOrgId = "org_prompt_target";
    const ambientOrgId = "org_prompt_ambient";
    const organizationOwner = `__organization__:${targetOrgId}`;
    const owner = "user@example.test";
    const activeOrgId = (options?: { orgId?: string | null }) =>
      options?.orgId === undefined ? mocks.requestOrgId() : options.orgId;
    const resource = (id: string, path: string, resourceOwner: string) => ({
      id,
      owner: resourceOwner,
      path,
      mimeType: "text/markdown",
    });
    mocks.requestOrgId.mockReturnValue(ambientOrgId);
    mocks.resourceGetByPath.mockImplementation(
      async (
        resourceOwner: string,
        path: string,
        options?: { orgId?: string | null },
      ) => {
        const marker =
          activeOrgId(options) === targetOrgId ? "Target" : "Ambient";
        if (resourceOwner === "__shared__") {
          if (path === "AGENTS.md") {
            return { content: `# ${marker} shared AGENTS` };
          }
          if (path === "LEARNINGS.md") {
            return { content: `# ${marker} shared LEARNINGS` };
          }
        }
        if (resourceOwner === organizationOwner) {
          if (path === "AGENTS.md") {
            return { content: `# ${marker} organization AGENTS` };
          }
          if (path === "LEARNINGS.md") return null;
        }
        if (resourceOwner === owner && path === "memory/MEMORY.md") {
          return { content: `# ${marker} personal memory` };
        }
        return null;
      },
    );
    mocks.resourceList.mockImplementation(
      async (
        resourceOwner: string,
        prefix: string | undefined,
        options?: { orgId?: string | null },
      ) => {
        const marker =
          activeOrgId(options) === targetOrgId ? "target" : "ambient";
        if (resourceOwner === "__shared__") {
          return prefix === "instructions/"
            ? [
                resource(
                  `shared-instruction-${marker}`,
                  `instructions/${marker}.md`,
                  resourceOwner,
                ),
              ]
            : [
                resource(
                  `shared-index-${marker}`,
                  `context/${marker}.md`,
                  resourceOwner,
                ),
              ];
        }
        if (resourceOwner === organizationOwner) {
          return prefix === "instructions/"
            ? [
                resource(
                  `organization-instruction-${marker}`,
                  `instructions/org-${marker}.md`,
                  resourceOwner,
                ),
              ]
            : [
                resource(
                  `organization-index-${marker}`,
                  `context/org-${marker}.md`,
                  resourceOwner,
                ),
              ];
        }
        if (resourceOwner === owner) {
          return prefix === "instructions/"
            ? [
                resource(
                  `personal-instruction-${marker}`,
                  `instructions/personal-${marker}.md`,
                  resourceOwner,
                ),
              ]
            : [];
        }
        return [];
      },
    );
    mocks.resourceGet.mockImplementation(async (id: string) => {
      const marker = id.includes("-target")
        ? "Target"
        : id.includes("-ambient")
          ? "Ambient"
          : null;
      if (!marker) return null;
      if (id.includes("shared-instruction")) {
        return { content: `# ${marker} shared instruction` };
      }
      if (id.includes("shared-index")) {
        return { content: `# ${marker} shared index` };
      }
      if (id.includes("organization-instruction")) {
        return { content: `# ${marker} organization instruction` };
      }
      if (id.includes("organization-index")) {
        return { content: `# ${marker} organization index` };
      }
      if (id.includes("personal-instruction")) {
        return { content: `# ${marker} personal instruction` };
      }
      return null;
    });

    const prompt = await loadResourcesForPrompt(
      owner,
      false,
      undefined,
      targetOrgId,
    );

    expect(prompt).toContain("# Target shared AGENTS");
    expect(prompt).toContain("# Target shared instruction");
    expect(prompt).toContain("# Target shared LEARNINGS");
    expect(prompt).toContain("# Target organization AGENTS");
    expect(prompt).toContain("# Target organization instruction");
    expect(prompt).toContain("# Target personal instruction");
    expect(prompt).toContain("# Target personal memory");
    expect(prompt).toContain("context/target.md");
    expect(prompt).toContain("context/org-target.md");
    expect(prompt).not.toContain("Ambient");
    expect(prompt).not.toContain("ambient.md");
  });

  it("prefers the most recently updated resource skill when names repeat", async () => {
    const owner = "user@example.test";
    const candidates = [
      {
        id: "legacy-repeat-skill",
        owner,
        path: "skills/legacy-repeat-skill.md",
        mimeType: "text/markdown",
        updatedAt: 500,
        content:
          "---\nname: repeat-skill\ndescription: Legacy filename version.\n---\n# Legacy",
      },
      {
        id: "repeat-skill-2",
        owner,
        path: "skills/repeat-skill-2/SKILL.md",
        mimeType: "text/markdown",
        updatedAt: 1000,
        content:
          "---\nname: repeat-skill\ndescription: Older version.\n---\n# Older",
      },
      {
        id: "repeat-skill-3",
        owner,
        path: "skills/repeat-skill-3/SKILL.md",
        mimeType: "text/markdown",
        updatedAt: 2000,
        content:
          "---\nname: repeat-skill\ndescription: Newest version.\n---\n# Newest",
      },
    ];
    mocks.resourceListAccessible.mockResolvedValue(
      candidates.map(({ content: _content, ...resource }) => resource),
    );
    mocks.resourceGet.mockImplementation(
      async (id: string) =>
        candidates.find((candidate) => candidate.id === id) ?? null,
    );

    const prompt = await loadResourcesForPrompt(owner, false, undefined, null);

    expect(prompt).toContain(
      "`repeat-skill` at resource `skills/repeat-skill-3/SKILL.md`",
    );
    expect(prompt).toContain("Newest version.");
    expect(prompt).not.toContain("skills/repeat-skill-2/SKILL.md");
    expect(prompt).not.toContain("skills/legacy-repeat-skill.md");
  });

  it("prefers the same personal skill across canonical, suffixed, org, and shared paths", async () => {
    const owner = "user@example.test";
    const candidates = [
      {
        id: "resource-priority-canonical",
        owner,
        path: "skills/resource-priority/SKILL.md",
        mimeType: "text/markdown",
        updatedAt: 1000,
        content:
          "---\nname: resource-priority\ndescription: Older canonical version.\n---\n# Older",
      },
      {
        id: "resource-priority-suffixed",
        owner,
        path: "skills/resource-priority-2/SKILL.md",
        mimeType: "text/markdown",
        updatedAt: 2000,
        content:
          "---\nname: resource-priority\ndescription: Newer personal version.\n---\n# Newer personal",
      },
      {
        id: "resource-priority-organization",
        owner: "__organization__:org-1",
        path: "skills/organization-copy/SKILL.md",
        mimeType: "text/markdown",
        updatedAt: 3000,
        content:
          "---\nname: resource-priority\ndescription: Newer organization version.\n---\n# Organization",
      },
      {
        id: "resource-priority-shared",
        owner: "__shared__",
        path: "skills/shared-copy/SKILL.md",
        mimeType: "text/markdown",
        updatedAt: 4000,
        content:
          "---\nname: resource-priority\ndescription: Newer shared version.\n---\n# Shared",
      },
      {
        id: "organization-priority-organization",
        owner: "__organization__:org-1",
        path: "skills/organization-priority/SKILL.md",
        mimeType: "text/markdown",
        updatedAt: 1000,
        content:
          "---\nname: organization-priority\ndescription: Organization version.\n---\n# Organization",
      },
      {
        id: "organization-priority-shared",
        owner: "__shared__",
        path: "skills/organization-priority-shared/SKILL.md",
        mimeType: "text/markdown",
        updatedAt: 4000,
        content:
          "---\nname: organization-priority\ndescription: Newer shared version.\n---\n# Shared",
      },
    ];
    mocks.resourceListAccessible.mockResolvedValue(
      candidates.map(({ content: _content, ...resource }) => resource),
    );
    mocks.resourceGet.mockImplementation(
      async (id: string) =>
        candidates.find((candidate) => candidate.id === id) ?? null,
    );

    const prompt = await loadResourcesForPrompt(
      owner,
      false,
      undefined,
      "org-1",
    );

    expect(prompt).toContain(
      "`resource-priority` at resource `skills/resource-priority-2/SKILL.md`",
    );
    expect(prompt).toContain("Newer personal version.");
    expect(prompt).not.toContain(
      "`resource-priority` at resource `skills/organization-copy/SKILL.md`",
    );
    expect(prompt).not.toContain(
      "`resource-priority` at resource `skills/shared-copy/SKILL.md`",
    );
    expect(prompt).toContain(
      "`organization-priority` at resource `skills/organization-priority/SKILL.md`",
    );
    expect(prompt).toContain("Organization version.");
    expect(prompt).not.toContain("Newer shared version.");
  });

  it.each([false, true])(
    "loads personal memory instructions in %s compact context",
    async (compact) => {
      const owner = "user@example.test";
      mocks.resourceGetByPath.mockImplementation(
        async (resourceOwner: string, path: string) =>
          resourceOwner === owner && path === "memory/INSTRUCTIONS.md"
            ? {
                content:
                  "Remember stable contact details; skip one-off errands.",
              }
            : null,
      );

      const prompt = await loadResourcesForPrompt(
        owner,
        compact,
        undefined,
        null,
      );

      expect(prompt).toContain("memory/INSTRUCTIONS.md");
      expect(prompt).toContain("Remember stable contact details");
      expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
        owner,
        "memory/INSTRUCTIONS.md",
        { orgId: null },
      );
    },
  );

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
