// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { ProjectDocument } from "@/lib/model/contracts";

import { ProjectEditor } from "./ProjectEditor";
import type { NotebookConnection } from "./types";

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: null }),
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  actionErrorMessage: () => null,
  useActionMutation: () => ({
    mutateAsync: async () => ({}),
    isPending: false,
  }),
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

const emptyProject: ProjectDocument = {
  id: "prj_import_conn",
  title: "Untitled notebook",
  description: "",
  language: "python",
  ownerEmail: "user@example.com",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
  collectionIds: [],
  cells: [],
  workingVersionId: "ver_1",
  publishedVersionId: null,
};

const connections: NotebookConnection[] = [
  {
    id: "conn_demo",
    name: "[Demo] Public Data",
    isDefault: true,
  },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ items: [], endCursor: null, hasNextPage: false }),
    ),
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function withDataBrowser(
  props: Partial<ComponentProps<typeof ProjectEditor>>,
  check: (panel: Element) => Promise<void>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <AgentNativeI18nProvider
              catalog={{ messages: enUS }}
              persistPreference={false}
            >
              <ProjectEditor
                project={emptyProject}
                connections={connections}
                canEdit
                onRename={async () => {}}
                onSaveCell={async () => {}}
                onDeleteCell={async () => {}}
                onRunCell={async () => {}}
                onSelectConnection={async () => {}}
                onAddCell={async () => "cel_1"}
                {...props}
              />
            </AgentNativeI18nProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    const chip = container.querySelector<HTMLButtonElement>(
      "button.nb-empty-connection",
    );
    assert(chip);
    await act(async () => chip.click());
    const panel = container.querySelector('aside[aria-label="Data browser"]');
    assert(panel);
    await check(panel);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

const button = (panel: Element, label: string) =>
  [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  );

it("Import links the connection to the project and adds no cell", async () => {
  const onImportConnection = vi.fn(async () => {});
  const onAddCell = vi.fn(async () => "cel_1");
  await withDataBrowser({ onImportConnection, onAddCell }, async (panel) => {
    const importButton = button(panel, enUS.dataBrowser.notebook.import);
    assert(importButton);
    await act(async () => importButton.click());
    expect(onImportConnection).toHaveBeenCalledExactlyOnceWith("conn_demo");
    expect(onAddCell).not.toHaveBeenCalled();
  });
});

it("Query on a connection that is not imported imports it, then adds the SQL cell", async () => {
  const order: string[] = [];
  const onImportConnection = vi.fn(async () => {
    order.push("import");
  });
  const onAddCell = vi.fn(async () => {
    order.push("add");
    return "cel_1";
  });
  await withDataBrowser({ onImportConnection, onAddCell }, async (panel) => {
    const query = button(panel, enUS.dataBrowser.notebook.query);
    assert(query);
    await act(async () => query.click());
    expect(onImportConnection).toHaveBeenCalledExactlyOnceWith("conn_demo");
    expect(onAddCell).toHaveBeenCalledExactlyOnceWith("sql", undefined, {
      dataConnectionId: "conn_demo",
    });
    expect(order).toEqual(["import", "add"]);
  });
});

it("hides Import for a connection the project already imported, and Query only adds the cell", async () => {
  const onImportConnection = vi.fn(async () => {});
  const onAddCell = vi.fn(async () => "cel_1");
  await withDataBrowser(
    { onImportConnection, onAddCell, linkedConnectionIds: ["conn_demo"] },
    async (panel) => {
      expect(button(panel, enUS.dataBrowser.notebook.import)).toBeUndefined();
      const query = button(panel, enUS.dataBrowser.notebook.query);
      assert(query);
      await act(async () => query.click());
      expect(onImportConnection).not.toHaveBeenCalled();
      expect(onAddCell).toHaveBeenCalledOnce();
    },
  );
});

it("does not add a cell when the import fails", async () => {
  const onImportConnection = vi.fn(async () => {
    throw new Error("Import failed");
  });
  const onAddCell = vi.fn(async () => "cel_1");
  await withDataBrowser({ onImportConnection, onAddCell }, async (panel) => {
    const query = button(panel, enUS.dataBrowser.notebook.query);
    assert(query);
    await act(async () => query.click());
    expect(onImportConnection).toHaveBeenCalledOnce();
    expect(onAddCell).not.toHaveBeenCalled();
  });
});
