// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { Project } from "@/lib/model/contracts";

import { columnsForViewport, PROJECTS_COLUMN_ORDER } from "./columnDefinitions";
import { ProjectsListView } from "./ProjectsListView";

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@agent-native/toolkit/hooks", () => ({
  useIsMobile: () => viewport.mobile,
}));

const project: Project = {
  id: "prj_phone",
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

function tableWidth(): number {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
          onCreateProject={() => {}}
          fixture="fixture"
          now={Date.parse("2026-11-05T12:00:00.000Z")}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const table = container.querySelector<HTMLTableElement>(".ws-projects-table");
  const width = Number.parseInt(table?.style.width ?? "", 10);
  act(() => root.unmount());
  container.remove();
  return width;
}

it("limits phone columns to the title and its neighbour", () => {
  expect(columnsForViewport(PROJECTS_COLUMN_ORDER, true)).toHaveLength(2);
  expect(columnsForViewport(PROJECTS_COLUMN_ORDER, false)).toEqual([
    ...PROJECTS_COLUMN_ORDER,
  ]);
});

it("renders a phone table that fits a phone instead of 2160px", () => {
  viewport.mobile = false;
  const desktop = tableWidth();
  viewport.mobile = true;
  const phone = tableWidth();
  expect(desktop).toBeGreaterThan(1000);
  expect(phone).toBeLessThanOrEqual(360);
});
