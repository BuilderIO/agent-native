// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveRoute } from "@/routes/routing/registry";

const state = vi.hoisted(() => ({
  collectionsPending: false,
  collectionsError: false,
  projectCollectionsPending: false,
  projectCollectionsError: false,
  refetchCollections: vi.fn(async () => undefined),
  refetchProjectCollections: vi.fn(async () => undefined),
  capturedProps: undefined as
    | {
        collectionsLoading?: boolean;
        collectionsLoadError?: boolean;
        onRetryCollections?: () => void;
      }
    | undefined,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  actionErrorMessage: () => undefined,
  useActionQuery: (name: string) => {
    if (name === "list-collections") {
      return {
        data:
          state.collectionsPending || state.collectionsError
            ? undefined
            : { collections: [] },
        isPending: state.collectionsPending,
        isError: state.collectionsError,
        refetch: state.refetchCollections,
      };
    }
    if (name === "list-project-collections") {
      return {
        data:
          state.projectCollectionsPending || state.projectCollectionsError
            ? undefined
            : { assignments: [] },
        isPending: state.projectCollectionsPending,
        isError: state.projectCollectionsError,
        refetch: state.refetchProjectCollections,
      };
    }
    return {
      data: {
        viewer: { email: "user@example.test", orgId: "workspace" },
        projects: [],
        capabilities: [],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(async () => undefined),
    };
  },
}));
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({
    data: [],
    isPending: false,
    isError: false,
    refetch: vi.fn(async () => undefined),
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
  ProjectsListView: (props: {
    collectionsLoading?: boolean;
    collectionsLoadError?: boolean;
    onRetryCollections?: () => void;
  }) => {
    state.capturedProps = props;
    return <div />;
  },
}));

import { ProjectsPage } from "./ProjectsPage";

describe("ProjectsPage collection picker load state wiring", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.collectionsPending = false;
    state.collectionsError = false;
    state.projectCollectionsPending = false;
    state.projectCollectionsError = false;
    state.refetchCollections.mockClear();
    state.refetchProjectCollections.mockClear();
    state.capturedProps = undefined;
  });

  it("forwards pending, error, and retry callbacks for collection queries", async () => {
    state.projectCollectionsPending = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={["/home/projects"]}>
            <ProjectsPage route={resolveRoute("/home/projects")} />
          </MemoryRouter>,
        );
      });
      expect(state.capturedProps?.collectionsLoading).toBe(true);
      expect(state.capturedProps?.collectionsLoadError).toBe(false);

      state.projectCollectionsPending = false;
      state.collectionsError = true;
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={["/home/projects"]}>
            <ProjectsPage route={resolveRoute("/home/projects")} />
          </MemoryRouter>,
        );
      });
      expect(state.capturedProps?.collectionsLoading).toBe(false);
      expect(state.capturedProps?.collectionsLoadError).toBe(true);
      state.capturedProps?.onRetryCollections?.();
      expect(state.refetchCollections).toHaveBeenCalledOnce();
      expect(state.refetchProjectCollections).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
