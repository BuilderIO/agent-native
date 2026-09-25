// @vitest-environment happy-dom

import {
  DesignSystemContext,
  Dialog,
} from "@agent-native/toolkit/design-system";
import { act, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { TemplateLibraryCard } from "./TemplateLibraryGrid.js";
import { TemplatePreviewDialog } from "./TemplatePreviewDialog.js";

const labels = {
  close: "Close preview",
  loading: "Loading preview",
  empty: "No preview available",
  retry: "Retry",
  thumbnails: "Slides",
};
const thumbnails = [
  { id: "one", title: "Overview", preview: <img alt="" src="/one.png" /> },
  { id: "two", title: "Unavailable", preview: null, disabled: true },
  { id: "three", title: "Details", preview: <img alt="" src="/three.png" /> },
];
const props = { open: true, onOpenChange: vi.fn(), title: "Pitch", labels };

describe("template preview dialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const render = async (node: ReactNode) => {
    await act(async () => {
      root.render(node);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  };
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLElement>("button, [role=button]")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent === label,
    )!;
  const key = (element: HTMLElement, value: string) =>
    act(() =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

  it("opens a title-only semantic dialog without a dangling description or a use action", async () => {
    const warning = vi.spyOn(console, "warn");
    await render(
      <TemplatePreviewDialog {...props} open={false}>
        <div>Real preview</div>
      </TemplatePreviewDialog>,
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await render(
      <TemplatePreviewDialog {...props}>
        <div>Real preview</div>
      </TemplatePreviewDialog>,
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("data-size")).toBe("viewport");
    expect(
      document.getElementById(dialog.getAttribute("aria-labelledby")!)
        ?.textContent,
    ).toBe("Pitch");
    expect(dialog.hasAttribute("aria-describedby")).toBe(false);
    expect(dialog.textContent).toContain("Real preview");
    expect(dialog.querySelector("nav")).toBeNull();
    expect(
      [...dialog.querySelectorAll("button")].map(
        (element) => element.textContent,
      ),
    ).toEqual([labels.close]);
    expect(warning).not.toHaveBeenCalled();
  });

  it("preserves the semantic description association when supplied", async () => {
    await render(
      <Dialog
        open
        onOpenChange={vi.fn()}
        title="Preview"
        description="Saved content"
      >
        <div>Content</div>
      </Dialog>,
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Saved content");
  });

  it("keeps direct card activation separate from the caption menu preview handoff", async () => {
    const copy = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      const pending = useRef(false);
      const trigger = useRef<HTMLButtonElement>(null);
      return (
        <>
          <TemplateLibraryCard
            item={{
              id: "one",
              title: "A long stored template title for a narrow card",
              description: "A stored description beneath the title",
            }}
            preview={<img alt="Template thumbnail" src="/one.png" />}
            onSelect={copy}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button ref={trigger} aria-label="Template options">
                    ...
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  onCloseAutoFocus={(event) => {
                    if (!pending.current) return;
                    event.preventDefault();
                    pending.current = false;
                    setOpen(true);
                  }}
                >
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onSelect={() => {
                        pending.current = true;
                      }}
                    >
                      Preview
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          <TemplatePreviewDialog
            {...props}
            open={open}
            onOpenChange={setOpen}
            restoreFocusRef={trigger}
          >
            <div>Large rendered content</div>
          </TemplatePreviewDialog>
        </>
      );
    }
    await render(<Harness />);
    act(() => {
      container.querySelector("img")!.click();
      container.querySelector("h3")!.click();
    });
    expect(copy).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe(
      "A stored description beneath the title",
    );
    const trigger = button("Template options");
    expect(trigger.closest('[role="button"]')).toBeNull();
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await act(async () =>
      document.querySelector<HTMLElement>('[role="menuitem"]')!.click(),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Large rendered content",
    );
    expect(copy).toHaveBeenCalledTimes(2);
    await act(async () => button(labels.close).click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(document.activeElement).toBe(trigger);
  });

  it.each(["Escape", "close"])(
    "restores focus and retains the draft after %s dismissal",
    async (dismissal) => {
      function Harness() {
        const [open, setOpen] = useState(false);
        const trigger = useRef<HTMLButtonElement>(null);
        const initial = useRef<HTMLButtonElement>(null);
        return (
          <>
            <textarea defaultValue="Unsaved prompt" />
            <button ref={trigger} onClick={() => setOpen(true)}>
              Preview
            </button>
            <TemplatePreviewDialog
              {...props}
              open={open}
              onOpenChange={setOpen}
              restoreFocusRef={trigger}
              initialFocusRef={initial}
            >
              <button ref={initial}>Inspect content</button>
            </TemplatePreviewDialog>
          </>
        );
      }
      await render(<Harness />);
      const draft = container.querySelector("textarea")!;
      const trigger = button("Preview");
      await act(async () => {
        trigger.focus();
        trigger.click();
      });
      expect(document.activeElement).toBe(button("Inspect content"));
      await act(async () => {
        if (dismissal === "Escape")
          document.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        else button(labels.close).click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(container.querySelector("textarea")).toBe(draft);
      expect(draft.value).toBe("Unsaved prompt");
    },
  );

  it("selects rail items with arrows, Home, End, and click while skipping disabled thumbnails", async () => {
    function Harness() {
      const [selectedId, setSelectedId] = useState("one");
      return (
        <TemplatePreviewDialog
          {...props}
          thumbnails={thumbnails}
          selectedId={selectedId}
          onSelectedIdChange={setSelectedId}
        >
          <div data-current>{selectedId}</div>
        </TemplatePreviewDialog>
      );
    }
    await render(<Harness />);
    const first = button("Overview");
    const last = button("Details");
    const disabled = button("Unavailable");
    expect(document.querySelector("nav")?.getAttribute("aria-label")).toBe(
      labels.thumbnails,
    );
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    act(() => {
      first.focus();
      disabled.click();
    });
    expect(first.getAttribute("aria-pressed")).toBe("true");
    for (const direction of ["ArrowRight", "ArrowDown", "End"]) {
      key(first, direction);
      expect(document.activeElement).toBe(last);
      expect(last.getAttribute("aria-pressed")).toBe("true");
      key(last, "Home");
      expect(document.activeElement).toBe(first);
    }
    key(first, "ArrowLeft");
    expect(document.activeElement).toBe(last);
    key(last, "ArrowUp");
    expect(document.activeElement).toBe(first);
    act(() => last.click());
    expect(document.querySelector("[data-current]")?.textContent).toBe("three");
  });

  it("keeps rail previews inert and does not intercept keys in main content", async () => {
    const select = vi.fn();
    await render(
      <TemplatePreviewDialog
        {...props}
        thumbnails={thumbnails}
        selectedId="one"
        onSelectedIdChange={select}
      >
        <input aria-label="Preview field" />
      </TemplatePreviewDialog>,
    );
    expect(
      document.querySelector("nav img")?.closest("[inert]"),
    ).not.toBeNull();
    const input = document.querySelector("input")!;
    act(() => input.focus());
    key(input, "ArrowRight");
    expect(document.activeElement).toBe(input);
    expect(select).not.toHaveBeenCalled();
  });

  it("renders exactly one readiness state and hides unready content and rail", async () => {
    const base = {
      ...props,
      thumbnails,
      selectedId: "one",
      onSelectedIdChange: vi.fn(),
    };
    await render(
      <TemplatePreviewDialog {...base} loading empty>
        <div>Stale content</div>
      </TemplatePreviewDialog>,
    );
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(
      document.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe(labels.loading);
    expect(document.body.textContent).not.toContain(labels.empty);
    expect(document.body.textContent).not.toContain("Stale content");
    expect(document.querySelector("nav")).toBeNull();
    await render(
      <TemplatePreviewDialog
        {...base}
        loading
        empty
        error="Preview unavailable"
      >
        <div>Stale content</div>
      </TemplatePreviewDialog>,
    );
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.querySelector('[role="status"]')).toBeNull();
    await render(
      <TemplatePreviewDialog {...base} empty>
        <div>Stale content</div>
      </TemplatePreviewDialog>,
    );
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      labels.empty,
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await render(
      <TemplatePreviewDialog {...base}>
        <div>Ready content</div>
      </TemplatePreviewDialog>,
    );
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.body.textContent).toContain("Ready content");
    expect(document.querySelector("nav")).not.toBeNull();
  });

  it("exposes retry without allowing duplicate pending requests", async () => {
    const retry = vi.fn();
    await render(
      <TemplatePreviewDialog {...props} error="Read failed" onRetry={retry}>
        <div>Content</div>
      </TemplatePreviewDialog>,
    );
    act(() => button(labels.retry).click());
    expect(retry).toHaveBeenCalledOnce();
    await render(
      <TemplatePreviewDialog
        {...props}
        error="Read failed"
        onRetry={retry}
        loading
      >
        <div>Content</div>
      </TemplatePreviewDialog>,
    );
    expect((button(labels.retry) as HTMLButtonElement).disabled).toBe(true);
    act(() => button(labels.retry).click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it("honors custom semantic Dialog and native-button Surface implementations", async () => {
    const dialog = vi.fn();
    const select = vi.fn();
    await render(
      <DesignSystemContext.Provider
        value={{
          definition: {
            components: {
              Dialog: (value) => {
                dialog(value);
                return value.open ? (
                  <section aria-label="Company dialog">
                    {value.children}
                  </section>
                ) : null;
              },
              Surface: ({ children, interactive, onPress, ...aria }) =>
                interactive ? (
                  <button
                    aria-label={aria["aria-label"]}
                    aria-pressed={aria["aria-pressed"]}
                    onClick={() => onPress?.()}
                  >
                    {children}
                  </button>
                ) : (
                  <div>{children}</div>
                ),
            },
          },
        }}
      >
        <TemplatePreviewDialog
          {...props}
          size="large"
          thumbnails={thumbnails}
          selectedId="one"
          onSelectedIdChange={select}
        >
          <div>Rendered design</div>
        </TemplatePreviewDialog>
      </DesignSystemContext.Provider>,
    );
    expect(dialog).toHaveBeenCalledWith(
      expect.objectContaining({
        size: "large",
        title: "Pitch",
        closeLabel: labels.close,
      }),
    );
    expect(dialog.mock.calls[0]![0].footer).toBeUndefined();
    act(() => button("Overview").focus());
    key(button("Overview"), "ArrowRight");
    expect(document.activeElement).toBe(button("Details"));
    expect(select).toHaveBeenCalledWith("three");
    expect(document.body.textContent).toContain("Rendered design");
  });
});
