// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
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

const project: ProjectDocument = {
  id: "prj_clear",
  title: "Clear outputs check",
  description: "",
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

async function mount(canEdit: boolean, onClearOutputs?: () => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <ProjectEditor
              project={project}
              connections={[]}
              canEdit={canEdit}
              {...(onClearOutputs ? { onClearOutputs } : {})}
              onRename={async () => {}}
              onSaveDescription={async () => {}}
              onSaveCell={async () => {}}
              onAddCell={async () => "cel_new"}
              onDeleteCell={async () => {}}
              onRunCell={async () => {}}
              onSelectConnection={async () => {}}
            />
          </AgentNativeI18nProvider>
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

function openOptionsMenu(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>(
    '[aria-label="Project options"]',
  );
  if (!trigger) throw new Error("Project options trigger missing");
  act(() => {
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
  const menu = document.querySelector(
    '[role="menu"][aria-label="Project options"]',
  );
  if (!menu) throw new Error("Project options menu did not open");
  return menu;
}

describe("ProjectEditor clear outputs menu action", () => {
  it("exposes Clear outputs in the Project options menu when editable and invokes onClearOutputs", async () => {
    const onClearOutputs = vi.fn(async () => {});
    const { container, cleanup } = await mount(true, onClearOutputs);
    try {
      const menu = openOptionsMenu(container);
      const items = [
        ...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ];
      const clearItem = items.find(
        (node) => node.textContent?.trim() === "Clear outputs",
      );
      expect(clearItem).toBeDefined();
      await act(async () => {
        clearItem!.click();
      });
      expect(onClearOutputs).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("omits Clear outputs from the Project options menu when onClearOutputs is not provided", async () => {
    const { container, cleanup } = await mount(true, undefined);
    try {
      const menu = openOptionsMenu(container);
      const labels = [...menu.querySelectorAll('[role="menuitem"]')].map(
        (node) => node.textContent?.trim(),
      );
      expect(labels).not.toContain("Clear outputs");
    } finally {
      cleanup();
    }
  });
});
