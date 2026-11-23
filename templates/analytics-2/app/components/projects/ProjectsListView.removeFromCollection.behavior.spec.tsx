// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { i18nCatalog } from "@/i18n";
import type { ProjectListRow } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";

const project: ProjectListRow = {
  id: "prj_1",
  ownerEmail: "qa@workspace.test",
  creatorEmail: "qa@workspace.test",
  title: "Revenue",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  lastPublishedAt: null,
  appViews: null,
  appLastViewedAt: null,
  yourAccess: "owner",
  sharedWith: { workspace: false, directCount: 0 },
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
};

describe("collection page remove-from-collection", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    toast.success.mockReset();
    toast.error.mockReset();
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  async function openConfirm(onRemove: () => Promise<void>) {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <ProjectsListView
            status="ready"
            projects={[project]}
            currentUser={{ name: "QA", email: "qa@workspace.test" }}
            search=""
            onSearchChange={() => undefined}
            onCreateProject={() => undefined}
            onRemoveFromCollection={onRemove}
          />
        </AgentNativeI18nProvider>,
      );
    });
    const trigger = host.querySelector<HTMLElement>(
      '[aria-label="View more actions"]',
    );
    if (!trigger) throw new Error("row actions trigger did not render");
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      trigger.click();
    });
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (node) => node.textContent?.includes("Remove from collection"),
    );
    if (!item) throw new Error("Remove from collection item did not render");
    await act(async () => {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  const confirmButton = () =>
    [...document.querySelectorAll("button")].find(
      (node) => node.textContent === "Remove from Collection",
    ) as HTMLButtonElement;

  it("asks before removing, then removes once and reports success", async () => {
    const onRemove = vi.fn(async () => undefined);
    await openConfirm(onRemove);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Confirm remove from Collection");
    expect(dialog?.textContent).toContain(
      "Are you sure you want to remove 1 project from the collection?",
    );
    expect(onRemove).not.toHaveBeenCalled();
    await act(async () => {
      confirmButton().click();
      confirmButton()?.click();
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("prj_1");
    expect(toast.success).toHaveBeenCalledWith(
      "Project removed from collection",
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog open and reports a failed removal", async () => {
    await openConfirm(async () => {
      throw new Error("offline");
    });
    await act(async () => confirmButton().click());
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to remove project from collection",
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe("collection page bulk remove-from-collection", () => {
  let host: HTMLDivElement;
  let root: Root;
  const second: ProjectListRow = { ...project, id: "prj_2", title: "Costs" };

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    toast.success.mockReset();
    toast.error.mockReset();
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  async function renderList(
    onRemove: ((projectId: string) => Promise<void>) | undefined,
  ) {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <ProjectsListView
            status="ready"
            projects={[project, second]}
            currentUser={{ name: "QA", email: "qa@workspace.test" }}
            search=""
            onSearchChange={() => undefined}
            onCreateProject={() => undefined}
            embedded
            {...(onRemove ? { onRemoveFromCollection: onRemove } : {})}
          />
        </AgentNativeI18nProvider>,
      );
    });
  }

  const toolbarButton = () =>
    [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".ws-projects-selection-bar button",
      ),
    ].find((node) => node.textContent === "Remove from collection");

  async function selectAll() {
    const all = host.querySelector<HTMLElement>(
      '[role="checkbox"][aria-label="Select all loaded rows"]',
    );
    if (!all) throw new Error("select-all checkbox did not render");
    await act(async () => all.click());
  }

  const confirmButton = () =>
    [...document.querySelectorAll("button")].find(
      (node) => node.textContent === "Remove from Collection",
    ) as HTMLButtonElement;

  it("removes every selected project after one confirmation", async () => {
    const onRemove = vi.fn(async (_projectId: string) => undefined);
    await renderList(onRemove);
    expect(toolbarButton()).toBeUndefined();
    await selectAll();
    expect(toolbarButton()).toBeDefined();
    await act(async () => toolbarButton()?.click());
    expect(onRemove).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Are you sure you want to remove 2 projects from the collection?",
    );
    await act(async () => confirmButton().click());
    expect(onRemove.mock.calls.map((call) => call[0]).sort()).toEqual([
      "prj_1",
      "prj_2",
    ]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      "Projects removed from collection",
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the failed project selected and reports a partial removal", async () => {
    const onRemove = vi.fn(async (id: string) => {
      if (id === "prj_2") throw new Error("offline");
    });
    await renderList(onRemove);
    await selectAll();
    await act(async () => toolbarButton()?.click());
    await act(async () => confirmButton().click());
    expect(toast.error).toHaveBeenCalledWith(
      "1 projects removed from collection; 1 failed",
    );
    expect(
      host.querySelector(".ws-projects-selection-bar")?.textContent,
    ).toContain("1");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("offers no bulk remove when the page cannot remove", async () => {
    await renderList(undefined);
    await selectAll();
    expect(toolbarButton()).toBeUndefined();
  });
});
