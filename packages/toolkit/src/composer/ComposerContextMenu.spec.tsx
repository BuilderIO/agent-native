// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import {
  ComposerContextMenu,
  getComposerContextMenuEntries,
  type ComposerContextPickerConfig,
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
  const openRoot = () =>
    key(
      container.querySelector('button[aria-label="Add context"]')!,
      "ArrowDown",
    );
  const open = async () => {
    await openRoot();
    if (document.querySelector('[role="menuitem"][aria-haspopup="menu"]'))
      await key(row("Add context"), "ArrowRight");
  };
  async function click(label: string) {
    await act(async () => row(label).click());
  }
  it("keeps the root menu compact and puts context choices in nested menus", async () => {
    await render(items, { addAttachment: vi.fn() });
    await openRoot();
    expect(document.querySelectorAll('[role="searchbox"]')).toHaveLength(0);
    expect(row("Upload File").querySelector("svg")).not.toBeNull();
    expect(row("Add context").getAttribute("aria-haspopup")).toBe("menu");
    expect(menus()).toHaveLength(1);
    expect(menus()[0].classList.contains("w-64")).toBe(true);
    await key(row("Add context"), "ArrowRight");
    expect(row("Documents")).toBeDefined();
    expect(row("Library")).toBeDefined();
    expect(document.querySelectorAll('[role="searchbox"]')).toHaveLength(0);
    expect(menus()).toHaveLength(2);
  });
  it("hides the Add context tooltip while the host storage popover is open", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await render(items);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add context"]',
    );
    expect(trigger).toBeDefined();
    await render(items, { contextButtonTooltipDisabled: true });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(warning).not.toHaveBeenCalledWith(
      expect.stringContaining(
        "Tooltip is changing from uncontrolled to controlled",
      ),
    );
  });
  it("navigates nested category menus without a root search field", async () => {
    await render([
      {
        id: "apps",
        label: "Workspace apps",
        children: [
          {
            id: "design",
            label: "Design",
            description: "Interactive prototypes",
            onSelect: vi.fn(),
          },
        ],
      },
    ]);
    await open();
    expect(document.querySelector('[role="searchbox"]')).toBeNull();
    expect(row("Workspace apps")).toBeDefined();
    await key(row("Workspace apps"), "ArrowRight");
    expect(row("DesignInteractive prototypes")).toBeDefined();
    expect(menus()).toHaveLength(3);
    await key(row("DesignInteractive prototypes"), "Enter");
    expect(menus()).toHaveLength(0);
  });
  it.each([280, 324, 348, 700])(
    "keeps the shared menu compact in a %ipx composer frame",
    async (width) => {
      container.dataset.agentComposerSlot = "root";
      await render();
      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Add context"]',
      )!;
      vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
        x: 100,
        y: 300,
        left: 100,
        top: 300,
        right: 100 + width,
        bottom: 450,
        width,
        height: 150,
        toJSON() {},
      });
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
        x: 120,
        y: 400,
        left: 120,
        top: 400,
        right: 148,
        bottom: 428,
        width: 28,
        height: 28,
        toJSON() {},
      });
      await openRoot();
      expect(menus()[0].classList.contains("w-64")).toBe(true);
      expect(menus()[0].style.width).toBe("");
      expect(menus()[0].style.maxHeight).toBe("280px");
    },
  );
  it.each([
    [8, "bottom", 240],
    [40, "bottom", 208],
    [100, "top", 136],
    [180, "top", 216],
  ] as const)(
    "keeps actions reachable at plus-button top %ipx in a short viewport",
    async (top, side, maxHeight) => {
      const previousHeight = window.innerHeight;
      window.innerHeight = 360;
      vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(
        360,
      );
      vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
        window.innerWidth,
      );
      container.dataset.agentComposerSlot = "root";
      await render();
      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Add context"]',
      )!;
      vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ x: 16, y: top, width: 280, height: 100 }),
      );
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ x: 24, y: top + 60, width: 28, height: 28 }),
      );
      try {
        await openRoot();
        expect(menus()[0].style.maxHeight).toBe(`${maxHeight}px`);
        expect(menus()[0].getAttribute("data-side")).toBe(side);
        expect(menus()[0].querySelector('[role="menuitem"]')).not.toBeNull();
        expect(menus()[0].querySelector(".overflow-y-auto")).not.toBeNull();
      } finally {
        window.innerHeight = previousHeight;
      }
    },
  );
  it("remeasures the visible viewport on keyboard and zoom changes and cleans up listeners", async () => {
    const viewport = Object.assign(new EventTarget(), {
      offsetTop: 80,
      offsetLeft: 0,
      height: 360,
      width: 324,
      scale: 1,
    });
    const previousViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    const removeListener = vi.spyOn(viewport, "removeEventListener");
    container.dataset.agentComposerSlot = "root";
    await render();
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add context"]',
    )!;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 16, y: 90, width: 280, height: 100 }),
    );
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 24, y: 150, width: 28, height: 28 }),
    );
    try {
      await openRoot();
      expect(menus()[0].style.maxHeight).toBe("238px");
      await act(async () => {
        viewport.offsetTop = 0;
        viewport.height = 240;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(menus()[0].style.maxHeight).toBe("126px");
      await act(async () => {
        viewport.offsetTop = 80;
        viewport.dispatchEvent(new Event("scroll"));
      });
      expect(menus()[0].style.maxHeight).toBe("118px");
      await key(row("Add context"), "Escape");
      expect(removeListener).toHaveBeenCalledWith(
        "resize",
        expect.any(Function),
      );
      expect(removeListener).toHaveBeenCalledWith(
        "scroll",
        expect.any(Function),
      );
    } finally {
      if (previousViewport)
        Object.defineProperty(window, "visualViewport", previousViewport);
      else Reflect.deleteProperty(window, "visualViewport");
    }
  });
  it("uses the composer's RTL direction for portaled menu and submenu keyboard navigation", async () => {
    container.dataset.agentComposerSlot = "root";
    container.style.direction = "rtl";
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 300, width: 324, height: 150 }),
    );
    await render([
      {
        id: "source",
        label: "Source",
        picker: {
          searchPlaceholder: "Search source",
          items: [{ id: "one", title: "One" }],
          onSelect: vi.fn(),
        },
      },
    ]);
    await openRoot();
    await key(row("Add context"), "ArrowLeft");
    expect(menus()[0].getAttribute("dir")).toBe("rtl");
    await key(row("Source"), "ArrowLeft");
    expect(row("One")).toBeDefined();
    expect(menus()[1].getAttribute("dir")).toBe("rtl");
  });
  it("follows host resizing while keeping nested context menus open", async () => {
    const observations: {
      target: Element;
      resize: () => void;
      disconnect: () => void;
    }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private resize: () => void) {}
        observe(target: Element) {
          observations.push({
            target,
            resize: this.resize,
            disconnect: this.disconnect,
          });
        }
        unobserve() {}
        disconnect = vi.fn();
      },
    );
    container.dataset.agentComposerSlot = "root";
    let width = 700;
    vi.spyOn(container, "getBoundingClientRect").mockImplementation(() =>
      DOMRect.fromRect({ x: 100, y: 300, width, height: 150 }),
    );
    await render();
    await open();
    await key(row("Documents"), "ArrowRight");
    const observation = observations.find(
      ({ target }) => target === container,
    )!;
    expect(observation).toBeDefined();
    for (width of [348, 280, 700]) {
      await act(async () => observation.resize());
      expect(menus()[0].style.width).toBe("");
      expect(menus()[0].classList.contains("w-64")).toBe(true);
      expect(row("Project brief")).toBeDefined();
    }
    await key(row("Project brief"), "Escape");
    await key(row("Documents"), "Escape");
    await key(row("Add context"), "Escape");
    expect(observation.disconnect).toHaveBeenCalled();
  });
  it("closes a context picker when its composer becomes disabled", async () => {
    const onDismiss = vi.fn();
    const picker = {
      presentation: {
        type: "dialog" as const,
        mode: "multiple" as const,
        onAttach: vi.fn(),
      },
      searchPlaceholder: "Search sources",
      scopeKey: "account",
      load: async () => ({ items: [], hasMore: false }),
    } satisfies ComposerContextPickerConfig;
    const entries: ComposerContextMenuItem[] = [
      { id: "source", label: "Source", picker, onDismiss },
    ];
    let draft: HTMLInputElement | null = null;
    const onDisabledFocus = vi.fn(() => draft?.focus());
    await render(entries, { onDisabledFocus });
    draft = document.querySelector<HTMLInputElement>(
      'input[aria-label="Prompt draft"]',
    );
    await open();
    await click("Source");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await render(entries, { disabled: true, onDisabledFocus });
    await act(
      async () =>
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        ),
    );

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDisabledFocus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(draft);
  });
  it("preserves nested category levels through selection", async () => {
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
    expect(row("Documents")).toBeDefined();
    expect(row("Library")).toBeDefined();
    expect(
      menus().some((menu) => menu.textContent?.includes("Project brief")),
    ).toBe(false);
    expect(document.querySelectorAll('[role="searchbox"]')).toHaveLength(0);
    await key(row("Documents"), "ArrowRight");
    expect(row("Project brief")).toBeDefined();
    expect(row("Notes")).toBeDefined();
    expect(menus()).toHaveLength(3);
    await click("Project brief");
    expect(select).toHaveBeenCalledOnce();
    expect(menus()).toHaveLength(0);
  });
  it("supports native keyboard navigation across nested context menus", async () => {
    await render();
    await openRoot();
    await key(row("Add context"), "ArrowRight");
    await key(row("Documents"), "ArrowRight");
    expect(menus()).toHaveLength(3);
    await key(row("Project brief"), "ArrowDown");
    expect(document.activeElement).toBe(row("Archive"));
    await key(row("Archive"), "ArrowRight");
    expect(row("Meeting notes")).toBeDefined();
    expect(menus()).toHaveLength(4);
    await key(row("Meeting notes"), "Escape");
    expect(menus()).toHaveLength(3);
    await key(row("Archive"), "Escape");
    expect(menus()).toHaveLength(2);
    await key(row("Documents"), "Escape");
    expect(menus()).toHaveLength(1);
    await key(row("Add context"), "Escape");
    expect(menus()).toHaveLength(0);
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
    await openRoot();
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
  it("requests gated upload after the menu closes", async () => {
    const onAttachmentRequest = vi.fn();
    await render([], { onAttachmentRequest });
    await openRoot();
    await click("Upload File");
    await act(
      async () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(onAttachmentRequest).toHaveBeenCalledOnce();
    expect(menus()).toHaveLength(0);
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
      await click("Reference");
      expect(menus()).toHaveLength(3);
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "Reference unavailable",
      );
    },
  );
});
