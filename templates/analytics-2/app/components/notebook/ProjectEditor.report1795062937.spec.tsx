// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { assert, expect, it, vi } from "vitest";

import type { ProjectDocument } from "@/lib/model/contracts";

import { ProjectEditor } from "./ProjectEditor";

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: null }),
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  actionErrorMessage: () => null,
  useActionMutation: () => ({ mutateAsync: async () => ({}) }),
  writeClientAppState: vi.fn(async () => {}),
  compareAndSetClientAppState: vi.fn(async () => {}),
  useActionQuery: () => ({ data: undefined, isPending: false, error: null }),
}));
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [] }),
  useResource: () => ({ data: undefined }),
}));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

const DESCRIPTION = "Quarterly revenue review";
const empty: ProjectDocument = {
  id: "prj_desc",
  title: "Revenue",
  description: DESCRIPTION,
  language: "python",
  ownerEmail: "qa@workspace.test",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  collectionIds: [],
  cells: [],
  workingVersionId: "ver_1",
  publishedVersionId: null,
};

async function mount(project: ProjectDocument) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ProjectEditor
            project={project}
            connections={[]}
            onRename={async () => {}}
            onSaveDescription={async () => {}}
            onSaveCell={async () => {}}
            onAddCell={async () => "cel_new"}
            onDeleteCell={async () => {}}
            onRunCell={async () => {}}
            onSelectConnection={async () => {}}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  return {
    container,
    cleanup() {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("report QA-1795062937 shows the description once on an empty notebook, in the body", async () => {
  const { container, cleanup } = await mount(empty);
  try {
    expect(
      container.querySelector(".nb-header .nb-project-description"),
    ).toBeNull();
    const body = container.querySelector(".nb-body .nb-project-description");
    assert(body);
    expect(body.textContent).toBe(DESCRIPTION);
    expect(container.textContent.split(DESCRIPTION).length - 1).toBe(1);
  } finally {
    cleanup();
  }
});

it("keeps the description once in the notebook body when the notebook has cells", async () => {
  const cell = {
    id: "cel_1",
    projectId: empty.id,
    versionId: empty.workingVersionId,
    createdAt: empty.createdAt,
    updatedAt: empty.updatedAt,
    contents: {
      id: "cel_1",
      kind: "sql" as const,
      order: "a0",
      source: "Notes",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: null,
      outputResult: true,
    },
  };
  const { container, cleanup } = await mount({ ...empty, cells: [cell] });
  try {
    expect(
      container.querySelector(".nb-body .nb-project-description")?.textContent,
    ).toBe(DESCRIPTION);
    expect(container.textContent.split(DESCRIPTION).length - 1).toBe(1);
  } finally {
    cleanup();
  }
});

it("report QA-1795062135 offers the status and category pickers on an empty notebook", async () => {
  const { container, cleanup } = await mount(empty);
  try {
    const labels = [...container.querySelectorAll("button")].map((button) =>
      button.textContent.trim(),
    );
    expect(labels).toEqual(
      expect.arrayContaining(["Add status", "Add categories"]),
    );
  } finally {
    cleanup();
  }
});
