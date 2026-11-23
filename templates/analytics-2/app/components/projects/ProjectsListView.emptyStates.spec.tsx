// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ProjectsListView } from "./ProjectsListView";

function render(listView: "active" | "archive" | "trash") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ProjectsListView
        status="ready"
        projects={[]}
        currentUser={{ name: "QA", email: "qa@workspace.test" }}
        search=""
        onSearchChange={() => {}}
        onCreateProject={() => {}}
        listView={listView}
        fixture="fixture"
        now={Date.parse("2026-11-09T12:00:00.000Z")}
      />,
    ),
  );
  return { container, root };
}

it("names the active, archive and trash empty states the way the source does", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const seen: Record<string, string> = {};
  for (const view of ["active", "archive", "trash"] as const) {
    const { container, root } = render(view);
    seen[view] =
      container.querySelector(".ws-projects-state-title")?.textContent ?? "";
    act(() => root.unmount());
    container.remove();
  }
  expect(seen.active).toBe("No projects yet");
  expect(seen.archive).toBe("No archived projects");
  expect(seen.trash).toBe("No projects or components in trash");
});

it("titles each list view the way its tab is named", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const titles: Record<string, string> = {};
  for (const view of ["active", "archive", "trash"] as const) {
    const { container, root } = render(view);
    titles[view] =
      container.querySelector(".ws-projects-title")?.textContent ?? "";
    act(() => root.unmount());
    container.remove();
  }
  expect(titles).toEqual({
    active: "Projects",
    archive: "Archive",
    trash: "Trash",
  });
});

it("report 209 hides the trash empty state when trashed skills are present", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ProjectsListView
        status="ready"
        projects={[]}
        hasTrashedSkills
        trashedSkills={<section>Deleted skill</section>}
        currentUser={{ name: "QA", email: "qa@workspace.test" }}
        search=""
        onSearchChange={() => {}}
        onCreateProject={() => {}}
        listView="trash"
        fixture="fixture"
        now={Date.parse("2026-11-09T12:00:00.000Z")}
      />,
    ),
  );
  expect(container.querySelector(".ws-projects-state-title")).toBeNull();
  expect(container.textContent).toContain("Deleted skill");
  act(() => root.unmount());
  container.remove();
});
