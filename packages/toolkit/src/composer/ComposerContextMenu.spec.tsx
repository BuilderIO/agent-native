// @vitest-environment happy-dom

import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "../ui/command.js";
import { TooltipProvider } from "../ui/tooltip.js";
import {
  ComposerContextMenu,
  ComposerContextSearchInput,
  getComposerContextMenuEntries,
  type ComposerContextMenuItem,
  type ComposerContextPageControls,
} from "./ComposerContextMenu.js";
import { snapshotComposerContextItems } from "./context-items.js";

const items: ComposerContextMenuItem[] = [
  {
    id: "documents",
    label: "Documents",
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

describe("composer context", () => {
  it("shows categories initially and searches all leaves at root", () => {
    expect(
      getComposerContextMenuEntries(items, [], "").map((item) => item.id),
    ).toEqual(["documents", "library"]);
    expect(
      getComposerContextMenuEntries(items, [], "launch").map((item) => item.id),
    ).toEqual(["brief", "reference"]);
    expect(
      getComposerContextMenuEntries(items, [], "documents").map(
        (item) => item.id,
      ),
    ).toEqual(["brief", "notes"]);
  });

  it("scopes category search and drill-in, and preserves inherited disabled state", () => {
    expect(
      getComposerContextMenuEntries(items, ["documents"], "launch").map(
        (item) => item.id,
      ),
    ).toEqual(["brief"]);
    expect(
      getComposerContextMenuEntries(items, ["documents", "archive"], "").map(
        (item) => item.id,
      ),
    ).toEqual(["notes"]);
    expect(
      getComposerContextMenuEntries(
        [{ ...items[0], disabled: true }],
        [],
        "brief",
      )[0].disabled,
    ).toBe(true);
    expect(getComposerContextMenuEntries(items, ["missing"], "")).toEqual([]);
  });

  it("copies and freezes selected context and rejects every unready item", () => {
    const source = [{ key: "brief", title: "Brief", context: "original" }];
    const snapshot = snapshotComposerContextItems(source);
    source[0].context = "changed";
    source.length = 0;
    expect(snapshot[0].context).toBe("original");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(snapshotComposerContextItems(undefined)).toBeUndefined();
    expect(snapshotComposerContextItems([])).toEqual([]);
    for (const status of ["pending", "error"] as const) {
      expect(() =>
        snapshotComposerContextItems([
          { key: "bad", title: "Bad", context: "", status },
        ]),
      ).toThrow("not ready");
    }
  });

  it("drills in and back in one popover, selects an action, and uses the composer attachment callback", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const select = vi.fn();
    const attach = vi.fn().mockResolvedValue(undefined);
    const scroll = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    try {
      await act(async () =>
        root.render(
          <TooltipProvider>
            <ComposerContextMenu
              items={[
                {
                  id: "category",
                  label: "Documents",
                  children: [{ id: "brief", label: "Brief", onSelect: select }],
                },
              ]}
              addAttachment={attach}
            />
          </TooltipProvider>,
        ),
      );
      const open = async () => {
        await act(async () =>
          container
            .querySelector<HTMLButtonElement>(
              'button[aria-label="Add context"]',
            )!
            .click(),
        );
      };
      await open();
      expect(document.body.textContent).toContain("Attach files");
      await act(async () =>
        document
          .querySelector<HTMLElement>('[cmdk-item][data-value="category"]')!
          .click(),
      );
      expect(
        document.querySelectorAll(
          '[data-agent-native-composer-popover="true"]',
        ),
      ).toHaveLength(1);
      expect(document.body.textContent).toContain("Brief");
      expect(document.body.textContent).not.toContain("Attach files");
      const back = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Back"]',
      )!;
      const enter = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        back.focus();
        back.dispatchEvent(enter);
      });
      expect(enter.defaultPrevented).toBe(false);
      expect(select).not.toHaveBeenCalled();
      await act(async () => back.click());
      expect(document.body.textContent).toContain("Documents");
      await act(async () =>
        document
          .querySelector<HTMLElement>('[cmdk-item][data-value="category"]')!
          .click(),
      );
      await act(async () =>
        document
          .querySelector<HTMLElement>('[cmdk-item][data-value="brief"]')!
          .click(),
      );
      expect(select).toHaveBeenCalledOnce();
      expect(
        document.querySelector('[data-agent-native-composer-popover="true"]'),
      ).toBeNull();
      await open();
      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]')!;
      const picker = vi.spyOn(input, "click");
      await act(async () =>
        document
          .querySelector<HTMLElement>(
            '[cmdk-item][data-value="native-attach-files"]',
          )!
          .click(),
      );
      expect(picker).toHaveBeenCalledOnce();
      const file = new File(["brief"], "brief.txt", { type: "text/plain" });
      Object.defineProperty(input, "files", {
        value: [file],
        configurable: true,
      });
      await act(async () =>
        input.dispatchEvent(new Event("change", { bubbles: true })),
      );
      expect(attach).toHaveBeenCalledWith(file);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      scroll.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe("rendered composer context pages", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let controls: ComposerContextPageControls;
  let selected: ReturnType<typeof vi.fn<() => void | Promise<void>>>;
  let dismissed: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
      () => {},
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    selected = vi.fn();
    dismissed = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function pageItems(
    content: ReactNode = "Ready reference",
    onSelect: () => void | Promise<void> = selected,
  ): ComposerContextMenuItem[] {
    return [
      {
        id: "category",
        label: "Documents",
        children: [
          {
            id: "picker",
            label: "Choose reference",
            onSelect,
            onDismiss: dismissed,
            render: (next) => {
              controls = next;
              return (
                <Command>
                  <ComposerContextSearchInput
                    onBack={next.onBack}
                    placeholder="Search references"
                  />
                  <CommandList>
                    <CommandGroup>
                      <CommandItem onSelect={() => next.onClose()}>
                        {content}
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              );
            },
          },
        ],
      },
    ];
  }

  async function render(items = pageItems()) {
    await act(async () =>
      root.render(
        <TooltipProvider>
          <input aria-label="Prompt draft" defaultValue="Keep this draft" />
          <ComposerContextMenu items={items} />
        </TooltipProvider>,
      ),
    );
  }

  async function click(selector: string) {
    const target = document.querySelector<HTMLElement>(selector);
    expect(target, selector).not.toBeNull();
    await act(async () => target!.click());
  }

  async function openPage() {
    await click('button[aria-label="Add context"]');
    await click('[cmdk-item][data-value="category"]');
    await click('[cmdk-item][data-value="picker"]');
  }

  const popover = () =>
    document.querySelector('[data-agent-native-composer-popover="true"]');

  it("opens the host synchronously and renders async updates in the same popover without remounting the composer", async () => {
    function Host() {
      const [view, setView] = useState("closed");
      const entries = pageItems(view, () => {
        selected();
        setView("Loading references");
      });
      return <ComposerContextMenu items={entries} />;
    }
    await act(async () =>
      root.render(
        <TooltipProvider>
          <Host />
        </TooltipProvider>,
      ),
    );
    await click('button[aria-label="Add context"]');
    const originalPopover = popover();
    await click('[cmdk-item][data-value="category"]');
    await click('[cmdk-item][data-value="picker"]');
    expect(selected).toHaveBeenCalledOnce();
    expect(popover()).toBe(originalPopover);
    expect(popover()?.textContent).toContain("Loading references");

    await render();
    const draft = container.querySelector('input[aria-label="Prompt draft"]');
    await openPage();
    const activePopover = popover();
    await render(pageItems("Resolved reference"));
    expect(popover()).toBe(activePopover);
    expect(popover()?.textContent).toContain("Resolved reference");
    expect(container.querySelector('input[aria-label="Prompt draft"]')).toBe(
      draft,
    );
    await act(async () => controls.onBack());
    expect(popover()).toBe(activePopover);
    expect(popover()?.textContent).toContain("Choose reference");
    expect(dismissed).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.querySelector("[cmdk-input]"));
  });

  it("resolves a searched leaf's latest render by ID and goes back to its originating root", async () => {
    await render();
    await click('button[aria-label="Add context"]');
    const search = document.querySelector<HTMLInputElement>("[cmdk-input]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "reference");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      document.querySelector('[cmdk-item][data-value="category"]'),
    ).toBeNull();
    const original = popover();
    await click('[cmdk-item][data-value="picker"]');
    await render(pageItems("Fresh search result"));
    expect(popover()).toBe(original);
    expect(popover()?.textContent).toContain("Fresh search result");
    await click('button[aria-label="Back"]');
    expect(popover()?.textContent).toContain("Documents");
    expect(
      document.querySelector<HTMLInputElement>("[cmdk-input]")?.value,
    ).toBe("");
  });

  it("resumes the captured page and category without reselecting or dismissing the host view", async () => {
    await render();
    await openPage();
    const resume = controls.onResume;
    await act(async () => controls.onClose());
    expect(popover()).toBeNull();
    expect(dismissed).toHaveBeenCalledOnce();
    await click('button[aria-label="Add context"]');
    expect(popover()?.textContent).toContain("Documents");
    await click('button[aria-label="Add context"]');
    const newSelect = vi.fn();
    const newDismiss = vi.fn();
    selected = newSelect;
    dismissed = newDismiss;
    await render(pageItems("Newly created reference"));
    await act(async () => resume());
    expect(popover()?.textContent).toContain("Newly created reference");
    expect(newSelect).not.toHaveBeenCalled();
    expect(newDismiss).not.toHaveBeenCalled();
    await act(async () => controls.onBack());
    expect(popover()?.textContent).toContain("Choose reference");
    expect(newDismiss).toHaveBeenCalledOnce();
  });

  it("dismisses on Escape once and resets the next opening to root", async () => {
    await render();
    await openPage();
    const latestDismiss = vi.fn();
    dismissed = latestDismiss;
    await render();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(popover()).toBeNull();
    expect(latestDismiss).toHaveBeenCalledOnce();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-label="Add context"]'),
    );
    await click('button[aria-label="Add context"]');
    expect(popover()?.textContent).toContain("Documents");
    expect(document.querySelector('button[aria-label="Back"]')).toBeNull();
  });

  it("cancels a removed page and refuses to resume an unavailable action", async () => {
    await render();
    await openPage();
    const resume = controls.onResume;
    await render([]);
    expect(dismissed).toHaveBeenCalledOnce();
    expect(popover()?.textContent).not.toContain("Ready reference");
    await act(async () => resume());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not add context.",
    );
    expect(selected).toHaveBeenCalledOnce();
  });

  it("keeps an active picker through disabled host loading states", async () => {
    await render();
    await openPage();
    const original = popover();
    await render(
      pageItems("Refreshing").map((item) => ({ ...item, disabled: true })),
    );
    expect(popover()).toBe(original);
    expect(popover()?.textContent).toContain("Refreshing");
    expect(dismissed).not.toHaveBeenCalled();
    await render(pageItems("Ready again"));
    expect(popover()?.textContent).toContain("Ready again");
  });

  it.each([false, true])(
    "focuses URL pages with explicit autofocus=%s",
    async (explicit) => {
      await render([
        {
          id: "url",
          label: "Attach URL",
          onSelect: selected,
          render: () => (
            <>
              <button type="button">Back</button>
              {explicit ? <input aria-label="Other field" /> : null}
              <input
                type="url"
                aria-label="Reference URL"
                data-autofocus={explicit ? "" : undefined}
              />
            </>
          ),
        },
      ]);
      await click('button[aria-label="Add context"]');
      await click('[cmdk-item][data-value="url"]');
      expect(document.activeElement).toBe(
        document.querySelector('input[type="url"]'),
      );
    },
  );

  it("dismisses on outside interaction and preserves the draft", async () => {
    await render();
    await openPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () =>
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "mouse",
        }),
      ),
    );
    await act(async () => document.body.click());
    expect(popover()).toBeNull();
    expect(dismissed).toHaveBeenCalledOnce();
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Prompt draft"]',
      )?.value,
    ).toBe("Keep this draft");
  });

  it("preserves native multiple attachments, cancellation, and error reporting", async () => {
    const attach =
      vi.fn<
        NonNullable<
          React.ComponentProps<typeof ComposerContextMenu>["addAttachment"]
        >
      >();
    const error = vi.fn();
    await act(async () =>
      root.render(
        <TooltipProvider>
          <ComposerContextMenu
            items={[]}
            addAttachment={attach}
            attachmentAccept="text/plain"
            onAttachmentError={error}
          />
        </TooltipProvider>,
      ),
    );
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("text/plain");
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(attach).not.toHaveBeenCalled();
    const files = [new File(["one"], "one.txt"), new File(["two"], "two.txt")];
    attach
      .mockRejectedValueOnce(new Error("Upload unavailable"))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(attach.mock.calls.map(([file]) => file)).toEqual(files);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Upload unavailable",
    );
    expect(error).toHaveBeenCalledWith("Upload unavailable");
  });

  it.each(["sync", "async"])(
    "shows %s action failures without closing the picker",
    async (kind) => {
      selected.mockImplementation(() => {
        if (kind === "sync") throw new Error("Reference unavailable");
        return Promise.reject(new Error("Reference unavailable"));
      });
      await render();
      await openPage();
      expect(popover()).not.toBeNull();
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "Reference unavailable",
      );
    },
  );

  it("keeps the Back button inside the input header and preserves native Enter and Space", async () => {
    await render();
    await openPage();
    const back = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Back"]',
    )!;
    expect(back.closest("[cmdk-input-wrapper]")).not.toBeNull();
    expect(back.textContent).toBe("");
    for (const key of ["Enter", " "]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        back.focus();
        back.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(dismissed).not.toHaveBeenCalled();
    }
    await act(async () => back.click());
    expect(dismissed).toHaveBeenCalledOnce();
    expect(popover()?.textContent).toContain("Choose reference");
  });
});
