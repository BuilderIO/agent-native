// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { Project } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";
import { TrashedSkills } from "./ProjectsPage";

const project: Project = {
  id: "prj_trashed",
  ownerEmail: "qa@workspace.test",
  title: "Old revenue",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: "2026-11-08T00:00:00.000Z",
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
};

function render(
  handlers: {
    onRestoreProject?: (projectId: string) => Promise<void>;
    onDeleteProject?: (projectId: string) => Promise<void>;
    onArchiveProject?: (projectId: string) => Promise<void>;
    onUnarchiveProject?: (projectId: string) => Promise<void>;
    onToggleFavorite?: (projectId: string, favorited: boolean) => Promise<void>;
  } = {},
  listView: "active" | "archive" | "trash" = "trash",
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ProjectsListView
        status="ready"
        projects={[project]}
        currentUser={{ name: "QA", email: "qa@workspace.test" }}
        search=""
        onSearchChange={() => {}}
        onCreateProject={() => {}}
        listView={listView}
        fixture="fixture"
        now={Date.parse("2026-11-08T12:00:00.000Z")}
        {...handlers}
      />,
    ),
  );
  return { container, root };
}

function menuItem(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === label,
  );
}

it("lists a removed personal skill and restores it from Trash", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const skill = {
    id: "skill-1",
    path: "trash/skills/skill-1/skills/review/SKILL.md",
    updatedAt: 123,
  };
  let resources = [skill];
  let scope = "original-workspace";
  const fetchTrash = vi.fn(async (request: string, init?: RequestInit) => {
    const url = new URL(request, "https://analytics.example.test");
    if (init?.method === "PUT") {
      expect(url.pathname).toBe("/_agent-native/resources/skill-1");
      expect(JSON.parse(String(init.body))).toEqual({ restoreSkill: true });
      resources = [];
      return Response.json(skill);
    }
    expect(url.searchParams.get("scope")).toBe("personal");
    expect(url.searchParams.get("prefix")).toBe("trash/skills/");
    return Response.json({
      resources: scope === "original-workspace" ? resources : [],
    });
  });
  vi.stubGlobal("fetch", fetchTrash);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const restoreButton = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="Restore review"]',
    );
  const showTrash = () =>
    act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <QueryClientProvider client={client}>
            <ProjectsListView
              status="ready"
              projects={[]}
              trashedSkills={
                <TrashedSkills
                  canManageOrganization={false}
                  cacheScope={scope}
                />
              }
              currentUser={{ name: "QA", email: "qa@workspace.test" }}
              search=""
              onSearchChange={() => {}}
              listView="trash"
            />
          </QueryClientProvider>
        </AgentNativeI18nProvider>,
      );
    });
  try {
    await showTrash();
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(restoreButton(), container.textContent ?? "").not.toBeNull();
    });
    scope = "other-workspace";
    await showTrash();
    expect(restoreButton()).toBeNull();
    scope = "original-workspace";
    await showTrash();
    expect(restoreButton()).not.toBeNull();
    await act(async () => restoreButton()?.click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(restoreButton()).toBeNull();
    });
    expect(resources).toEqual([]);
  } finally {
    act(() => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});

async function openMenu(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="View more actions"]',
  );
  if (!trigger) throw Error("Row actions trigger missing");
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
}

it("archives from a menu outside the clipped projects table after confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onArchiveProject = vi.fn(async () => {});
  const { container, root } = render({ onArchiveProject }, "active");
  try {
    await openMenu(container);
    expect(menuItem("Move to trash")).toBeDefined();
    const archive = menuItem("Archive");
    if (!archive) throw Error("Archive menu item missing");
    expect(archive.closest("table")).toBeNull();
    await act(async () => archive.click());
    const dialog = container.querySelector('[role="dialog"]');
    if (!dialog) throw Error("Archive confirmation dialog missing");
    expect(dialog.textContent).toContain("Confirm move to archive");
    expect(dialog.textContent).toContain(
      "Are you sure you want to move 1 project to archive?",
    );
    expect(onArchiveProject).not.toHaveBeenCalled();
    const confirm = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Move to archive",
    );
    if (!confirm) throw Error("Archive confirm button missing");
    await act(async () => confirm.click());
    expect(onArchiveProject).toHaveBeenCalledWith("prj_trashed");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("offers Unarchive on an archived row with no confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onUnarchiveProject = vi.fn(async () => {});
  const { container, root } = render({ onUnarchiveProject }, "archive");
  try {
    await openMenu(container);
    const unarchive = menuItem("Unarchive");
    if (!unarchive) throw Error("Unarchive menu item missing");
    expect(menuItem("Archive")).toBeUndefined();
    await act(async () => unarchive.click());
    expect(onUnarchiveProject).toHaveBeenCalledWith("prj_trashed");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("offers Restore and Permanently delete on a trash row", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRestoreProject = vi.fn(async () => {});
  const { container, root } = render({ onRestoreProject });
  try {
    await openMenu(container);
    expect(menuItem("Move to trash")).toBeUndefined();
    const restore = menuItem("Restore");
    if (!restore) throw Error("Restore menu item missing");
    expect(menuItem("Permanently delete")).toBeDefined();
    await act(async () => restore.click());
    expect(onRestoreProject).toHaveBeenCalledWith("prj_trashed");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("confirms permanent deletion with the source copy before calling the write", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onDeleteProject = vi.fn(async () => {});
  const { container, root } = render({ onDeleteProject });
  try {
    await openMenu(container);
    const remove = menuItem("Permanently delete");
    if (!remove) throw Error("Permanently delete menu item missing");
    await act(async () => remove.click());
    const dialog = container.querySelector('[role="dialog"]');
    if (!dialog) throw Error("Confirmation dialog missing");
    expect(dialog.textContent).toContain("Confirm permanent deletion");
    expect(dialog.textContent).toContain(
      "Are you sure you want to permanently delete 1 project? This action cannot be undone.",
    );
    expect(onDeleteProject).not.toHaveBeenCalled();
    const confirm = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Permanently delete",
    );
    if (!confirm) throw Error("Confirm button missing");
    await act(async () => confirm.click());
    expect(onDeleteProject).toHaveBeenCalledWith("prj_trashed");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("adds a project to favorites from the row menu and shows the star", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onToggleFavorite = vi.fn(async () => {});
  const { container, root } = render({ onToggleFavorite }, "active");
  try {
    await openMenu(container);
    const add = menuItem("Add to favorites");
    if (!add) throw Error("Add to favorites menu item missing");
    expect(menuItem("Remove from favorites")).toBeUndefined();
    await act(async () => add.click());
    expect(onToggleFavorite).toHaveBeenCalledWith("prj_trashed", true);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("offers Remove from favorites and a star mark on a favorited project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <ProjectsListView
          status="ready"
          projects={[{ ...project, favorited: true }]}
          currentUser={{ name: "QA", email: "qa@workspace.test" }}
          search=""
          onSearchChange={() => {}}
          onCreateProject={() => {}}
          onToggleFavorite={async () => {}}
          fixture="fixture"
          now={Date.parse("2026-11-08T12:00:00.000Z")}
        />,
      ),
    );
    expect(
      container.querySelector(
        'button[aria-pressed="true"] svg.tabler-icon-star-filled',
      ),
    ).not.toBeNull();
    expect(
      container
        .querySelector('button.ws-projects-row-favorite[aria-pressed="true"]')
        ?.getAttribute("aria-label"),
    ).toBe("Remove from favorites");
    await openMenu(container);
    expect(menuItem("Remove from favorites")).toBeDefined();
    expect(menuItem("Add to favorites")).toBeUndefined();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
