// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orgState = vi.hoisted(() => ({
  value: { orgId: "org-1", orgName: "Acme", role: "member" as string },
}));

vi.mock("../../../chat/index.js", () => ({ PromptComposer: () => null }));
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

  it("puts Add skill in the page header and lists Dispatch skills", async () => {
    await renderPage(SkillsSettingsPage);

    expect(header?.action).toBeTruthy();
    expect(groupIds()).toEqual(["personal", "organization", "from-dispatch"]);
    expect(group("personal").textContent).toContain(
      "Save a workflow once and the agent can reuse it.",
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
