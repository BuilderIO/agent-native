// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { expect, it, vi } from "vitest";

import { resolveRoute } from "@/routes/routing/registry";

import { ANALYTICS_CONTROL_IDS } from "../../../shared/analytics-control-ids";
const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  invalidate: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  actionErrorMessage: (error: { actionMessage?: string }) =>
    error.actionMessage,
  useActionQuery: () => ({
    data: {
      viewer: { email: "user@example.test", orgId: "workspace" },
      projects: [],
      capabilities: [],
    },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [], isPending: false, isError: false }),
  useUpdateResource: () => ({ mutateAsync: async () => undefined }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@/components/workspace/WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      user: { name: "User", email: "user@example.test" },
      workspace: { id: "workspace" },
      capabilities: [
        { controlId: ANALYTICS_CONTROL_IDS.createProject, status: "allowed" },
      ],
      features: { canCreateProject: true },
    },
    onCreateProject: vi.fn(),
  }),
}));
vi.mock("./ProjectsListView", () => ({
  parseProjectsSortParam: () => undefined,
  ProjectsListView: ({
    onDuplicateProject,
  }: {
    onDuplicateProject: (id: string) => Promise<void>;
  }) => (
    <button onClick={() => void onDuplicateProject("source-1")}>
      Duplicate
    </button>
  ),
}));
import { ProjectsPage } from "./ProjectsPage";

function CurrentPath() {
  return <output>{useLocation().pathname}</output>;
}

it.each([
  { name: "opens the created copy in the existing router", rejected: false },
  {
    name: "shows a duplicate rejection and stays on the project list",
    rejected: true,
  },
])("$name", async ({ rejected }) => {
  const denial = "Requires analytics-2 permission create-project";
  if (rejected) mocks.callAction.mockRejectedValue({ actionMessage: denial });
  else mocks.callAction.mockResolvedValue({ project: { id: "copy-1" } });
  mocks.toastError.mockClear();
  mocks.invalidate.mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/home/all"]}>
          <ProjectsPage route={resolveRoute("/home/all")} />
          <CurrentPath />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      container.querySelector("button")?.click();
    });
    await vi.waitFor(() =>
      expect(container.querySelector("output")?.textContent).toBe(
        rejected ? "/home/all" : "/project/copy-1/latest",
      ),
    );
    if (rejected) expect(mocks.toastError).toHaveBeenCalledWith(denial);
    else expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.callAction).toHaveBeenCalledWith("duplicate-project", {
      projectId: "source-1",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
