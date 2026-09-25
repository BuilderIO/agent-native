// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import {
  ComposerContextMenu,
  getComposerContextMenuEntries,
  type ComposerContextMenuItem,
  type ComposerContextPageControls,
} from "./ComposerContextMenu.js";
import { snapshotComposerContextItems } from "./context-items.js";

const items: ComposerContextMenuItem[] = [
  {
    id: "documents",
    label: "Documents",
    searchPlaceholder: "Search documents…",
    children: [
      {
        id: "brief",
        label: "Project brief",
        keywords: ["launch"],
        onSelect() {},
      },
      {
        id: "archive",
        label: "Archive",
        children: [{ id: "notes", label: "Meeting notes", onSelect() {} }],
      },
    ],
  },
  {
    id: "library",
    label: "Library",
    children: [{ id: "reference", label: "Launch reference", onSelect() {} }],
  },
];

describe("composer context contracts", () => {
  it("retains scoped public search and inherited disabled state", () => {
    expect(
      getComposerContextMenuEntries(items, [], "").map((item) => item.id),
    ).toEqual(["documents", "library"]);
    expect(
      getComposerContextMenuEntries(items, [], "launch").map((item) => item.id),
    ).toEqual(["brief", "reference"]);
    expect(
      getComposerContextMenuEntries(items, ["documents"], "launch").map(
        (item) => item.id,
      ),
    ).toEqual(["brief"]);
    expect(
      getComposerContextMenuEntries(
        [{ ...items[0], disabled: true }],
        [],
        "brief",
      )[0].disabled,
    ).toBe(true);
    expect(getComposerContextMenuEntries(items, ["missing"], "")).toEqual([]);
  });
  it("copies and freezes selected context and rejects unready items", () => {
    const source = [{ key: "brief", title: "Brief", context: "original" }];
    const snapshot = snapshotComposerContextItems(source);
    source[0].context = "changed";
    expect(snapshot[0].context).toBe("original");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(snapshotComposerContextItems(undefined)).toBeUndefined();
    expect(snapshotComposerContextItems([])).toEqual([]);
    for (const status of ["pending", "error"] as const)
      expect(() =>
        snapshotComposerContextItems([
          { key: "bad", title: "Bad", context: "", status },
        ]),
      ).toThrow("not ready");
  });
});

describe("connected composer menus", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
      () => {},
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function render(
    entries = items,
    props: Partial<React.ComponentProps<typeof ComposerContextMenu>> = {},
  ) {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <input aria-label="Prompt draft" defaultValue="Keep this draft" />
          <ComposerContextMenu items={entries} {...props} />
        </TooltipProvider>,
      ),
    );
  }
  const menus = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'));
  const row = (label: string) => {
    const found = Array.from(
      document.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
    ).find((element) => element.textContent === label);
    expect(found, label).toBeDefined();
    return found!;
  };
  async function key(target: HTMLElement, key: string) {
    await act(async () => {
      target.focus();
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  const open = () =>
    key(
      container.querySelector('button[aria-label="Add context"]')!,
      "ArrowDown",
    );
  async function click(label: string) {
    await act(async () => row(label).click());
  }
  async function search(placeholder: string, value: string) {
    const input = document.querySelector<HTMLInputElement>(
      `input[placeholder="${placeholder}"]`,
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  it("keeps all anchored panels visible with category search overrides and w64", async () => {
    await render(items, { addAttachment: vi.fn() });
    await open();
    expect(
      document.querySelector('input[placeholder="Search…"]'),
    ).not.toBeNull();
    expect(row("Upload File").querySelector("svg")?.getAttribute("width")).toBe(
      "16",
    );
    await click("Add context");
    await click("Documents");
    await click("Archive");
    expect(menus()).toHaveLength(4);
    expect(menus().every((menu) => menu.classList.contains("w-64"))).toBe(true);
    expect(document.querySelectorAll('[role="searchbox"]')).toHaveLength(4);
    expect(
      document.querySelector('input[placeholder="Search documents…"]'),
    ).not.toBeNull();
    expect(row("Documents").getAttribute("aria-expanded")).toBe("true");
    expect(row("Meeting notes").getAttribute("role")).toBe("menuitem");
  });
  it("filters root and category search without flattening the hierarchy", async () => {
    const select = vi.fn();
    await render(
      [
        {
          id: "documents",
          label: "Documents",
          searchPlaceholder: "Search documents…",
          children: [
            { id: "brief", label: "Project brief", onSelect: select },
            { id: "notes", label: "Notes", onSelect() {} },
          ],
        },
        items[1],
      ],
      { addAttachment: vi.fn() },
    );
    await open();
    await search("Search…", "brief");
    expect(menus()[0].textContent).not.toContain("Upload File");
    await click("Add context");
    await search("Search context…", "documents");
    expect(menus()[1].textContent).not.toContain("Library");
    await click("Documents");
    await search("Search documents…", "brief");
    expect(menus()[2].textContent).not.toContain("Notes");
    await click("Project brief");
    expect(select).toHaveBeenCalledOnce();
    expect(menus()).toHaveLength(0);
  });
  it("keeps typing out of typeahead and supports native ArrowRight, Left and Escape", async () => {
    await render();
    await open();
    const input =
      document.querySelector<HTMLInputElement>('[role="searchbox"]')!;
    await key(input, "d");
    expect(document.activeElement).toBe(input);
    await key(input, "ArrowDown");
    expect(document.activeElement).toBe(row("Add context"));
    await key(row("Add context"), "ArrowRight");
    await key(row("Documents"), "ArrowRight");
    expect(menus()).toHaveLength(3);
    await key(row("Project brief"), "ArrowDown");
    expect(document.activeElement).toBe(row("Archive"));
    await key(row("Archive"), "ArrowLeft");
    expect(menus()).toHaveLength(2);
    expect(document.activeElement).toBe(row("Documents"));
    await key(row("Documents"), "Escape");
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(row("Add context"));
  });
  it("preserves native upload accepts, cancellation, multiple files and errors", async () => {
    const attach = vi
      .fn()
      .mockRejectedValueOnce(new Error("Upload unavailable"))
      .mockResolvedValue(undefined);
    const error = vi.fn();
    await render([], {
      addAttachment: attach,
      attachmentAccept: "text/plain",
      onAttachmentError: error,
    });
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const picker = vi.spyOn(input, "click");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("text/plain");
    await open();
    await click("Upload File");
    expect(picker).toHaveBeenCalledOnce();
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(attach).not.toHaveBeenCalled();
    const files = [new File(["one"], "one.txt"), new File(["two"], "two.txt")];
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(attach.mock.calls.map(([file]) => file)).toEqual(files);
    expect(error).toHaveBeenCalledWith("Upload unavailable");
  });
  it("preserves legacy render, latest updates, dismissal and resume without reselecting", async () => {
    let controls!: ComposerContextPageControls;
    const select = vi.fn();
    const dismiss = vi.fn();
    const legacy = (text: string): ComposerContextMenuItem[] => [
      {
        id: "legacy",
        label: "Reference",
        onSelect: select,
        onDismiss: dismiss,
        render(next) {
          controls = next;
          return <input aria-label="Reference URL" defaultValue={text} />;
        },
      },
    ];
    await render(legacy("first"));
    const draft = container.querySelector('[aria-label="Prompt draft"]');
    await open();
    await click("Add context");
    await click("Reference");
    expect(select).toHaveBeenCalledOnce();
    const resume = controls.onResume;
    await act(async () => controls.onClose({ restoreFocus: false }));
    expect(dismiss).toHaveBeenCalledOnce();
    await render(legacy("updated"));
    await act(async () => resume());
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Reference URL"]')
        ?.value,
    ).toBe("updated");
    expect(select).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="Prompt draft"]')).toBe(draft);
    await act(async () => controls.onBack());
    expect(menus()).toHaveLength(2);
    expect(dismiss).toHaveBeenCalledTimes(2);
  });
  it("ignores stale legacy close and reports resume of a removed source", async () => {
    let controls!: ComposerContextPageControls;
    const dismiss = vi.fn();
    await render([
      {
        id: "legacy",
        label: "Reference",
        onSelect() {},
        onDismiss: dismiss,
        render(next) {
          controls = next;
          return <input />;
        },
      },
    ]);
    await open();
    await click("Add context");
    await click("Reference");
    const old = controls;
    await act(async () => controls.onBack());
    await act(async () => old.onClose());
    expect(menus()).toHaveLength(2);
    await render([]);
    await act(async () => old.onResume());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not add context.",
    );
    expect(dismiss).toHaveBeenCalledOnce();
  });
  it.each(["sync", "async"])(
    "reports %s legacy errors without losing the picker",
    async (kind) => {
      await render([
        {
          id: "error",
          label: "Reference",
          render: () => <input />,
          onSelect() {
            if (kind === "sync") throw new Error("Reference unavailable");
            return Promise.reject(new Error("Reference unavailable"));
          },
        },
      ]);
      await open();
      await click("Add context");
      await click("Reference");
      expect(menus()).toHaveLength(3);
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "Reference unavailable",
      );
    },
  );
});
