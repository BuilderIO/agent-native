// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { Project } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";

const project: Project = {
  id: "prj_rename",
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
  onRenameProject?: (id: string, title: string) => Promise<void>,
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
          fixture="fixture"
          now={Date.parse("2026-11-05T12:00:00.000Z")}
          {...(onRenameProject === undefined ? {} : { onRenameProject })}
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

it("renames a project from the row menu with the typed title", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRenameProject = vi.fn(async () => {});
  const { container, root } = render(onRenameProject);
  try {
    await openMenu(container);
    const rename = menuItem("Rename");
    if (!rename) throw Error("Rename menu item missing");
    await act(async () => rename.click());

    const input = document.querySelector<HTMLInputElement>(
      '[role="dialog"] input',
    );
    if (!input) throw Error("Rename title input missing");
    expect(input.value).toBe("Revenue");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Quarterly revenue");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.trim() === "Rename");
    if (!save) throw Error("Rename confirm button missing");
    await act(async () => save.click());

    expect(onRenameProject).toHaveBeenCalledWith(
      "prj_rename",
      "Quarterly revenue",
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("keeps the dialog open and shows the failure when the rename is rejected", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onRenameProject = vi.fn(async () => {
    throw new Error("Only the owner can rename this project.");
  });
  const { container, root } = render(onRenameProject);
  try {
    await openMenu(container);
    await act(async () => menuItem("Rename")?.click());
    const input = document.querySelector<HTMLInputElement>(
      '[role="dialog"] input',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Other");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.trim() === "Rename");
    await act(async () => save?.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Only the owner can rename this project.",
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("omits Rename when the caller cannot back the write", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { container, root } = render();
  try {
    await openMenu(container);
    expect(menuItem("Copy link")).toBeDefined();
    expect(menuItem("Rename")).toBeUndefined();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
