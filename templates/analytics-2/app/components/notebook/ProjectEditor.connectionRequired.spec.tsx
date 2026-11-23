// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
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
  actionErrorMessage: (error: { actionMessage?: string }) =>
    error.actionMessage ?? null,
  actionErrorCode: (error: { errorCode?: string }) => error.errorCode,
  writeClientAppState: vi.fn(async () => {}),
  compareAndSetClientAppState: vi.fn(async () => {}),
  useActionQuery: () => ({ data: undefined, isPending: false, error: null }),
  useActionMutation: () => ({ mutateAsync: async () => ({}) }),
}));

const project = {
  id: "prj_connection",
  ownerEmail: "qa@workspace.test",
  title: "Connection project",
  description: "",
  language: "sql",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
  collectionIds: [],
  cells: [
    {
      id: "cel_a",
      contents: {
        id: "cel_a",
        kind: "sql",
        order: "a0",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        source: "select * from unknown_table",
        dataConnectionId: null,
        databaseSchema: null,
        resultVariable: null,
        outputResult: true,
      },
    },
  ],
  versions: [],
  workingVersionId: "ver_1",
  publishedVersionId: null,
} as unknown as ProjectDocument;

it("report A2-FIND-20261116-F12 shows a connection prompt instead of the raw action failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const failure = Object.assign(
    new Error(
      "Action run-project-cell failed: Select a data connection before running this query.",
    ),
    {
      errorCode: "project_connection_required",
      actionMessage: "Select a data connection before running this query.",
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <MemoryRouter>
            <ProjectEditor
              project={project}
              connections={[]}
              onRename={async () => {}}
              onSaveCell={async () => "revision"}
              onAddCell={async () => "test-cell"}
              onDeleteCell={async () => {}}
              onRunCell={async () => {
                throw failure;
              }}
              onSelectConnection={async () => {}}
            />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      ),
    );
    const editor = await vi.waitFor(() => {
      const found = container.querySelector<HTMLElement>(".cm-content");
      assert(found);
      return found;
    });
    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    await vi.waitFor(() => {
      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain(enUS.notebook.connectionRequired);
    });
    expect(container.textContent).not.toContain("Action run-project-cell");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
