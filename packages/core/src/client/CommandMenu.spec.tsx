// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CommandMenu,
  openAgentSettings,
  useCommandMenuShortcut,
  type CommandMenuDoc,
} from "./CommandMenu.js";

const DOCS: CommandMenuDoc[] = [
  {
    title: "Use the Chrome extension for browser logs",
    description: "Record a tab with console logs and fetch/XHR diagnostics.",
    href: "https://www.agent-native.com/docs/template-clips#browser-logs-and-developer-diagnostics",
    keywords: ["logs", "developer logs", "network diagnostics"],
  },
];

describe("CommandMenu docs group", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  function renderMenu() {
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
        >
          <CommandMenu.DocsGroup docs={DOCS} />
        </CommandMenu>,
      );
    });
  }

  function search(value: string) {
    const input = document.querySelector<HTMLInputElement>("input");
    expect(input).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("opens chat surfaces before requesting settings on the next task", () => {
    let scheduledFrame: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        scheduledFrame = callback;
        return 1;
      }),
    );
    const events: string[] = [];
    const onSettings = (event: Event) =>
      events.push(
        `settings:${(event as CustomEvent<{ section?: string }>).detail?.section}`,
      );
    const onOpen = () => events.push("open");
    window.addEventListener("agent-panel:open-settings", onSettings);
    window.addEventListener("agent-panel:open", onOpen);

    openAgentSettings("voice");

    expect(events).toEqual(["open"]);
    scheduledFrame?.(0);
    expect(events).toEqual(["open", "settings:voice"]);
    window.removeEventListener("agent-panel:open-settings", onSettings);
    window.removeEventListener("agent-panel:open", onOpen);
  });

  it("deep-links to a requested secret when opening settings", () => {
    openAgentSettings("secrets:FIGMA_ACCESS_TOKEN");

    expect(window.location.hash).toBe("#secrets:FIGMA_ACCESS_TOKEN");
  });

  it("filters app docs entries through the shared search field", () => {
    renderMenu();

    search("logs");
    expect(document.body.textContent).toContain(
      "Use the Chrome extension for browser logs",
    );

    search("calendar");
    expect(document.body.textContent).not.toContain(
      "Use the Chrome extension for browser logs",
    );
  });

  it("renders dynamic results from the shared search field", () => {
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
          renderResults={(query) =>
            query.trim() ? (
              <CommandMenu.Group heading="Dynamic">
                <CommandMenu.Item onSelect={() => undefined}>
                  Result for {query}
                </CommandMenu.Item>
              </CommandMenu.Group>
            ) : null
          }
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => undefined}>
              Static action
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    search("launch");

    expect(document.body.textContent).toContain("Result for launch");
  });

  it("does not render stale dynamic results while closed or reopening", () => {
    const renderQueries: string[] = [];

    function render(open: boolean) {
      act(() => {
        root.render(
          <CommandMenu
            open={open}
            onOpenChange={() => undefined}
            showAgentFallback={false}
            renderResults={(query) => {
              renderQueries.push(query);
              return query.trim() ? (
                <CommandMenu.Group heading="Dynamic">
                  <CommandMenu.Item onSelect={() => undefined}>
                    Result for {query}
                  </CommandMenu.Item>
                </CommandMenu.Group>
              ) : null;
            }}
          >
            <CommandMenu.Group heading="Actions">
              <CommandMenu.Item onSelect={() => undefined}>
                Static action
              </CommandMenu.Item>
            </CommandMenu.Group>
          </CommandMenu>,
        );
      });
    }

    render(true);
    search("launch");
    expect(renderQueries).toContain("launch");

    renderQueries.length = 0;
    render(false);
    expect(renderQueries).toEqual([]);

    render(true);
    expect(renderQueries.at(-1)).toBe("");
    expect(document.body.textContent).not.toContain("Result for launch");
  });

  it("uses the shared dialog and command primitives without changing the keyboard-surface presentation", () => {
    renderMenu();

    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const command = document.querySelector<HTMLElement>("[cmdk-root]");
    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    const list = document.querySelector<HTMLElement>("[cmdk-list]");
    const overlay = Array.from(
      document.querySelectorAll<HTMLElement>("[data-state=open]"),
    ).find(
      (element) => element !== dialog && !element.hasAttribute("cmdk-root"),
    );

    expect(dialog).toBeTruthy();
    expect(command).toBeTruthy();
    expect(input).toBeTruthy();
    expect(list).toBeTruthy();
    expect(dialog?.className).toContain("top-[15vh]");
    expect(dialog?.className).toContain("bg-popover");
    expect(dialog?.style.animation).toBe("none");
    expect(dialog?.style.transition).toBe("none");
    expect(overlay?.className).toContain("z-50");
    expect(overlay?.className).toContain("bg-black/50");
    expect(overlay?.style.backdropFilter).toBe("none");
    expect(overlay?.style.transition).toBe("none");
    expect(document.activeElement).toBe(input);
    expect(dialog?.querySelector("button")).toBeNull();
  });

  it("keeps arrow-key selection and Enter activation on shared command items", () => {
    const selectFirst = vi.fn();
    const selectSecond = vi.fn();
    const onOpenChange = vi.fn();

    act(() => {
      root.render(
        <CommandMenu open onOpenChange={onOpenChange} showAgentFallback={false}>
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={selectFirst} deferSelect={false}>
              First action
            </CommandMenu.Item>
            <CommandMenu.Item onSelect={selectSecond} deferSelect={false}>
              Second action
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(selectFirst).not.toHaveBeenCalled();
    expect(selectSecond).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("delegates Escape dismissal to the shared dialog", () => {
    const onOpenChange = vi.fn();

    act(() => {
      root.render(
        <CommandMenu open onOpenChange={onOpenChange} showAgentFallback={false}>
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => undefined}>
              Static action
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("can opt into opening from a contenteditable target", () => {
    function ShortcutHarness() {
      const [open, setOpen] = React.useState(false);
      useCommandMenuShortcut(() => setOpen(true), {
        allowContentEditable: true,
      });
      return (
        <>
          <div contentEditable>Editor</div>
          <span>{open ? "open" : "closed"}</span>
        </>
      );
    }

    act(() => {
      root.render(<ShortcutHarness />);
    });

    const editor = document.querySelector("[contenteditable=true]");
    expect(editor).toBeTruthy();
    act(() => {
      editor!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "K",
          metaKey: true,
          bubbles: true,
        }),
      );
    });

    expect(document.body.textContent).toContain("open");
  });

  it("does not open from native select controls when contenteditable is allowed", () => {
    function ShortcutHarness() {
      const [open, setOpen] = React.useState(false);
      useCommandMenuShortcut(() => setOpen(true), {
        allowContentEditable: true,
      });
      return (
        <>
          <select aria-label="Component prop">
            <option>One</option>
          </select>
          <span>{open ? "open" : "closed"}</span>
        </>
      );
    }

    act(() => {
      root.render(<ShortcutHarness />);
    });

    const select = document.querySelector("select");
    expect(select).toBeTruthy();
    act(() => {
      select!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
        }),
      );
    });

    expect(document.body.textContent).toContain("closed");
  });

  it("opens from contenteditable before editor handlers stop propagation", () => {
    function ShortcutHarness() {
      const [open, setOpen] = React.useState(false);
      useCommandMenuShortcut(() => setOpen(true), {
        allowContentEditable: true,
      });
      return (
        <>
          <div contentEditable onKeyDown={(event) => event.stopPropagation()}>
            Editor
          </div>
          <span>{open ? "open" : "closed"}</span>
        </>
      );
    }

    act(() => {
      root.render(<ShortcutHarness />);
    });

    const editor = document.querySelector("[contenteditable=true]");
    expect(editor).toBeTruthy();
    act(() => {
      editor!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
        }),
      );
    });

    expect(document.body.textContent).toContain("open");
  });
});
