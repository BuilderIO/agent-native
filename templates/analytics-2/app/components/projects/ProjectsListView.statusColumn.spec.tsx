// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { Project } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";

vi.mock("./ProjectStatusDialog", () => ({
  ProjectStatusDialog: () => <div role="dialog">Set status</div>,
}));

function project(id: string, statusId: string | null): Project {
  return {
    id,
    ownerEmail: "qa@workspace.test",
    title: id,
    description: "",
    language: "python",
    statusId,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
  };
}

it("offers Add status for every row without a resolvable status", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <ProjectsListView
          status="ready"
          projects={[
            project("prj_none", null),
            project("prj_gone", "sts_deleted"),
          ]}
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
  try {
    const addStatus = (id: string) =>
      container.querySelector<HTMLButtonElement>(
        `tr[data-project-id="${id}"] button.ws-projects-add-status`,
      );
    expect(addStatus("prj_none")).not.toBeNull();
    const dangling = addStatus("prj_gone");
    expect(dangling).not.toBeNull();
    await act(async () => dangling?.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("report-1795105051 opens the status dialog from a row that already has a status", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <ProjectsListView
          status="ready"
          projects={[project("prj_set", "sts_live")]}
          filterOptions={{
            statuses: [{ id: "sts_live", name: "Live" }],
            categories: [],
          }}
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
  try {
    const chip = container.querySelector<HTMLButtonElement>(
      'tr[data-project-id="prj_set"] button.ws-projects-status-chip',
    );
    expect(chip?.textContent).toBe("Live");
    await act(async () => chip?.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
