// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { ProjectDocument } from "@/lib/model/contracts";

import { ProjectEditor } from "./ProjectEditor";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    callAction: mocks.callAction,
    useActionQuery: () => ({
      data: undefined,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    }),
    useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
    writeClientAppState: vi.fn(async () => {}),
    compareAndSetClientAppState: vi.fn(async () => {}),
  };
});

vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [] }),
  useResource: () => ({ data: undefined }),
}));

vi.mock("@agent-native/toolkit/app/shared", () => ({
  AgentNativeIcon: () => <span />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

const emptyProject: ProjectDocument = {
  id: "prj_csv_empty",
  title: "Untitled project",
  description: "",
  language: "python",
  ownerEmail: "qa@workspace.test",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  collectionIds: [],
  cells: [],
  workingVersionId: "ver_1",
  publishedVersionId: null,
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

it("report QA-1795065183.853729: empty-state Upload a CSV uses a single CSV-only picker and imports directly without opening the dual-mode Files panel", async () => {
  mocks.callAction.mockResolvedValue({
    dataset: { id: "ds_1", name: "sales", rowCount: 2 },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <ProjectEditor
              project={emptyProject}
              connections={[]}
              canEdit
              onRename={async () => {}}
              onSaveCell={async () => {}}
              onAddCell={async () => "cel_1"}
              onDeleteCell={async () => {}}
              onRunCell={async () => {}}
              onSelectConnection={async () => {}}
            />
          </AgentNativeI18nProvider>
        </MemoryRouter>,
      ),
    );

    const csvInput = container.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".csv,text/csv"]',
    );
    expect(csvInput).not.toBeNull();
    const clickSpy = vi.spyOn(csvInput!, "click");

    const uploadButton = [...container.querySelectorAll("button")].find(
      (btn) => btn.textContent?.trim() === "Upload a CSV",
    );
    expect(uploadButton).toBeDefined();
    await act(async () => {
      uploadButton!.click();
    });

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(container.querySelector('aside[aria-label="Files"]')).toBeNull();
    expect(
      container.querySelector('input[aria-label="Upload files"]'),
    ).toBeNull();

    const nonCsv = new File(["hello"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(csvInput, "files", {
      value: [nonCsv],
      configurable: true,
    });
    await act(async () => {
      csvInput!.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Choose a CSV file.");

    const file = new File(["city,amount\nNYC,10\nLA,20\n"], "sales.csv", {
      type: "text/csv",
    });
    Object.defineProperty(csvInput, "files", {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      csvInput!.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.callAction).toHaveBeenCalledWith("import-project-csv", {
      projectId: "prj_csv_empty",
      filename: "sales.csv",
      dataBase64: btoa("city,amount\nNYC,10\nLA,20\n"),
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Imported sales (2 rows). Staged data is ready to query.",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
