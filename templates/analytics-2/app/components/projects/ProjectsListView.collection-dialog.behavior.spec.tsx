// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("projects list add-to-collection dialog", () => {
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

  it("names the project being added and the collections to pick from", async () => {
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
            collections={[{ id: "col_1", name: "Finance" }]}
            onToggleProjectCollection={async () => undefined}
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
      (node) => node.textContent?.includes("Add to collection"),
    );
    if (!item) throw new Error("Add to collection menu item did not render");
    await act(async () => {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Add project to collections");
    expect(dialog?.textContent).toContain("Adding: Revenue");
    expect(dialog?.textContent).toContain("To the following collection(s):");
    expect(dialog?.textContent).not.toContain("You are moving");
  });

  it("offers Move to... in the row menu and opens the collection picker dialog", async () => {
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
            collections={[{ id: "col_1", name: "Finance" }]}
            onToggleProjectCollection={async () => undefined}
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
      (node) => node.textContent?.includes("Move to..."),
    );
    expect(item).toBeTruthy();
    await act(async () => {
      item!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Add project to collections");
  });

  it("shows loading and error-retry states in the collection picker instead of an empty list", async () => {
    const onRetryCollections = vi.fn();
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
            collections={[]}
            collectionsLoading={true}
            collectionsLoadError={false}
            onRetryCollections={onRetryCollections}
            onToggleProjectCollection={async () => undefined}
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
      (node) => node.textContent?.includes("Add to collection"),
    );
    if (!item) throw new Error("Add to collection menu item did not render");
    await act(async () => {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(
      dialog?.querySelector('[role="status"][aria-busy="true"]'),
    ).not.toBeNull();
    expect(dialog?.textContent).not.toContain("No collections");

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
            collections={[]}
            collectionsLoading={false}
            collectionsLoadError={true}
            onRetryCollections={onRetryCollections}
            onToggleProjectCollection={async () => undefined}
          />
        </AgentNativeI18nProvider>,
      );
    });
    const retry = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(dialog?.querySelector('[role="alert"]')).not.toBeNull();
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(onRetryCollections).toHaveBeenCalledOnce();
  });
});
