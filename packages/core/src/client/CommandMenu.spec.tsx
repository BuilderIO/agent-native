// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CommandMenu,
  openAgentSettings,
  useCommandMenuNestedDialog,
  useCommandMenuShortcut,
  type CommandMenuDoc,
} from "./CommandMenu.js";
import { SIGN_OUT_SEARCH_TERMS } from "./sign-out.js";
import { OPEN_SETTINGS_PAGE_EVENT } from "./use-settings-shortcut.js";

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

  it("matches every sign-out search alias", () => {
    renderMenu();

    for (const term of SIGN_OUT_SEARCH_TERMS) {
      search(term);
      expect(document.body.textContent).toContain("Log out");
    }
  });

  it("filters command items nested in fragments", () => {
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
        >
          <CommandMenu.Group heading="Actions">
            <>
              <CommandMenu.Item onSelect={() => undefined}>
                Open comments
              </CommandMenu.Item>
              <CommandMenu.Item onSelect={() => undefined}>
                Open transcript
              </CommandMenu.Item>
            </>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    search("transcript");

    expect(document.body.textContent).not.toContain("Open comments");
    expect(document.body.textContent).toContain("Open transcript");
  });

  it("offers the shared About Agent-Native surface and matches version searches", () => {
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAbout
          showAgentFallback={false}
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => undefined}>
              Create a project
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    expect(document.body.textContent).toContain("About Agent-Native");
    search("version");
    expect(document.body.textContent).toContain("About Agent-Native");
    expect(document.body.textContent).not.toContain("Create a project");
  });

  it("offers Settings with its shortcut hint in every menu", () => {
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => undefined}>
              Create a project
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    const settingsItem = [
      ...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
    ].find((item) => item.textContent?.startsWith("Settings"));
    expect(settingsItem?.textContent).toMatch(/Settings(⌘,|Ctrl\+,)$/);
    search("preferences");
    expect(document.body.textContent).toContain("Settings");
    expect(document.body.textContent).not.toContain("Create a project");
  });

  it("closes the menu and opens Settings from the Settings row", () => {
    const onOpenChange = vi.fn();
    const requests: Array<{ page?: string }> = [];
    const claim = (event: Event) => {
      event.preventDefault();
      requests.push((event as CustomEvent<{ page?: string }>).detail);
    };
    window.addEventListener(OPEN_SETTINGS_PAGE_EVENT, claim);
    try {
      act(() => {
        root.render(
          <CommandMenu
            open
            onOpenChange={onOpenChange}
            showAgentFallback={false}
          >
            <CommandMenu.Group heading="Actions">
              <CommandMenu.Item onSelect={() => undefined}>
                Create a project
              </CommandMenu.Item>
            </CommandMenu.Group>
          </CommandMenu>,
        );
      });

      const settingsItem = [
        ...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
      ].find((item) => item.textContent?.startsWith("Settings"));
      act(() => settingsItem?.click());

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(requests).toEqual([{}]);
    } finally {
      window.removeEventListener(OPEN_SETTINGS_PAGE_EVENT, claim);
    }
  });

  it("opens About Agent-Native after closing the command menu", () => {
    vi.useFakeTimers();
    try {
      const onOpenChange = vi.fn();
      act(() => {
        root.render(
          <CommandMenu
            open
            onOpenChange={onOpenChange}
            showAbout
            showAgentFallback={false}
          >
            <CommandMenu.Group heading="Actions">
              <CommandMenu.Item onSelect={() => undefined}>
                Create a project
              </CommandMenu.Item>
            </CommandMenu.Group>
          </CommandMenu>,
        );
      });

      const aboutItem = [
        ...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
      ].find((item) => item.textContent?.includes("About Agent-Native"));
      expect(aboutItem).toBeTruthy();

      act(() => aboutItem?.click());
      expect(onOpenChange).toHaveBeenCalledWith(false);

      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(document.body.textContent).toContain("Environment");
      expect(document.body.textContent).toContain("Copy diagnostics");
    } finally {
      vi.useRealTimers();
    }
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
    expect(dialog?.className).toContain("z-[280]");
    expect(dialog?.className).toContain("!max-h-none");
    expect(dialog?.className).toContain("!translate-y-0");
    expect(dialog?.className).toContain("bg-popover");
    expect(dialog?.style.animation).toBe("none");
    expect(dialog?.style.transition).toBe("none");
    expect(dialog?.style.maxWidth).toBe("");
    expect(dialog?.style.backgroundColor).toBe("");
    expect(overlay?.className).toContain("z-[270]");
    expect(overlay?.style.zIndex).toBe("");
    expect(overlay?.style.backgroundColor).toBe("rgb(0 0 0 / 0.5)");
    expect(overlay?.style.backdropFilter).toBe("none");
    expect(overlay?.style.transition).toBe("none");
    expect(document.activeElement).toBe(input);
    expect(dialog?.querySelector("button")).toBeNull();
  });

  it("labels the input", () => {
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          inputLabel="Search content"
          showAgentFallback={false}
        >
          <CommandMenu.Group heading="Results">
            <CommandMenu.Item onSelect={() => undefined}>Page</CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    const list = document.querySelector<HTMLElement>("[cmdk-list]");

    expect(input?.getAttribute("aria-label")).toBe("Search content");
    expect(list?.querySelector("[cmdk-item]")?.textContent).toBe("Page");
  });

  it("lets one custom layout owner compose around the shared listbox", () => {
    let renderContentCalls = 0;
    let renderListCalls = 0;
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
          renderContent={({ renderList }) => {
            renderContentCalls += 1;
            const list = renderList(
              <CommandMenu.Group heading="Results">
                <CommandMenu.Item onSelect={() => undefined}>
                  Result
                </CommandMenu.Item>
              </CommandMenu.Group>,
            );
            renderListCalls += 1;
            return (
              <section data-testid="owner">
                <button>Toolbar</button>
                {list}
                <button>Pagination</button>
              </section>
            );
          }}
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => undefined}>
              Action
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    expect(document.querySelectorAll('[data-testid="owner"]')).toHaveLength(1);
    expect(renderListCalls).toBe(renderContentCalls);
    const list = document.querySelector<HTMLElement>("[cmdk-list]");
    expect(list?.textContent).toContain("Result");
    expect(list?.textContent).toContain("Action");
    expect(list?.textContent).not.toContain("Toolbar");
    expect(list?.textContent).not.toContain("Pagination");
  });

  it("uses legacy renderResults when custom content renders the default list", () => {
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
          renderResults={(query) => (
            <CommandMenu.Group heading="Dynamic">
              <CommandMenu.Item onSelect={() => undefined}>
                Result for {query || "empty search"}
              </CommandMenu.Item>
            </CommandMenu.Group>
          )}
          renderContent={({ renderList }) => (
            <section data-testid="owner">{renderList()}</section>
          )}
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => undefined}>
              Static action
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    const list = document.querySelector<HTMLElement>("[cmdk-list]");
    expect(list?.textContent).toContain("Result for empty search");
    expect(list?.textContent).toContain("Static action");
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

  it("clears a nonempty command query on Escape before dismissing when enabled", () => {
    const onOpenChange = vi.fn();

    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={onOpenChange}
          clearSearchOnEscape
          showAgentFallback={false}
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => undefined}>
              Static action
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    search("launch");

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(input?.value).toBe("");
    expect(document.querySelector("[role=dialog]")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("runs the close-focus callback when Escape dismisses the menu", async () => {
    const returnFocusTarget = document.createElement("button");
    document.body.appendChild(returnFocusTarget);
    returnFocusTarget.focus();
    const onCloseAutoFocus = vi.fn((event: Event) => {
      event.preventDefault();
      returnFocusTarget.focus();
    });

    function Harness() {
      const [open, setOpen] = React.useState(true);
      return (
        <CommandMenu
          open={open}
          onOpenChange={setOpen}
          onCloseAutoFocus={onCloseAutoFocus}
          showAgentFallback={false}
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => undefined}>
              Static action
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>
      );
    }

    act(() => root.render(<Harness />));
    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(onCloseAutoFocus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(returnFocusTarget);
    returnFocusTarget.remove();
  });

  it("dismisses a nested dialog before the command dialog", async () => {
    const dismissNested = vi.fn();
    const onOpenChange = vi.fn();
    function NestedDialog() {
      useCommandMenuNestedDialog(dismissNested);
      return <div role="dialog" aria-label="Date picker" />;
    }

    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={onOpenChange}
          showAgentFallback={false}
          renderContent={() => <NestedDialog />}
        >
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
    await act(async () => Promise.resolve());

    expect(dismissNested).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
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

  it("leaves modified K chords available to app commands", () => {
    const onOpen = vi.fn();
    function ShortcutHarness() {
      useCommandMenuShortcut(onOpen);
      return null;
    }
    act(() => root.render(<ShortcutHarness />));
    for (const modifier of [{ altKey: true }, { shiftKey: true }]) {
      const event = new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
        cancelable: true,
        ...modifier,
      });
      act(() => document.body.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onOpen).not.toHaveBeenCalled();
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("claims Cmd+K from native controls without opening", () => {
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
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      select!.dispatchEvent(event);
    });

    expect(document.body.textContent).toContain("closed");
    expect(event.defaultPrevented).toBe(true);
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

  it("yields an opted-in contenteditable shortcut without claiming it", () => {
    const editorHandled = vi.fn();

    function ShortcutHarness() {
      const [open, setOpen] = React.useState(false);
      useCommandMenuShortcut(() => setOpen(true), {
        allowContentEditable: true,
        shouldHandleContentEditable: () => false,
      });
      return (
        <>
          <div
            contentEditable
            onKeyDown={(event) => editorHandled(event.defaultPrevented)}
          >
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
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      editor!.dispatchEvent(event);
    });

    expect(document.body.textContent).toContain("closed");
    expect(editorHandled).toHaveBeenCalledWith(false);
    expect(event.defaultPrevented).toBe(false);
  });
});
