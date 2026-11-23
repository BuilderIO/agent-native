// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { Project } from "@/lib/model/contracts";

import { ProjectsListView } from "./ProjectsListView";

const actions = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: () => undefined,
  callAction: actions.call,
  useActionQuery: () => ({
    data: { statuses: [{ id: "sts_done", name: "Completed" }] },
    isPending: false,
  }),
}));

const project: Project = {
  id: "prj_1",
  ownerEmail: "qa@workspace.test",
  title: "Revenue",
  description: "",
  language: "python",
  statusId: "sts_done",
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
};

function render(over: Partial<Project> = {}): string {
  return renderToStaticMarkup(
    <ProjectsListView
      status="ready"
      projects={[{ ...project, ...over }]}
      currentUser={{ name: "QA", email: "qa@workspace.test" }}
      search=""
      onSearchChange={() => {}}
      onCreateProject={() => {}}
      fixture="fixture"
      now={Date.parse("2026-11-05T12:00:00.000Z")}
      filterOptions={{
        statuses: [{ id: "sts_done", name: "Completed" }],
        categories: [],
      }}
    />,
  );
}

describe("Projects status column", () => {
  it("renders the catalogue name for a project's status", () => {
    const html = render();
    expect(html).toContain("Completed");
    expect(html).not.toContain("Status names are not exposed");
  });

  it("keeps the empty marker when a project has no status", () => {
    const html = render({ statusId: null });
    expect(html).not.toContain("Completed");
  });
});

it("favorites a project and saves a status straight from its table row", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  const onToggleFavorite = vi.fn(async () => {});
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <ProjectsListView
              status="ready"
              projects={[{ ...project, statusId: null }]}
              currentUser={{ name: "QA", email: project.ownerEmail }}
              search=""
              onSearchChange={() => {}}
              onToggleFavorite={onToggleFavorite}
            />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });
    const favorite = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add to favorites"]',
    );
    expect(favorite).not.toBeNull();
    await act(async () => favorite?.click());
    expect(onToggleFavorite).toHaveBeenCalledWith(project.id, true);

    const addStatus = [
      ...container.querySelectorAll<HTMLButtonElement>("td button"),
    ].find((button) => button.textContent?.trim() === "Add status");
    expect(addStatus).toBeDefined();
    await act(async () => addStatus?.click());
    const select = container.querySelector<HTMLSelectElement>(
      '[role="dialog"] select',
    );
    expect(select).not.toBeNull();
    await act(async () => {
      if (!select) throw Error("Status picker is missing");
      select.value = "sts_done";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"] button',
      ),
    ].find((button) => button.textContent?.trim() === "Save");
    expect(save).toBeDefined();
    await act(async () => save?.click());
    expect(actions.call).toHaveBeenCalledWith("update-project", {
      projectId: project.id,
      statusId: "sts_done",
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    vi.unstubAllGlobals();
  }
});
