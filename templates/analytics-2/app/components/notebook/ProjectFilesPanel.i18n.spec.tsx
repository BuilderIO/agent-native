// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "../../i18n/en-US";
import { ProjectFilesPanel } from "./ProjectFilesPanel";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: {
      files: [
        {
          id: "f1",
          filename: "a.csv",
          mimeType: "text/csv",
          bytes: 1,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    },
    isPending: false,
    refetch: vi.fn(),
  }),
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  callAction: vi.fn(),
  actionErrorMessage: () => undefined,
}));

it("renders upload, sort and size-error copy from the catalog", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const messages = {
    ...enUS,
    notebook: {
      ...enUS.notebook,
      projectFiles: {
        ...enUS.notebook.projectFiles,
        uploadFiles: "Dateien hochladen",
        uploadSize: "Zu groß oder leer.",
        sortFiles: "Dateien sortieren",
        lastModified: "Zuletzt geändert",
      },
    },
  };
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <ProjectFilesPanel projectId="qa-csv-1" onClose={() => {}} />
        </AgentNativeI18nProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Dateien hochladen"]',
    );
    expect(input).not.toBeNull();
    expect(container.textContent).toContain("Dateien hochladen");
    expect(container.textContent).toContain("Zuletzt geändert");
    expect(
      container.querySelector('select[aria-label="Dateien sortieren"]'),
    ).not.toBeNull();
    Object.defineProperty(input, "files", {
      value: [new File([], "empty.txt")],
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Zu groß oder leer.",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
