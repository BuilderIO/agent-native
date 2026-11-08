// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orgState = vi.hoisted(() => ({
  value: { orgId: "org-1", orgName: "Acme", role: "member" as string },
}));

const skillChoices = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  setSwitch: vi.fn(async () => {}),
  setMark: vi.fn(async () => {}),
}));

vi.mock("../../../chat/index.js", () => ({ PromptComposer: () => null }));
vi.mock(
  "@agent-native/core/client/resources/use-skill-choices",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/client/resources/use-skill-choices")
    >()),
    useSkillChoices: () => ({
      choices: { switches: {}, marks: {} },
      canMark: false,
      isLoaded: true,
      isError: false,
      counts: null,
      refreshCounts: () => {},
      countsCheck: "done" as const,
      setSwitch: skillChoices.setSwitch,
      setMark: skillChoices.setMark,
      ...skillChoices.value,
    }),
  }),
);
vi.mock("../../../resources/ResourceEditor.js", () => ({
  ResourceEditor: () => null,
}));

vi.mock("@agent-native/core/client/org/hooks", () => ({
  useOrg: () => ({ data: orgState.value, isLoading: false }),
}));
vi.mock("@agent-native/core/client/org/hooks", () => ({
  useOrg: () => ({ data: orgState.value, isLoading: false }),
}));
vi.mock("../../../org/workspace-app-links.js", () => ({
  useOrgSwitcherAppLinks: () => ({
    isWorkspace: true,
    dispatchResourcesHref: "https://dispatch.example.test/workspace",
  }),
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
}));

import type { TreeNode } from "@agent-native/core/client/resources/use-resources";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";

import { createToolkitI18nCatalog } from "../../../i18n.js";
import { SettingsShellProvider, type SettingsPageHeader } from "../context.js";
import FilesSettingsPage from "./files.js";
import InstructionsSettingsPage from "./instructions.js";
import MemorySettingsPage from "./memory.js";
import { AddSkillMenu } from "./resource-settings-page.js";
import SkillsSettingsPage from "./skills.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

function leaf(
  path: string,
  owner: string,
  extra: Partial<TreeNode> = {},
  metadata: Record<string, unknown> | null = null,
): TreeNode {
  return {
    name: path.split("/").pop() ?? path,
    path,
    type: "file",
    resource: {
      id: `${owner}:${path}`,
      path,
      owner,
      mimeType: "text/markdown",
      size: 12,
      createdAt: 0,
      updatedAt: 0,
      createdBy: "user",
      visibility: "workspace",
      threadId: null,
      runId: null,
      expiresAt: null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
    ...extra,
  };
}

const trees: Record<string, TreeNode[]> = {
  personal: [leaf("LEARNINGS.md", "me@example.test")],
  shared: [
    leaf("AGENTS.md", "__shared__"),
    leaf("notes.md", "__shared__"),
    leaf("LEARNINGS.md", "__shared__"),
  ],
  workspace: [
    leaf(
      "AGENTS.md",
      "__workspace__",
      {},
      {
        source: "dispatch-workspace-resource",
      },
    ),
    leaf(
      "skills/release-notes/SKILL.md",
      "__workspace__",
      { kind: "skill", skillMeta: { name: "release-notes" } as never },
      { source: "dispatch-workspace-resource" },
    ),
  ],
};

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const scope = new URL(url, "http://app.test").searchParams.get("scope");
  const body = url.startsWith("/_agent-native/resources/tree")
    ? { tree: trees[scope ?? ""] ?? [] }
    : {};
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

let container: HTMLDivElement;
let root: Root;
let header: SettingsPageHeader | null;

async function renderPage(Page: ComponentType) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  header = null;
  await act(async () => {
    root.render(
      <AgentNativeI18nProvider
        catalog={toolkitI18nCatalog}
        persistPreference={false}
      >
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <SettingsShellProvider
              value={{
                route: { page: "skills", sub: null },
                navigate: () => {},
                setHeader: (next) => {
                  header = next;
                },
              }}
            >
              <Page />
            </SettingsShellProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </AgentNativeI18nProvider>,
    );
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!container.querySelector('[role="status"][aria-busy="true"]')) break;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function group(id: string) {
  const section = container.querySelector<HTMLElement>(
    `[data-resource-group="${id}"]`,
  );
  if (!section) throw new Error(`missing group ${id}`);
  return section;
}

function groupIds() {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-resource-group]"),
  ).map((section) => section.dataset.resourceGroup);
}

beforeEach(() => {
  orgState.value = { orgId: "org-1", orgName: "Acme", role: "member" };
  skillChoices.value = {};
  skillChoices.setSwitch.mockClear();
  skillChoices.setMark.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe("Instructions page", () => {
  it("lists Personal, the organization, and From Dispatch in that order", async () => {
    await renderPage(InstructionsSettingsPage);

    expect(groupIds()).toEqual(["personal", "organization", "from-dispatch"]);
    expect(group("personal").querySelector("h2")?.textContent).toBe("Personal");
    expect(group("organization").querySelector("h2")?.textContent).toBe("Acme");
    expect(group("from-dispatch").querySelector("h2")?.textContent).toBe(
      "From Dispatch",
    );
  });

  it("offers the instructions dialog from the empty personal group", async () => {
    await renderPage(InstructionsSettingsPage);

    const personal = group("personal");
    expect(personal.textContent).toContain(
      "Tell the agent how to work with you.",
    );
    const add = Array.from(personal.querySelectorAll("button")).find(
      (button) => button.textContent === "Add instructions",
    );
    expect(add).toBeTruthy();
    await act(async () => add!.click());

    expect(document.body.textContent).toContain(
      "How should the agent work with you?",
    );
    expect(document.body.textContent).toContain(
      "Saved as AGENTS.md in your personal resources.",
    );
  });

  it("marks the organization and Dispatch groups read only for members", async () => {
    await renderPage(InstructionsSettingsPage);

    expect(
      group("personal").querySelector("header")?.textContent,
    ).not.toContain("Read only");
    expect(
      group("organization").querySelector("header")?.textContent,
    ).toContain("Read only");
    const dispatch = group("from-dispatch");
    expect(dispatch.querySelector("header")?.textContent).toContain(
      "Read only",
    );
    expect(dispatch.textContent).toContain("All apps");
    expect(
      dispatch
        .querySelector<HTMLAnchorElement>("header a")
        ?.getAttribute("href"),
    ).toBe("https://dispatch.example.test/workspace");
  });

  it("lets owners and admins edit the organization group", async () => {
    orgState.value = { orgId: "org-1", orgName: "Acme", role: "admin" };
    await renderPage(InstructionsSettingsPage);

    expect(
      group("organization").querySelector("header")?.textContent,
    ).not.toContain("Read only");
    expect(
      group("from-dispatch").querySelector("header")?.textContent,
    ).toContain("Read only");
  });
});

describe("Memory page", () => {
  it("has a Learnings group across scopes and no From Dispatch group", async () => {
    await renderPage(MemorySettingsPage);

    expect(groupIds()).toEqual(["personal", "organization", "learnings"]);
    expect(group("personal").textContent).toContain(
      "The agent saves what it learns about you here.",
    );
    const learnings = group("learnings");
    expect(learnings.querySelector("h2")?.textContent).toBe("Learnings");
    const rows = learnings.querySelectorAll("[data-resource-row]");
    expect(rows).toHaveLength(2);
    expect(learnings.textContent).toContain("Personal");
    expect(learnings.textContent).toContain("Acme");
  });
});

describe("Skills page", () => {
  it.each(["personal", "shared"] as const)(
    "preserves existing skills when uploading different named SKILL.md files to %s",
    async (scope) => {
      orgState.value.role = "owner";
      const originalTree = trees[scope];
      const stored = new Map<string, string>([
        ["skills/uploaded-skill/SKILL.md", "Existing generic skill"],
        ["skills/create-skill/SKILL.md", "Existing named skill"],
      ]);
      trees[scope] = [...stored.keys()].map((path) =>
        leaf(path, scope === "shared" ? "__shared__" : "me@example.test", {
          kind: "skill",
        }),
      );
      const uploadFetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          if (
            String(input) === "/_agent-native/resources" &&
            init?.method === "POST"
          ) {
            const body = JSON.parse(String(init.body));
            expect(body.shared).toBe(scope === "shared");
            expect(body.uniqueSkillPath).toBe(true);
            let path = body.path;
            for (let suffix = 2; stored.has(path); suffix += 1) {
              path = body.path.replace(/\/SKILL\.md$/, `-${suffix}/SKILL.md`);
            }
            stored.set(path, body.content);
            const node = leaf(
              path,
              scope === "shared" ? "__shared__" : "me@example.test",
              {
                kind: "skill",
              },
            );
            trees[scope].push(node);
            return Response.json({ ...node.resource, content: body.content });
          }
          return fetchMock(input);
        },
      );
      vi.stubGlobal("fetch", uploadFetch);
      try {
        await renderPage(() => (
          <AddSkillMenu scope={scope} placement="empty" onCreated={() => {}} />
        ));
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        for (const name of ["create-skill", "review-feedback"]) {
          const input =
            container.querySelector<HTMLInputElement>('input[type="file"]');
          expect(input).toBeTruthy();
          const file = new File(
            [`---\nname: ${name}\n---\n${name} instructions`],
            "SKILL.md",
            {
              type: "text/markdown",
            },
          );
          Object.defineProperty(input!, "files", {
            configurable: true,
            value: [file],
          });
          await act(async () => {
            input!.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 20));
          });
        }
        expect([...stored.entries()]).toEqual([
          ["skills/uploaded-skill/SKILL.md", "Existing generic skill"],
          ["skills/create-skill/SKILL.md", "Existing named skill"],
          [
            "skills/create-skill-2/SKILL.md",
            "---\nname: create-skill\n---\ncreate-skill instructions",
          ],
          [
            "skills/review-feedback/SKILL.md",
            "---\nname: review-feedback\n---\nreview-feedback instructions",
          ],
        ]);
      } finally {
        trees[scope] = originalTree;
      }
    },
  );

  it("says who each group is for and lists Dispatch skills", async () => {
    await renderPage(SkillsSettingsPage);

    // Each group adds its own skills, so the page header has no Add.
    expect(header?.action).toBeFalsy();
    expect(groupIds()).toEqual(["personal", "organization", "from-dispatch"]);
    expect(group("personal").textContent).toContain("Only you have these.");
    expect(group("personal").textContent).toContain(
      "Save a workflow once and the agent can reuse it.",
    );
    expect(group("organization").textContent).toContain(
      "Shared with everyone at Acme. Your switches are just for you.",
    );
    expect(group("from-dispatch").textContent).toContain(
      "Switching one off here only changes",
    );
    expect(
      group("from-dispatch")
        .querySelector("[data-resource-row]")
        ?.getAttribute("data-resource-row"),
    ).toBe("skills/release-notes/SKILL.md");
    // Every skill file is SKILL.md; the row names the skill instead.
    expect(
      group("from-dispatch").querySelector("[data-resource-row] .font-medium")
        ?.textContent,
    ).toBe("release-notes");
  });

  it("gives admins an organization Add skill action in its empty state", async () => {
    await renderPage(SkillsSettingsPage);
    expect(group("organization").querySelector("button")).toBeNull();

    orgState.value = { orgId: "org-1", orgName: "Acme", role: "owner" };
    await renderPage(SkillsSettingsPage);
    const organization = group("organization");
    expect(organization.textContent).toContain("No shared skills yet");
    // While the group is empty its filling action lives in the empty state.
    expect(organization.querySelector("header button")).toBeNull();
    expect(
      organization.querySelector('[data-slot="empty"] button')?.textContent,
    ).toContain("Add skill");
  });

  it("gives a member a switch on each skill that's just for them", async () => {
    await renderPage(SkillsSettingsPage);
    const dispatch = group("from-dispatch");
    const toggle = dispatch.querySelector<HTMLElement>('[role="switch"]');

    expect(toggle?.getAttribute("aria-label")).toBe("release-notes");
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(dispatch.textContent).toContain("Recommended by Acme");
    // Members don't choose for everyone, and the group explains Dispatch.
    expect(container.textContent).not.toContain("For everyone");
    expect(dispatch.textContent).not.toContain("All apps");

    await act(async () => {
      toggle!.click();
    });
    expect(skillChoices.setSwitch).toHaveBeenCalledWith(
      "workspace",
      "skills/release-notes/SKILL.md",
      false,
    );
  });

  it("shows a Required skill as always on, and says it replaces the person's own", async () => {
    skillChoices.value = {
      choices: {
        switches: {},
        marks: { "workspace:skills/release-notes/SKILL.md": "required" },
      },
    };
    const originalPersonal = trees.personal;
    trees.personal = [
      ...originalPersonal,
      leaf("skills/release-notes/SKILL.md", "me@example.test", {
        kind: "skill",
        skillMeta: { name: "release-notes" } as never,
      }),
    ];
    try {
      await renderPage(SkillsSettingsPage);
      const dispatch = group("from-dispatch");

      expect(dispatch.querySelector('[role="switch"]')).toBeNull();
      expect(dispatch.textContent).toContain("Always on");
      expect(dispatch.textContent).toContain("Required by Acme");
      // Their own copy is kept, and its row says why it isn't used.
      expect(group("personal").textContent).toContain(
        "Not used: Acme requires everyone to use the shared one",
      );
    } finally {
      trees.personal = originalPersonal;
    }
  });

  it("says a Required skill replaces a same-named one of the person's own at another path", async () => {
    skillChoices.value = {
      choices: {
        switches: {},
        marks: { "workspace:skills/release-notes/SKILL.md": "required" },
      },
    };
    const originalPersonal = trees.personal;
    trees.personal = [
      ...originalPersonal,
      leaf("skills/my-release-notes/SKILL.md", "me@example.test", {
        kind: "skill",
        skillMeta: { name: "release-notes" } as never,
      }),
      leaf("skills/brand-voice/SKILL.md", "me@example.test", {
        kind: "skill",
        skillMeta: { name: "brand-voice" } as never,
      }),
    ];
    try {
      await renderPage(SkillsSettingsPage);
      const notes = group("personal").textContent?.split(
        "Not used: Acme requires everyone to use the shared one",
      );
      // Only the same-named skill, not brand-voice.
      expect(notes).toHaveLength(2);
    } finally {
      trees.personal = originalPersonal;
    }
  });

  it("hides switches until the choices load, and says when they can't", async () => {
    skillChoices.value = { isLoaded: false };
    await renderPage(SkillsSettingsPage);
    expect(group("from-dispatch").querySelector('[role="switch"]')).toBeNull();
    expect(container.textContent).not.toContain("Couldn't load which skills");

    skillChoices.value = { isLoaded: false, isError: true };
    await renderPage(SkillsSettingsPage);
    expect(group("from-dispatch").querySelector('[role="switch"]')).toBeNull();
    expect(container.textContent).toContain(
      "Couldn't load which skills are on for you, so the switches are hidden. Reload the page to try again.",
    );
  });

  it("shows an admin how people chose, never who", async () => {
    orgState.value = { orgId: "org-1", orgName: "Acme", role: "owner" };
    skillChoices.value = {
      canMark: true,
      counts: {
        members: 5,
        counts: {
          "workspace:skills/release-notes/SKILL.md": {
            off: 2,
            on: 0,
            ownVersions: 0,
          },
        },
      },
    };
    await renderPage(SkillsSettingsPage);
    const dispatch = group("from-dispatch");

    expect(dispatch.textContent).toContain("For everyone");
    expect(dispatch.textContent).toContain("For you");
    expect(dispatch.textContent).toContain("Off for 2 of 5 people");
    expect(
      dispatch.querySelector('[aria-label="release-notes: For everyone"]')
        ?.textContent,
    ).toContain("Recommended");
    expect(group("organization").textContent).toContain(
      "You're an admin, so you choose how each one starts for people.",
    );
  });

  it("tells an admin which of two same-named skills the agent uses", async () => {
    orgState.value = { orgId: "org-1", orgName: "Acme", role: "owner" };
    const originalShared = trees.shared;
    trees.shared = [
      ...originalShared,
      leaf("skills/our-release-notes/SKILL.md", "__shared__", {
        kind: "skill",
        skillMeta: { name: "release-notes" } as never,
      }),
    ];
    try {
      skillChoices.value = { canMark: true };
      await renderPage(SkillsSettingsPage);
      expect(group("organization").textContent).toContain(
        "Dispatch also has a release-notes. The agent uses this one and skips Dispatch's.",
      );

      // A Required Dispatch skill wins over the organization's.
      skillChoices.value = {
        canMark: true,
        choices: {
          switches: {},
          marks: { "workspace:skills/release-notes/SKILL.md": "required" },
        },
      };
      await renderPage(SkillsSettingsPage);
      expect(group("organization").textContent).toContain(
        "Dispatch's release-notes is Required, so the agent uses it and skips this one.",
      );
    } finally {
      trees.shared = originalShared;
    }
  });

  it("asks before making a skill Required, saying who it changes", async () => {
    const { RequireSkillDialog } =
      await import("../../../resources/SkillChoiceControls.js");
    const state = {
      choices: { switches: {}, marks: {} },
      canMark: true,
      isLoaded: true,
      isError: false,
      counts: {
        members: 5,
        counts: {
          "organization:skills/brand-voice/SKILL.md": {
            off: 2,
            on: 0,
            ownVersions: 1,
          },
        },
      },
      refreshCounts: () => {},
      countsCheck: "done" as const,
      setSwitch: skillChoices.setSwitch,
      setMark: skillChoices.setMark,
    };
    const onOpenChange = vi.fn();
    await renderPage(() => (
      <RequireSkillDialog
        skill={{
          source: "organization",
          path: "skills/brand-voice/SKILL.md",
          name: "brand-voice",
        }}
        context={{
          state,
          orgName: "Acme",
          dispatchNames: new Map(),
          requiredPaths: new Set(),
          requiredNames: new Set(),
          onRequire: () => {},
        }}
        onOpenChange={onOpenChange}
      />
    ));
    const dialog = document.body.querySelector<HTMLElement>(
      '[role="alertdialog"]',
    );

    expect(dialog?.textContent).toContain("Make brand-voice required?");
    expect(dialog?.textContent).toContain(
      "It turns back on for the 2 people who switched it off.",
    );
    expect(dialog?.textContent).toContain(
      "The 1 person with their own version gets Acme's text instead.",
    );
    expect(skillChoices.setMark).not.toHaveBeenCalled();
    // Keyboard users land on Cancel, inside the dialog.
    expect(document.activeElement?.textContent).toBe("Cancel");

    const confirm = Array.from(dialog!.querySelectorAll("button")).find(
      (button) => button.textContent === "Make required",
    );
    await act(async () => {
      confirm!.click();
    });
    expect(skillChoices.setMark).toHaveBeenCalledWith(
      "organization",
      "skills/brand-voice/SKILL.md",
      "required",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each([
    ["checking", "Checking who this changes…", true],
    [
      "failed",
      "Couldn't check who this changes. On for everyone. Nobody can switch it off or use their own version.",
      false,
    ],
  ] as const)(
    "says nothing from old counts while fresh ones are %s",
    async (countsCheck, says, waits) => {
      const { RequireSkillDialog } =
        await import("../../../resources/SkillChoiceControls.js");
      const state = {
        choices: { switches: {}, marks: {} },
        canMark: true,
        isLoaded: true,
        isError: false,
        counts: {
          members: 5,
          counts: {
            "organization:skills/brand-voice/SKILL.md": {
              off: 2,
              on: 0,
              ownVersions: 1,
            },
          },
        },
        refreshCounts: () => {},
        countsCheck,
        setSwitch: skillChoices.setSwitch,
        setMark: skillChoices.setMark,
      };
      await renderPage(() => (
        <RequireSkillDialog
          skill={{
            source: "organization",
            path: "skills/brand-voice/SKILL.md",
            name: "brand-voice",
          }}
          context={{
            state,
            orgName: "Acme",
            dispatchNames: new Map(),
            requiredPaths: new Set(),
            requiredNames: new Set(),
            onRequire: () => {},
          }}
          onOpenChange={() => {}}
        />
      ));
      const dialog = document.body.querySelector<HTMLElement>(
        '[role="alertdialog"]',
      );
      const description = document.getElementById(
        dialog?.getAttribute("aria-describedby") ?? "",
      );
      expect(description?.textContent).toBe(says);
      const confirm = Array.from(dialog!.querySelectorAll("button")).find(
        (button) => button.textContent === "Make required",
      );
      expect(confirm?.disabled).toBe(waits);
    },
  );

  it("says how many people's own versions a Required Dispatch skill replaces", async () => {
    const { RequireSkillDialog } =
      await import("../../../resources/SkillChoiceControls.js");
    const state = {
      choices: { switches: {}, marks: {} },
      canMark: true,
      isLoaded: true,
      isError: false,
      counts: {
        members: 5,
        counts: {
          "workspace:skills/brand-voice/SKILL.md": {
            off: 0,
            on: 0,
            ownVersions: 2,
          },
        },
      },
      refreshCounts: () => {},
      countsCheck: "done" as const,
      setSwitch: skillChoices.setSwitch,
      setMark: skillChoices.setMark,
    };
    await renderPage(() => (
      <RequireSkillDialog
        skill={{
          source: "workspace",
          path: "skills/brand-voice/SKILL.md",
          name: "brand-voice",
        }}
        context={{
          state,
          orgName: "Acme",
          dispatchNames: new Map(),
          requiredPaths: new Set(),
          requiredNames: new Set(),
          onRequire: () => {},
        }}
        onOpenChange={() => {}}
      />
    ));
    const dialog = document.body.querySelector<HTMLElement>(
      '[role="alertdialog"]',
    );
    expect(dialog?.textContent).toContain(
      "The 2 people with their own version get Dispatch's text instead.",
    );
  });

  it("offers Add skill in the empty personal group", async () => {
    await renderPage(SkillsSettingsPage);
    const personal = group("personal");
    expect(personal.textContent).toContain("No skills yet");
    expect(
      personal.querySelector('[data-slot="empty"] button')?.textContent,
    ).toContain("Add skill");
  });
});

describe("Files page", () => {
  it("lists plain files with path and size, and puts Add file in the header", async () => {
    await renderPage(FilesSettingsPage);

    expect(header?.action).toBeTruthy();
    const rows = group("organization").querySelectorAll("[data-resource-row]");
    expect(
      Array.from(rows, (row) => row.getAttribute("data-resource-row")),
    ).toEqual(["notes.md"]);
    expect(rows[0]?.textContent).toContain("notes.md · 12 B");
    expect(group("personal").textContent).toContain(
      "Add a file to give your agent more context.",
    );
    expect(group("from-dispatch").textContent).toContain(
      "Nothing shared from Dispatch",
    );
    expect(
      group("from-dispatch").querySelector('[data-slot="empty"] button'),
    ).toBeNull();
  });
});
