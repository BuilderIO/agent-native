// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { Project } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";

const user = { name: "Sam Reader", email: "reader@example.test" };

function project(id: string, title: string): Project {
  return {
    id,
    ownerEmail: user.email,
    title,
    description: "",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
  };
}

const projects = [project("p1", "Revenue"), project("p2", "Churn")];

describe("project list row selection", () => {
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

  const render = (
    view: "active" | "archive" | "trash",
    handlers: Record<string, (id: string) => Promise<void>> = {},
  ) =>
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <ProjectsListView
            status="ready"
            projects={projects}
            currentUser={user}
            search=""
            onSearchChange={() => undefined}
            listView={view}
            {...handlers}
          />
        </AgentNativeI18nProvider>,
      );
    });

  const box = (label: string) =>
    host.querySelector<HTMLElement>(`[role="checkbox"][aria-label="${label}"]`);
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find(
      (b) =>
        b.getAttribute("aria-label") === label ||
        b.textContent?.trim() === label,
    );

  it.each(["active", "archive", "trash"] as const)(
    "%s rows have a checkbox column and a selection bar",
    (view) => {
      render(view);
      expect(box("Select all loaded rows")).not.toBeNull();
      expect(host.textContent).not.toContain("loaded rows selected");
      act(() => box("Select Revenue")?.click());
      expect(host.textContent).toContain("1 loaded rows selected");
      act(() => box("Select all loaded rows")?.click());
      expect(host.textContent).toContain("2 loaded rows selected");
      act(() => button("Deselect all")?.click());
      expect(host.textContent).not.toContain("loaded rows selected");
    },
  );

  it("trash bar restores every selected project", async () => {
    const onRestoreProject = vi.fn(async () => undefined);
    render("trash", { onRestoreProject });
    act(() => box("Select all loaded rows")?.click());
    await act(async () => button("Restore")?.click());
    expect(onRestoreProject.mock.calls.map((c) => (c as unknown[])[0])).toEqual(
      ["p1", "p2"],
    );
  });

  it("archive bar unarchives the selected project", async () => {
    const onUnarchiveProject = vi.fn(async () => undefined);
    render("archive", { onUnarchiveProject });
    act(() => box("Select Churn")?.click());
    await act(async () => button("Unarchive")?.click());
    expect(
      onUnarchiveProject.mock.calls.map((c) => (c as unknown[])[0]),
    ).toEqual(["p2"]);
  });
});
