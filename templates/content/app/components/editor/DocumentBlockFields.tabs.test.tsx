// @vitest-environment happy-dom

import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigationType } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: null as Record<string, unknown> | null,
  editors: new Map<string, Record<string, unknown>>(),
  editorMounts: 0,
  editorUnmounts: 0,
  save: vi.fn(async (_request: Record<string, unknown>) => ({})),
  reorder: vi.fn(async (_request: Record<string, unknown>) => ({})),
  configure: vi.fn(
    async (_request: Record<string, unknown>) =>
      ({}) as Record<string, unknown>,
  ),
  configurePending: false,
  remove: vi.fn(async (_request: Record<string, unknown>) => ({})),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
}));
vi.mock("@/hooks/use-document-properties", () => ({
  documentPropertiesPlaceholder: () => undefined,
  documentPropertiesResponseMatchesScope: (
    documentId: string,
    databaseId: string | null,
    data: { documentId?: string; databaseId?: string | null } | undefined,
  ) => data?.documentId === documentId && data?.databaseId === databaseId,
  useDocumentProperties: () => mocks.query,
  useConfigureDocumentProperty: () => ({
    mutateAsync: mocks.configure,
    isPending: mocks.configurePending,
  }),
  useDeleteDocumentProperty: () => ({ mutateAsync: mocks.remove }),
  useReorderDocumentProperty: () => ({ mutateAsync: mocks.reorder }),
  useSetDocumentProperty: () => ({ mutateAsync: mocks.save }),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/components/QueryErrorState", () => ({
  QueryErrorState: () => null,
}));
vi.mock("./VisualEditor", async () => {
  const React = await import("react");
  return {
    // Keyed by the text it was first given, so a test can find each field's
    // editor and see whether it was ever remounted.
    VisualEditor: (props: Record<string, unknown>) => {
      const label = React.useRef(String(props.content)).current;
      const latest = React.useRef(props);
      latest.current = props;
      const version = React.useRef({}).current;
      React.useEffect(() => {
        const publish = props.onPersistenceControllerChange as
          | ((controller: unknown) => void)
          | undefined;
        publish?.({
          version,
          flushLatest: async () => {
            const save = latest.current.onSaveContent as (
              content: string,
            ) => Promise<string>;
            return (await save(String(latest.current.content))) !== "failed";
          },
        });
        return () => publish?.(null);
      }, [props.onPersistenceControllerChange, version]);

      mocks.editors.set(label, props);
      React.useEffect(() => {
        mocks.editorMounts += 1;
        return () => {
          mocks.editorUnmounts += 1;
        };
      }, []);
      return React.createElement("div", { "data-visual-editor": label });
    },
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  __resetBlockFieldSaveRegistry,
  flushAllBlockFieldSaveControllersForDocument,
} from "./blockFieldSaveRegistry";
import {
  primaryBlockFieldEditor,
  visibleBlockFieldEditor,
} from "./blockFieldTabs";
import {
  DocumentBlockFields,
  type PrimaryBlockFieldTab,
} from "./DocumentBlockFields";

const primaryLifecycle = { mounts: 0, unmounts: 0 };

function PrimaryEditorProbe() {
  useEffect(() => {
    primaryLifecycle.mounts += 1;
    return () => {
      primaryLifecycle.unmounts += 1;
    };
  }, []);
  return <div data-primary-editor="" />;
}

const location = { href: "", type: "", state: null as unknown };

function LocationProbe() {
  const current = useLocation();
  const type = useNavigationType();
  location.href = `${current.pathname}${current.search}`;
  location.type = type;
  location.state = current.state;
  return null;
}

type FieldOptions = {
  name?: string;
  primary?: boolean;
  value?: string;
  revision?: number;
  position?: number;
};

function field(id: string, options: FieldOptions = {}) {
  return {
    definition: {
      id,
      databaseId: "db-1",
      name: options.name ?? id,
      type: "blocks",
      visibility: "always_show",
      options: { blocks: { primary: options.primary ?? false } },
      position: options.position ?? 0,
      createdAt: "2026-10-18T00:00:00.000Z",
      updatedAt: "2026-10-18T00:00:00.000Z",
    },
    value: options.value ?? "",
    editable: true,
    blocksField: { revision: options.revision ?? 1 },
  };
}

function content(options: FieldOptions = {}) {
  return field("content", {
    name: "Content",
    primary: true,
    value: "one two three",
    position: 0,
    ...options,
  });
}

function notes(options: FieldOptions = {}) {
  return field("notes", {
    name: "Notes",
    value: "Notes text",
    position: 1,
    ...options,
  });
}

function setFields(
  fields: unknown[],
  permissions: { canManageSchema?: boolean } = {},
) {
  mocks.query = {
    data: {
      documentId: "doc-1",
      databaseId: "db-1",
      canEditValues: true,
      canManageSchema: permissions.canManageSchema ?? true,
      properties: fields,
    },
    isError: false,
    isRefetching: false,
  };
}

describe("DocumentBlockFields tabs", () => {
  let root: Root;
  let container: HTMLDivElement;
  let entry = "/page/doc-1";
  const onAdditionalContentChange = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    entry = "/page/doc-1";
    localStorage.clear();
    mocks.editors.clear();
    mocks.editorMounts = 0;
    mocks.editorUnmounts = 0;
    mocks.save.mockReset();
    mocks.save.mockImplementation(async () => ({}));
    mocks.reorder.mockReset();
    mocks.reorder.mockImplementation(async () => ({}));
    mocks.configure.mockReset();
    mocks.configurePending = false;
    mocks.remove.mockReset();
    mocks.remove.mockImplementation(async () => ({}));
    mocks.toastError.mockReset();
    primaryLifecycle.mounts = 0;
    primaryLifecycle.unmounts = 0;
    onAdditionalContentChange.mockClear();
    setFields([content(), notes()]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    __resetBlockFieldSaveRegistry();
    vi.unstubAllGlobals();
  });

  function tree(
    props: {
      primaryContent?: string;
      primaryEditor?: ReactNode;
      usePagePropertiesOnly?: boolean;
      onPrimaryFieldTabChange?: (tab: PrimaryBlockFieldTab) => void;
    } = {},
  ): ReactNode {
    return (
      <MemoryRouter initialEntries={["/home", entry]} initialIndex={1}>
        <TooltipProvider>
          <LocationProbe />
          <DocumentBlockFields
            documentId="doc-1"
            databaseId="db-1"
            databaseDocumentId="db-page"
            canEdit
            primaryEditor={<PrimaryEditorProbe />}
            onAdditionalContentChange={onAdditionalContentChange}
            {...props}
          />
        </TooltipProvider>
      </MemoryRouter>
    );
  }

  async function render(props?: Parameters<typeof tree>[0]) {
    await act(async () => root.render(tree(props)));
  }

  async function remount(props?: Parameters<typeof tree>[0]) {
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(props);
  }

  function tabs() {
    return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  }

  function tab(id: string) {
    const element = container.querySelector<HTMLButtonElement>(
      `[role="tab"][data-block-field-id="${id}"]`,
    );
    if (!element) throw new Error(`No tab for ${id}`);
    return element;
  }

  function panel(id: string) {
    const element = container.querySelector<HTMLElement>(
      `[role="tabpanel"][data-block-field-id="${id}"]`,
    );
    if (!element) throw new Error(`No panel for ${id}`);
    return element;
  }

  function selectedTabId() {
    return tabs().find(
      (element) => element.getAttribute("aria-selected") === "true",
    )?.dataset.blockFieldId;
  }

  async function click(element: HTMLElement) {
    await act(async () => element.click());
  }

  async function key(element: HTMLElement, name: string) {
    await act(async () => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true }),
      );
    });
  }

  async function type(label: string, markdown: string) {
    const editor = mocks.editors.get(label);
    if (!editor) throw new Error(`No editor for ${label}`);
    await act(async () =>
      (editor.onChange as (value: string) => void)(markdown),
    );
  }

  describe("layout", () => {
    it("shows two Blocks fields as a tab row over one visible panel (TABS-1)", async () => {
      await render();

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist?.getAttribute("aria-label")).toBe("editor.blockFieldTabs");
      expect(tabs().map((element) => element.dataset.blockFieldId)).toEqual([
        "content",
        "notes",
      ]);
      expect(tab("content").getAttribute("aria-selected")).toBe("true");
      expect(tab("notes").getAttribute("aria-selected")).toBe("false");
      for (const id of ["content", "notes"]) {
        expect(tab(id).getAttribute("aria-controls")).toBe(panel(id).id);
        expect(panel(id).getAttribute("aria-labelledby")).toBe(tab(id).id);
      }
      expect(panel("content").hidden).toBe(false);
      expect(panel("notes").hidden).toBe(true);
      // A display utility on a panel would beat `hidden` and show it.
      expect(panel("notes").className).not.toMatch(
        /(?:^|\s)(?:block|flex|grid|inline\S*|contents|table)(?:\s|$)/,
      );
      expect(
        panel("content").querySelector("[data-primary-editor]"),
      ).not.toBeNull();
      expect(
        panel("notes").querySelector('[data-visual-editor="Notes text"]'),
      ).not.toBeNull();
      expect(container.querySelector("[data-block-field-shell]")).toBeNull();
      expect(
        container.querySelector('[aria-label="editor.toggleField"]'),
      ).toBeNull();
    });

    it("sticks the tab row to the top of the page", async () => {
      await render();
      const row =
        container.querySelector('[role="tablist"]')?.parentElement
          ?.parentElement;
      expect(row?.className).toContain("sticky");
      expect(row?.className).toContain("top-0");
      expect(
        container.querySelector('[role="tablist"]')?.parentElement?.className,
      ).toContain("overflow-x-auto");
    });

    it("labels each tab with its name and live word count (TABS-1)", async () => {
      setFields([
        content(),
        notes(),
        field("empty", { name: "Empty field", position: 2 }),
      ]);
      await render({ primaryContent: "one two three four" });

      expect(tab("content").textContent).toBe(
        "Contenteditor.properties.wordCount:4",
      );
      expect(tab("notes").textContent).toBe(
        "Noteseditor.properties.wordCount:2",
      );
      expect(tab("empty").textContent).toBe("Empty field");

      await type("Notes text", "a b c d e");
      expect(tab("notes").textContent).toBe(
        "Noteseditor.properties.wordCount:5",
      );
      expect(onAdditionalContentChange).toHaveBeenLastCalledWith(
        "doc-1",
        "notes",
        "a b c d e",
      );
    });

    it("keeps a single Blocks field chromeless (TABS-2)", async () => {
      setFields([content()]);
      await render();

      expect(container.querySelector('[role="tablist"]')).toBeNull();
      expect(container.querySelector('[role="tab"]')).toBeNull();
      expect(
        container.querySelector('[data-block-fields-state="solo"]'),
      ).not.toBeNull();
      expect(container.querySelector("[data-primary-editor]")).not.toBeNull();
    });
  });

  describe("switching", () => {
    it("keeps every editor mounted and saves nothing on a switch (TABS-3)", async () => {
      await render();
      expect(primaryLifecycle).toEqual({ mounts: 1, unmounts: 0 });
      expect(mocks.editorMounts).toBe(1);

      await click(tab("notes"));
      await type("Notes text", "Typed in notes");
      await click(tab("content"));
      await click(tab("notes"));
      await click(tab("content"));

      expect(primaryLifecycle).toEqual({ mounts: 1, unmounts: 0 });
      expect(mocks.editorMounts).toBe(1);
      expect(mocks.editorUnmounts).toBe(0);
      // The pending edit was neither flushed nor saved by switching tabs.
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.editors.get("Notes text")?.content).toBe("Typed in notes");

      await act(async () => {
        await flushAllBlockFieldSaveControllersForDocument("doc-1");
      });
      expect(mocks.save).toHaveBeenCalledTimes(1);
      expect(mocks.save).toHaveBeenCalledWith({
        documentId: "doc-1",
        propertyId: "notes",
        value: "Typed in notes",
        expectedBlocksFieldRevision: 1,
      });
    });
  });

  describe("URL", () => {
    it("writes ?field= with replace and drops it for the first tab (TABS-5)", async () => {
      entry = "/page/doc-1?databaseId=db-1";
      await render();
      expect(location.href).toBe("/page/doc-1?databaseId=db-1");

      await click(tab("notes"));
      expect(location.href).toBe("/page/doc-1?databaseId=db-1&field=notes");
      expect(location.type).toBe("REPLACE");
      expect(selectedTabId()).toBe("notes");

      await click(tab("content"));
      expect(location.href).toBe("/page/doc-1?databaseId=db-1");
      expect(location.type).toBe("REPLACE");
      expect(selectedTabId()).toBe("content");
    });

    it("opens the tab a deep link names (TABS-5)", async () => {
      entry = "/page/doc-1?field=notes";
      await render();

      expect(selectedTabId()).toBe("notes");
      expect(panel("notes").hidden).toBe(false);
      expect(panel("content").hidden).toBe(true);
    });

    it("falls back to the first tab for an unknown field (TABS-5)", async () => {
      entry = "/page/doc-1?field=deleted-field";
      await render();

      expect(selectedTabId()).toBe("content");
      expect(panel("content").hidden).toBe(false);
      // The URL stops naming a field that isn't open.
      expect(location.href).toBe("/page/doc-1");
    });

    it("drops the open tab from the URL when its field is deleted", async () => {
      entry = "/page/doc-1?field=notes";
      setFields([content(), notes(), field("draft", { position: 2 })]);
      await render();
      expect(selectedTabId()).toBe("notes");

      setFields([content(), field("draft", { position: 2 })]);
      await render();
      expect(selectedTabId()).toBe("content");
      expect(location.href).toBe("/page/doc-1");
    });

    it("drops a deep link to the first tab", async () => {
      entry = "/page/doc-1?field=content";
      await render();

      expect(selectedTabId()).toBe("content");
      expect(location.href).toBe("/page/doc-1");
    });

    it("leaves the URL alone for a row previewed over a collection", async () => {
      entry = "/page/db-page?field=notes";
      await render();
      expect(selectedTabId()).toBe("content");

      await click(tab("notes"));
      expect(selectedTabId()).toBe("notes");
      expect(location.href).toBe("/page/db-page?field=notes");
      expect(location.type).toBe("POP");
    });
  });

  describe("page comments", () => {
    function lastTab(onChange: ReturnType<typeof vi.fn>) {
      return onChange.mock.lastCall?.[0] as PrimaryBlockFieldTab | undefined;
    }

    it("reports when another tab hides the primary field, and brings it back", async () => {
      const onPrimaryFieldTabChange = vi.fn();
      await render({ onPrimaryFieldTabChange });
      expect(lastTab(onPrimaryFieldTabChange)?.open).toBe(true);

      await click(tab("notes"));
      expect(lastTab(onPrimaryFieldTabChange)?.open).toBe(false);

      await act(async () => lastTab(onPrimaryFieldTabChange)?.show());
      expect(selectedTabId()).toBe("content");
      expect(panel("content").hidden).toBe(false);
      expect(location.href).toBe("/page/doc-1");
      expect(lastTab(onPrimaryFieldTabChange)?.open).toBe(true);
    });

    it("reports the primary field open again once the tabs go away", async () => {
      const onPrimaryFieldTabChange = vi.fn();
      await render({ onPrimaryFieldTabChange });
      await click(tab("notes"));
      expect(lastTab(onPrimaryFieldTabChange)?.open).toBe(false);

      setFields([content()]);
      await render({ onPrimaryFieldTabChange });
      expect(tabs()).toHaveLength(0);
      expect(lastTab(onPrimaryFieldTabChange)?.open).toBe(true);
    });

    it("marks the primary field's panel wherever its tab sits", async () => {
      setFields([notes({ position: 0 }), content({ position: 1 })]);
      await render();

      expect(tabs().map((element) => element.dataset.blockFieldId)).toEqual([
        "notes",
        "content",
      ]);
      expect(
        panel("content").hasAttribute("data-primary-block-field-panel"),
      ).toBe(true);
      expect(
        panel("notes").hasAttribute("data-primary-block-field-panel"),
      ).toBe(false);
    });

    it("finds the open tab's editor and the page body's editor", () => {
      const layout = document.createElement("div");
      layout.innerHTML = `
        <div data-block-field-panel>
          <div class="ProseMirror" id="notes-editor"></div>
        </div>
        <div data-block-field-panel data-primary-block-field-panel hidden>
          <div class="ProseMirror" id="body-editor"></div>
        </div>`;
      expect(visibleBlockFieldEditor(layout)?.id).toBe("notes-editor");
      expect(primaryBlockFieldEditor(layout)?.id).toBe("body-editor");

      layout.innerHTML = `<div class="ProseMirror" id="solo-editor"></div>`;
      expect(visibleBlockFieldEditor(layout)?.id).toBe("solo-editor");
      expect(primaryBlockFieldEditor(layout)?.id).toBe("solo-editor");
      expect(visibleBlockFieldEditor(null)).toBeNull();
    });

    it("marks a tab switch in history state, so page links don't reopen", async () => {
      await render();
      await click(tab("notes"));
      expect(location.state).toMatchObject({ blockFieldTabSwitch: true });

      await click(tab("content"));
      expect(location.state).toMatchObject({ blockFieldTabSwitch: true });
    });
  });

  describe("keyboard", () => {
    it("moves between tabs with the arrows, Home, and End (TABS-6)", async () => {
      setFields([content(), notes(), field("outline", { position: 2 })]);
      await render();
      expect(tabs().map((element) => element.tabIndex)).toEqual([0, -1, -1]);

      tab("content").focus();
      await key(tab("content"), "ArrowRight");
      expect(selectedTabId()).toBe("notes");
      expect(document.activeElement).toBe(tab("notes"));
      expect(tabs().map((element) => element.tabIndex)).toEqual([-1, 0, -1]);

      await key(tab("notes"), "ArrowLeft");
      await key(tab("content"), "ArrowLeft");
      expect(selectedTabId()).toBe("outline");
      expect(document.activeElement).toBe(tab("outline"));

      await key(tab("outline"), "Home");
      expect(selectedTabId()).toBe("content");
      await key(tab("content"), "End");
      expect(selectedTabId()).toBe("outline");
    });

    it("leaves modified and unrelated keys to the page (TABS-6)", async () => {
      await render();

      await key(tab("content"), "1");
      const altArrow = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
      });
      await act(async () => {
        tab("content").dispatchEvent(altArrow);
      });

      expect(selectedTabId()).toBe("content");
      expect(altArrow.defaultPrevented).toBe(false);
    });

    it("shows a visible focus ring on tabs (TABS-6)", async () => {
      await render();
      expect(tab("notes").className).toContain("focus-visible:ring-2");
    });
  });

  describe("reorder", () => {
    function placeTabs() {
      const rect = (left: number, right: number) => ({
        left,
        right,
        top: 0,
        bottom: 36,
        width: right - left,
        height: 36,
        x: left,
        y: 0,
        toJSON: () => ({}),
      });
      const tablist = container.querySelector('[role="tablist"]')!;
      tablist.getBoundingClientRect = () => rect(0, 200) as DOMRect;
      tab("content").getBoundingClientRect = () => rect(0, 100) as DOMRect;
      tab("notes").getBoundingClientRect = () => rect(100, 200) as DOMRect;
    }

    function pointer(
      target: EventTarget,
      type: string,
      clientX: number,
      clientY = 18,
    ) {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
          clientX,
          clientY,
        }),
      );
    }

    it("drags a tab to a new place through the reorder action (TABS-7)", async () => {
      await render();
      placeTabs();

      await act(async () => pointer(tab("content"), "pointerdown", 40));
      await act(async () => pointer(document, "pointermove", 120));
      await act(async () => pointer(document, "pointermove", 180));
      expect(
        tab("notes").querySelector('[data-block-field-drop-indicator="after"]'),
      ).not.toBeNull();
      expect(
        container.querySelector("[data-block-field-drag-preview]"),
      ).not.toBeNull();

      // A release over a tab clicks it in the same task; that click must
      // not select the tab it landed on.
      await act(async () => {
        pointer(document, "pointerup", 180);
        tab("notes").click();
      });
      expect(mocks.reorder).toHaveBeenCalledWith({
        documentId: "doc-1",
        propertyId: "content",
        targetPropertyId: "notes",
        position: "after",
      });
      expect(
        container.querySelector("[data-block-field-drop-indicator]"),
      ).toBeNull();
      expect(selectedTabId()).toBe("content");

      // The open tab stays open as the new order lands, with no remount.
      expect(location.href).toBe("/page/doc-1?field=content");
      setFields([content({ position: 1 }), notes({ position: 0 })]);
      await render();
      expect(tabs().map((element) => element.dataset.blockFieldId)).toEqual([
        "notes",
        "content",
      ]);
      expect(selectedTabId()).toBe("content");
      expect(primaryLifecycle).toEqual({ mounts: 1, unmounts: 0 });
      expect(mocks.editorMounts).toBe(1);
      expect(mocks.editorUnmounts).toBe(0);

      await click(tab("notes"));
      expect(selectedTabId()).toBe("notes");
      expect(location.href).toBe("/page/doc-1");
    });

    it("treats a short press as a click and ignores drops off the row (TABS-7)", async () => {
      await render();
      placeTabs();

      await act(async () => pointer(tab("notes"), "pointerdown", 150));
      await act(async () => pointer(document, "pointermove", 152));
      await act(async () => pointer(document, "pointerup", 152));
      await click(tab("notes"));
      expect(selectedTabId()).toBe("notes");

      await act(async () => pointer(tab("content"), "pointerdown", 40));
      await act(async () => pointer(document, "pointermove", 180, 400));
      expect(
        container.querySelector("[data-block-field-drop-indicator]"),
      ).toBeNull();
      await act(async () => pointer(document, "pointerup", 180, 400));
      expect(mocks.reorder).not.toHaveBeenCalled();

      // A release with no click of its own leaves the next click alone.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await click(tab("content"));
      expect(selectedTabId()).toBe("content");
      await click(tab("notes"));
      expect(selectedTabId()).toBe("notes");
    });

    it("does not drag tabs for people who can't edit (TABS-7)", async () => {
      mocks.query = {
        ...mocks.query,
        data: {
          ...(mocks.query!.data as Record<string, unknown>),
          canEditValues: false,
        },
      };
      await render();
      placeTabs();

      await act(async () => pointer(tab("content"), "pointerdown", 40));
      await act(async () => pointer(document, "pointermove", 180));
      await act(async () => pointer(document, "pointerup", 180));
      expect(mocks.reorder).not.toHaveBeenCalled();
    });
  });

  describe("add", () => {
    function addButton() {
      return container.querySelector<HTMLButtonElement>(
        "[data-block-field-add]",
      );
    }

    it("adds a Blocks field the way the property menu does and opens it to name (TABS-8)", async () => {
      const created = field("blocks-3", { name: "Blocks", position: 2 });
      mocks.configure.mockImplementation(async () => ({
        documentId: "doc-1",
        databaseId: "db-1",
        properties: [content(), notes(), created],
      }));
      await render();
      expect(addButton()?.getAttribute("aria-label")).toBe(
        "editor.addBlockField",
      );
      expect(addButton()?.closest('[role="tablist"]')).toBeNull();

      await click(addButton()!);
      expect(mocks.configure).toHaveBeenCalledWith({
        documentId: "doc-1",
        name: "editor.propertyTypes.blocks",
        type: "blocks",
      });
      // It opens once the property read includes it.
      expect(selectedTabId()).toBe("content");

      setFields([content(), notes(), created]);
      await render();
      expect(location.href).toBe("/page/doc-1?field=blocks-3");
      expect(panel("blocks-3").hidden).toBe(false);
      // Its name is ready to type over.
      const input = container.querySelector<HTMLInputElement>(
        "[data-block-field-name-input]",
      );
      expect(input?.value).toBe("Blocks");
      expect(document.activeElement).toBe(input);

      await key(input!, "Escape");
      expect(selectedTabId()).toBe("blocks-3");
      expect(document.activeElement).toBe(tab("blocks-3"));
      expect(mocks.configure).toHaveBeenCalledTimes(1);
    });

    it("shows + only to people who can change the collection's schema (TABS-8)", async () => {
      setFields([content(), notes()], { canManageSchema: false });
      await render();
      expect(addButton()).toBeNull();

      setFields([content(), notes()]);
      await render({ usePagePropertiesOnly: true });
      expect(addButton()).toBeNull();
    });
  });

  describe("tab menu", () => {
    function menu() {
      return document.querySelector<HTMLElement>("[data-block-field-menu]");
    }

    function nameInput() {
      return container.querySelector<HTMLInputElement>(
        "[data-block-field-name-input]",
      );
    }

    function dialog() {
      return document.querySelector<HTMLElement>('[role="alertdialog"]');
    }

    async function rightClick(element: HTMLElement) {
      await act(async () => {
        element.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
          }),
        );
      });
    }

    async function choose(selector: string) {
      const item = document.querySelector<HTMLElement>(selector);
      if (!item) throw new Error(`No menu item ${selector}`);
      await click(item);
    }

    async function typeName(value: string) {
      const input = nameInput();
      if (!input) throw new Error("No name input");
      await act(async () => {
        // Through the native setter, so React sees the change.
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    async function confirmDelete() {
      await click(
        document.querySelector<HTMLElement>(
          "[data-block-field-delete-confirm]",
        )!,
      );
    }

    it("opens from the open tab's click or any tab's right-click (TABS-11)", async () => {
      await render();
      expect(tab("content").getAttribute("aria-haspopup")).toBe("menu");
      expect(tab("content").getAttribute("aria-expanded")).toBe("false");
      expect(tab("notes").hasAttribute("aria-haspopup")).toBe(false);

      await click(tab("content"));
      expect(menu()?.getAttribute("aria-label")).toBe("editor.blockFieldMenu");
      expect(menu()?.textContent).toContain("editor.blockFieldMenuScope");
      expect(tab("content").getAttribute("aria-expanded")).toBe("true");

      await click(tab("content"));
      expect(menu()).toBeNull();

      // Another tab's click only opens that tab.
      await click(tab("notes"));
      expect(selectedTabId()).toBe("notes");
      expect(menu()).toBeNull();

      await rightClick(tab("content"));
      expect(menu()).not.toBeNull();
      expect(selectedTabId()).toBe("notes");
    });

    it("renames a field without resending the rest of its definition (TABS-11)", async () => {
      await render();
      await click(tab("notes"));
      await click(tab("notes"));
      await choose("[data-block-field-rename]");
      expect(menu()).toBeNull();
      expect(nameInput()?.value).toBe("Notes");
      expect(document.activeElement).toBe(nameInput());

      await typeName("  Margins  ");
      await key(nameInput()!, "Enter");
      // Left-out metadata keeps its stored value, so a stale copy can't
      // revert a collaborator's change.
      expect(mocks.configure).toHaveBeenCalledWith({
        id: "notes",
        documentId: "doc-1",
        name: "Margins",
        type: "blocks",
      });
      // The tab shows the new name before the next read carries it.
      expect(nameInput()).toBeNull();
      expect(tab("notes").textContent).toContain("Margins");
      expect(document.activeElement).toBe(tab("notes"));

      setFields([content(), notes({ name: "Margins" })]);
      await render();
      expect(tab("notes").textContent).toContain("Margins");
    });

    it("renames with F2, cancels with Escape, and saves on blur (TABS-11)", async () => {
      await render();
      await key(tab("content"), "F2");
      expect(nameInput()?.value).toBe("Content");
      await typeName("Poem");
      await key(nameInput()!, "Escape");
      expect(mocks.configure).not.toHaveBeenCalled();
      expect(tab("content").textContent).toContain("Content");
      expect(document.activeElement).toBe(tab("content"));

      await key(tab("content"), "F2");
      await typeName("Poem");
      const elsewhere = document.createElement("button");
      document.body.append(elsewhere);
      await act(async () => elsewhere.focus());
      // The server keeps the body field primary; the rename sends only the name.
      expect(mocks.configure).toHaveBeenCalledWith({
        id: "content",
        documentId: "doc-1",
        name: "Poem",
        type: "blocks",
      });
      // Clicking away leaves focus where the click put it.
      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
    });

    it("skips an empty or unchanged name", async () => {
      await render();
      await key(tab("notes"), "F2");
      await typeName("   ");
      await key(nameInput()!, "Enter");
      await key(tab("notes"), "F2");
      await key(nameInput()!, "Enter");
      expect(mocks.configure).not.toHaveBeenCalled();
      expect(tab("notes").textContent).toContain("Notes");
    });

    it("puts the old name back when a rename fails", async () => {
      mocks.configure.mockRejectedValueOnce(new Error("Offline"));
      await render();
      await key(tab("notes"), "F2");
      await typeName("Margins");
      await key(nameInput()!, "Enter");
      expect(tab("notes").textContent).toContain("Notes");
      expect(mocks.toastError).toHaveBeenCalledWith(
        "editor.renameBlockFieldFailed",
        { description: "Offline" },
      );
    });

    it("deletes a field only after confirming (TABS-12)", async () => {
      entry = "/page/doc-1?field=notes";
      await render();
      await click(tab("notes"));
      await choose("[data-block-field-delete]");
      expect(dialog()?.textContent).toContain(
        "editor.deleteBlockFieldQuestion",
      );
      expect(dialog()?.textContent).toContain(
        "editor.deleteBlockFieldDescription",
      );
      expect(
        document.querySelector("[data-block-field-body-warning]"),
      ).toBeNull();
      expect(mocks.remove).not.toHaveBeenCalled();

      await confirmDelete();
      expect(mocks.remove).toHaveBeenCalledWith({
        documentId: "doc-1",
        propertyId: "notes",
      });
      expect(dialog()).toBeNull();
      // The deleted tab leaves the URL.
      expect(location.href).toBe("/page/doc-1");
    });

    it("warns that deleting the page body clears every row's main text (TABS-12)", async () => {
      await render();
      await rightClick(tab("content"));
      await choose("[data-block-field-delete]");
      expect(
        document.querySelector("[data-block-field-body-warning]")?.textContent,
      ).toBe("editor.deleteBlockFieldBodyWarning");

      const cancel = [...dialog()!.querySelectorAll("button")].find(
        (button) => button.textContent === "editor.properties.cancel",
      );
      await click(cancel!);
      expect(dialog()).toBeNull();
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(tabs()).toHaveLength(2);
    });

    it("doesn't let a deleted field's unsaved text block leaving the page", async () => {
      await render();
      await click(tab("notes"));
      await type("Notes text", "Typed just before deleting");
      mocks.save.mockRejectedValue(new Error("Property not found"));

      await rightClick(tab("notes"));
      await choose("[data-block-field-delete]");
      await confirmDelete();
      setFields([content()]);
      await render();

      await act(async () => {
        await expect(
          flushAllBlockFieldSaveControllersForDocument("doc-1"),
        ).resolves.toBeUndefined();
      });
    });

    it("reports a failed delete", async () => {
      mocks.remove.mockRejectedValueOnce(new Error("Offline"));
      await render();
      await rightClick(tab("notes"));
      await choose("[data-block-field-delete]");
      await confirmDelete();
      expect(mocks.toastError).toHaveBeenCalledWith(
        "editor.deleteBlockFieldFailed",
        { description: "Offline" },
      );
    });

    it("stays on a tab whose delete failed", async () => {
      mocks.remove.mockRejectedValueOnce(new Error("Offline"));
      entry = "/page/doc-1?field=notes";
      await render();
      await click(tab("notes"));
      await choose("[data-block-field-delete]");
      await confirmDelete();

      expect(mocks.toastError).toHaveBeenCalledWith(
        "editor.deleteBlockFieldFailed",
        { description: "Offline" },
      );
      expect(location.href).toBe("/page/doc-1?field=notes");
      expect(tab("notes").getAttribute("aria-selected")).toBe("true");
    });

    it("moves focus into the editor that's left when the tabs go away (TABS-12)", async () => {
      const primaryEditor = (
        <div className="ProseMirror" tabIndex={-1} data-focus-probe="" />
      );
      await render({ primaryEditor });
      tab("notes").focus();
      expect(document.activeElement).toBe(tab("notes"));

      setFields([content()]);
      await render({ primaryEditor });
      expect(container.querySelector('[role="tablist"]')).toBeNull();
      expect(document.activeElement).toBe(
        container.querySelector("[data-focus-probe]"),
      );
    });

    it("leaves focus alone when the tabs go away while someone works elsewhere", async () => {
      const primaryEditor = (
        <div className="ProseMirror" tabIndex={-1} data-focus-probe="" />
      );
      await render({ primaryEditor });
      const elsewhere = document.createElement("button");
      document.body.append(elsewhere);
      elsewhere.focus();

      setFields([content()]);
      await render({ primaryEditor });
      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
    });

    it("offers no menu, rename, or delete without schema permission (TABS-11)", async () => {
      setFields([content(), notes()], { canManageSchema: false });
      await render();
      expect(tab("content").hasAttribute("aria-haspopup")).toBe(false);
      await click(tab("content"));
      await rightClick(tab("notes"));
      await key(tab("content"), "F2");
      expect(menu()).toBeNull();
      expect(nameInput()).toBeNull();
    });
  });

  describe("changed dot", () => {
    function dot(id: string) {
      return tab(id).querySelector("[data-block-field-changed]");
    }

    it("marks a tab another person changed until it is opened (TABS-9)", async () => {
      await render();
      expect(dot("notes")).toBeNull();

      setFields([content(), notes({ value: "Remote change", revision: 2 })]);
      await render();
      expect(dot("notes")).not.toBeNull();
      expect(tab("notes").textContent).toContain("editor.blockFieldChanged");
      expect(dot("content")).toBeNull();

      // A reload remembers what this browser last showed.
      await remount();
      expect(dot("notes")).not.toBeNull();

      await click(tab("notes"));
      expect(dot("notes")).toBeNull();
      await click(tab("content"));
      expect(dot("notes")).toBeNull();

      await remount();
      expect(dot("notes")).toBeNull();
    });

    it("does not mark a tab for this person's own save (TABS-9)", async () => {
      await render();
      await click(tab("notes"));
      await type("Notes text", "Mine");
      await click(tab("content"));

      setFields([content(), notes({ value: "Mine", revision: 2 })]);
      await render();
      expect(dot("notes")).toBeNull();
    });

    it("counts a field's first sighting as seen (TABS-9)", async () => {
      setFields([content(), notes({ value: "Remote change", revision: 9 })]);
      await render();
      expect(dot("notes")).toBeNull();
    });
  });
});
