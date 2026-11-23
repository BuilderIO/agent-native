import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { resolveRoute } from "@/routes/routing/registry";

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  useActionQuery: (name: string) => ({
    data:
      name === "list-projects"
        ? {
            viewer: { email: "analyst@example.test", orgId: "org-1" },
            capabilities: [],
            projects: [
              {
                id: "project-1",
                yourAccess: "owner",
                title: "Ready project",
                ownerEmail: "analyst@example.test",
                description: "",
                language: "python",
                statusId: null,
                favorited: false,
                trashedAt: null,
                archivedAt: null,
                lastOpenedAt: null,
                createdAt: "2026-01-01",
                updatedAt: "2026-01-01",
              },
            ],
          }
        : name === "list-library-apps"
          ? { apps: [{ id: "app-1", title: "Ready app" }], nextCursor: null }
          : {},
    isPending: false,
    isError: false,
    isFetching: false,
  }),
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
import { ProjectsPage } from "../projects/ProjectsPage";
import { LibraryPage } from "./LibraryPage";
import { WorkspaceDataContext } from "./WorkspaceDataContext";

it("report A2-WORKSPACE-IDENTITY-GATING: renders ready lists while workspace activity and setup are pending", () => {
  const queryClient = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkspaceDataContext.Provider
          value={{
            shell: {
              user: {
                id: "u1",
                name: "Analyst",
                email: "analyst@example.test",
              },
              workspace: { id: "org-1", name: "Workspace" },
              capabilities: [],
              features: {
                contextStudio: true,
                isManagerOrAbove: true,
                isAdmin: true,
                canExplore: true,
                threads: true,
                tasks: true,
                folders: false,
                developerTools: false,
                canCreateProject: true,
                canCreateThread: true,
              },
            },
            activity: undefined,
            activityStatus: "loading",
            contextSetup: undefined,
            contextSetupPending: true,
            onCreateProject: () => {},
            quickCreateProject: async () => {},
            onCreateThread: () => {},
          }}
        >
          <ProjectsPage route={resolveRoute("/home/all")} />
          <LibraryPage />
        </WorkspaceDataContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(html).toContain("Ready project");
  expect(html).toContain("Ready app");
});
