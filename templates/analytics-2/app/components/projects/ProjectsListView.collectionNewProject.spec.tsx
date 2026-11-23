// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { ProjectsListView } from "./ProjectsListView";

describe("empty collection add menu", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  async function renderEmpty(props: {
    onAddToCollection?: () => void;
    onNewProjectInCollection?: () => void;
  }) {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <ProjectsListView
            status="ready"
            projects={[]}
            currentUser={{ name: "QA", email: "qa@workspace.test" }}
            search=""
            onSearchChange={() => undefined}
            embedded
            {...props}
          />
        </AgentNativeI18nProvider>,
      );
    });
  }

  const addButton = () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Add to collection",
    );

  async function open(trigger: HTMLElement) {
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      trigger.click();
    });
  }

  const menuItem = (label: string) =>
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (node) => node.textContent === label,
    ) as HTMLElement | undefined;

  it("offers New project and Existing project from Add to collection", async () => {
    const onNew = vi.fn();
    const onExisting = vi.fn();
    await renderEmpty({
      onAddToCollection: onExisting,
      onNewProjectInCollection: onNew,
    });
    const trigger = addButton();
    if (!trigger) throw new Error("Add to collection did not render");
    await open(trigger);
    expect(menuItem("New project")).toBeDefined();
    expect(menuItem("Existing project")).toBeDefined();
    await act(async () => {
      menuItem("New project")?.click();
    });
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onExisting).not.toHaveBeenCalled();
  });

  it("opens the existing-project picker from the menu", async () => {
    const onExisting = vi.fn();
    await renderEmpty({
      onAddToCollection: onExisting,
      onNewProjectInCollection: () => undefined,
    });
    const trigger = addButton();
    if (!trigger) throw new Error("Add to collection did not render");
    await open(trigger);
    await act(async () => {
      menuItem("Existing project")?.click();
    });
    expect(onExisting).toHaveBeenCalledTimes(1);
  });

  it("keeps the plain button when the caller cannot create projects", async () => {
    const onExisting = vi.fn();
    await renderEmpty({ onAddToCollection: onExisting });
    await act(async () => addButton()?.click());
    expect(onExisting).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
