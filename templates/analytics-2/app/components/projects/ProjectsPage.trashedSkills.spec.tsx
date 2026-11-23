// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { resolveRoute } from "@/routes/routing/registry";

const mocks = vi.hoisted(() => ({
  personalRefetch: vi.fn(async () => undefined),
  sharedRefetch: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  actionErrorMessage: () => undefined,
  useActionQuery: () => ({
    data: {
      viewer: { email: "user@example.test", orgId: "workspace" },
      projects: [],
      capabilities: [],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(async () => undefined),
  }),
}));
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: (scope: string) => ({
    data: [],
    isPending: false,
    isError: true,
    refetch: scope === "personal" ? mocks.personalRefetch : mocks.sharedRefetch,
  }),
  useUpdateResource: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/workspace/WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      user: { name: "User", email: "user@example.test" },
      workspace: { id: "workspace" },
      capabilities: [],
      features: { isAdmin: true, canCreateProject: true },
    },
    onCreateProject: vi.fn(),
  }),
}));
vi.mock("./ProjectsListView", () => ({
  parseProjectsSortParam: () => undefined,
  ProjectsListView: ({
    trashedSkills,
  }: {
    trashedSkills?: React.ReactNode;
  }) => <div>{trashedSkills}</div>,
}));

import { ProjectsPage } from "./ProjectsPage";

it("retries failed trashed skills queries from the trash alert", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.personalRefetch.mockClear();
  mocks.sharedRefetch.mockClear();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/home/trash"]}>
          <ProjectsPage route={resolveRoute("/home/trash")} />
        </MemoryRouter>,
      );
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "analytics.lists.trashedSkillsLoadFailed",
    );
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "error.retry",
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
    });
    expect(mocks.personalRefetch).toHaveBeenCalledOnce();
    expect(mocks.sharedRefetch).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
