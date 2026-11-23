// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { ProjectDocument } from "@/lib/model/contracts";

vi.mock("./NotebookCell", () => {
  throw new Error("Cell editor bundle unavailable");
});
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: null }),
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  actionErrorMessage: () => null,
  actionErrorCode: () => null,
  callAction: vi.fn(async () => ({})),
  writeClientAppState: vi.fn(async () => {}),
  compareAndSetClientAppState: vi.fn(async () => {}),
  useActionQuery: () => ({ data: undefined, isPending: false, error: null }),
  useActionMutation: () => ({ mutateAsync: async () => ({}) }),
}));

it("report 1794947190: an empty notebook stays interactive without the cell editor bundle", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { ProjectEditor } = await import("./ProjectEditor");
  const project: ProjectDocument = {
    id: "prj_empty",
    ownerEmail: "qa-fleet@builder.io",
    title: "Empty notebook",
    description: "",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: null,
    createdAt: "2026-11-21T00:00:00.000Z",
    updatedAt: "2026-11-21T00:00:00.000Z",
    collectionIds: [],
    cells: [],
    workingVersionId: "working-empty",
    publishedVersionId: null,
  };
  const ask = vi.fn(async () => {});
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <MemoryRouter>
            <ProjectEditor
              project={project}
              connections={[]}
              onRename={async () => {}}
              onSaveCell={async () => {}}
              onAddCell={async () => "new-cell"}
              onDeleteCell={async () => {}}
              onSelectConnection={async () => {}}
              emptyState={{ onAskDataQuestion: ask }}
            />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      ),
    );
    const prompt = host.querySelector<HTMLInputElement>(
      '[aria-label="What would you like to know?"]',
    );
    assert(prompt);
    expect(prompt.disabled).toBe(false);
    await act(async () => {
      prompt.focus();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      assert(setter);
      setter.call(prompt, "Show billing");
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.activeElement).toBe(prompt);
    expect(prompt.value).toBe("Show billing");
    const more = [...host.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "More",
    );
    assert(more);
    expect(more.disabled).toBe(false);
    await act(async () =>
      more.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    const menu = document.querySelector('[role="menu"][aria-label="More"]');
    assert(menu);
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(
      0,
    );
    await act(async () =>
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(
      document.querySelector('[role="menu"][aria-label="More"]'),
    ).toBeNull();
    const form = prompt.form;
    assert(form);
    await act(async () => form.requestSubmit());
    expect(ask).toHaveBeenCalledExactlyOnceWith("Show billing");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
