// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { assert, beforeAll, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { CellContents, ProjectDocument } from "@/lib/model/contracts";

import { loadNotebookCell } from "../workspace/route-critical-code";
import { ProjectEditor } from "./ProjectEditor";

beforeAll(() => loadNotebookCell());

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

const stamp = "2026-11-01T00:00:00.000Z";
const geometry = {
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};

function cell(id: string, order: string, contents: object) {
  return {
    id,
    projectId: "prj_inline",
    versionId: "ver_1",
    createdAt: stamp,
    updatedAt: stamp,
    contents: {
      id,
      order,
      label: null,
      hidden: false,
      ...geometry,
      ...contents,
    } as CellContents,
  };
}

const input = (id: string, order: string, name: string) =>
  cell(id, order, {
    kind: "input",
    inputType: "TEXT_INPUT",
    name,
    defaultValueString: "",
  });

const project: ProjectDocument = {
  id: "prj_inline",
  title: "Inline inputs",
  description: "",
  language: "python",
  ownerEmail: "qa@workspace.test",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
  collectionIds: [],
  cells: [
    input("cel_a", "a0", "region"),
    input("cel_b", "a1", "borough"),
    cell("cel_sql", "a2", {
      kind: "sql",
      source: "select 1",
      dataConnectionId: null,
      databaseSchema: null,
      resultVariable: null,
      outputResult: true,
    }),
    input("cel_last", "a3", "year"),
  ],
  workingVersionId: "ver_1",
  publishedVersionId: null,
} as ProjectDocument;

async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onAddCell = vi.fn(async () => "cel_new");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <ProjectEditor
              project={project}
              connections={[]}
              onRename={async () => {}}
              onSaveDescription={async () => {}}
              onSaveCell={async () => {}}
              onAddCell={onAddCell}
              onDeleteCell={async () => {}}
              onRunCell={async () => {}}
              onSelectConnection={async () => {}}
            />
          </MemoryRouter>
        </QueryClientProvider>
      </AgentNativeI18nProvider>,
    ),
  );
  return {
    container,
    onAddCell,
    cleanup() {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

const slotOf = (container: HTMLElement, name: string) => {
  const slot = [...container.querySelectorAll(".nb-cell-slot")].find((s) =>
    s.querySelector(`[aria-label="Value for ${name}"]`),
  );
  assert(slot, `slot for ${name}`);
  return slot;
};

it("groups consecutive inputs inline and keeps the query full width", async () => {
  const { container, cleanup } = await mount();
  try {
    const groups = container.querySelectorAll("[data-nb-inline-group]");
    expect(groups).toHaveLength(2);
    const first = groups[0];
    assert(first);
    expect(first.querySelectorAll(".nb-cell-slot")).toHaveLength(2);
    expect(first.contains(slotOf(container, "region"))).toBe(true);
    expect(first.contains(slotOf(container, "borough"))).toBe(true);
    const sql = [...container.querySelectorAll(".nb-cell-slot")].find(
      (s) => !s.querySelector('[aria-label^="Value for"]'),
    );
    assert(sql);
    expect(sql.closest("[data-nb-inline-group]")).toBeNull();
  } finally {
    cleanup();
  }
});

it("puts an add-cell plus beside every input, including the last cell", async () => {
  const { container, cleanup } = await mount();
  try {
    for (const name of ["region", "borough", "year"]) {
      const slot = slotOf(container, name);
      const plus = slot.querySelector('[aria-label="Add cell here"]');
      assert(plus, `plus for ${name}`);
      expect(slot.querySelector(".nb-insert")).toBeNull();
      const card = slot.querySelector(".nb-cell");
      assert(card);
      expect(
        card.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  } finally {
    cleanup();
  }
});

it("offers only supported Inputs and More to the right, and inserts after the anchor", async () => {
  const { container, onAddCell, cleanup } = await mount();
  try {
    const plus = slotOf(container, "year").querySelector<HTMLButtonElement>(
      '[aria-label="Add cell here"]',
    );
    assert(plus);
    act(() => plus.click());
    const popover = document.querySelector("[data-side]");
    assert(popover);
    expect(popover.getAttribute("data-side")).toBe("right");
    const labels = [...popover.querySelectorAll("button")].map((button) =>
      button.textContent.trim(),
    );
    expect(labels).toEqual(["Inputs", "More"]);
    const inputsButton = [...popover.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "Inputs",
    );
    assert(inputsButton);
    act(() => inputsButton.click());
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (entry) => entry.textContent.trim() === "Text input",
    ) as HTMLButtonElement | undefined;
    assert(item);
    await act(async () => item.click());
    expect(onAddCell).toHaveBeenCalledWith(
      "input",
      "cel_last",
      expect.objectContaining({ inputType: "TEXT_INPUT" }),
    );
  } finally {
    cleanup();
  }
});

it("inserts Single value with U from the inline More menu", async () => {
  const { container, onAddCell, cleanup } = await mount();
  try {
    const plus = slotOf(container, "year").querySelector<HTMLButtonElement>(
      '[aria-label="Add cell here"]',
    );
    assert(plus);
    act(() => plus.click());
    const popover = document.querySelector("[data-side]");
    assert(popover);
    const more = [...popover.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "More",
    );
    assert(more);
    act(() => more.click());
    const singleValue = popover.querySelector('[aria-label="Single value"]');
    expect(singleValue?.getAttribute("aria-keyshortcuts")).toBe("U");
    expect(singleValue?.textContent).toContain("Single value");
    expect(
      singleValue?.previousElementSibling?.getAttribute("aria-label"),
    ).toBe("Pivot");
    expect(onAddCell).not.toHaveBeenCalled();
    const focused = document.activeElement;
    assert(focused && popover.contains(focused));
    await act(async () => {
      focused.dispatchEvent(
        new KeyboardEvent("keydown", { key: "u", code: "KeyU", bubbles: true }),
      );
    });
    expect(onAddCell).toHaveBeenCalledExactlyOnceWith(
      "metric",
      "cel_last",
      undefined,
    );
  } finally {
    cleanup();
  }
});

it("More from the beside-input plus keeps the after-anchor location", async () => {
  const { container, onAddCell, cleanup } = await mount();
  try {
    const plus = slotOf(container, "region").querySelector<HTMLButtonElement>(
      '[aria-label="Add cell here"]',
    );
    assert(plus);
    act(() => plus.click());
    const moreButton = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-side] button"),
    ].find((button) => button.textContent.trim() === "More");
    assert(moreButton);
    act(() => moreButton.click());
    const menu = [...document.querySelectorAll('[role="menu"]')].find(
      (candidate) => candidate.getAttribute("aria-label") === "More",
    );
    assert(menu);
    const text = [...menu.querySelectorAll('[role="menuitem"]')].find(
      (entry) => entry.getAttribute("aria-label") === "Text",
    ) as HTMLButtonElement | undefined;
    assert(text);
    await act(async () => text.click());
    expect(onAddCell.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["text", "cel_a"],
    ]);
  } finally {
    cleanup();
  }
});
