// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { Project } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";

const project: Project = {
  id: "prj_duplicate",
  ownerEmail: "qa@workspace.test",
  title: "Revenue",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
};

function render(
  onDuplicateProject?: (projectId: string) => Promise<void>,
  onCreateProject?: () => void,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <ProjectsListView
          status="ready"
          projects={[project]}
          currentUser={{ name: "QA", email: "qa@workspace.test" }}
          search=""
          onSearchChange={() => {}}
          onCreateProject={onCreateProject}
          fixture="fixture"
          now={Date.parse("2026-11-05T12:00:00.000Z")}
          {...(onDuplicateProject === undefined ? {} : { onDuplicateProject })}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  return { container, root };
}

function menuItem(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === label,
  );
}

async function openMenu(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="View more actions"]',
  );
  if (!trigger) throw Error("Row actions trigger missing");
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
}

it("duplicates a project from the row menu and closes the menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onDuplicateProject = vi.fn(async () => {});
  const { container, root } = render(onDuplicateProject, vi.fn());
  try {
    await openMenu(container);
    const duplicate = menuItem("Duplicate");
    if (!duplicate) throw Error("Duplicate menu item missing");
    await act(async () => duplicate.click());
    expect(onDuplicateProject).toHaveBeenCalledWith("prj_duplicate");
    expect(menuItem("Duplicate")).toBeUndefined();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("omits creation and duplication when the workspace cannot create projects", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { container, root } = render();
  try {
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "New project",
      ),
    ).toBeUndefined();
    await openMenu(container);
    expect(menuItem("Duplicate")).toBeUndefined();
    expect(menuItem("Copy link")).toBeDefined();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
