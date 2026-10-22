// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({ callAction: vi.fn() }));
const agentEngineStatusMock = vi.hoisted(() => ({
  state: "missing" as "unknown" | "configured" | "missing" | "unavailable",
}));

vi.mock("@agent-native/core/client/use-agent-engine-configured", () => ({
  useAgentEngineConfigured: () => ({
    canChat: agentEngineStatusMock.state === "configured",
    missing: agentEngineStatusMock.state === "missing",
    state: agentEngineStatusMock.state,
  }),
}));

vi.mock("../chat/chat/run-recovery.js", async () => {
  const { createElement } = await import("react");
  return {
    BuilderSetupCard: () =>
      createElement(
        "div",
        { "data-testid": "builder-setup-card" },
        "Connect AI",
      ),
  };
});

vi.mock("@agent-native/core/client/use-action", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-action")
  >()),
  callAction: actionMocks.callAction,
}));

import { SIGN_OUT_SEARCH_TERMS } from "@agent-native/core/client/sign-out";
import { OPEN_SETTINGS_PAGE_EVENT } from "@agent-native/core/client/use-settings-shortcut";

import {
  CommandMenu,
  openAgentSettings,
  useCommandMenuNestedDialog,
  useCommandMenuShortcut,
  type AppCommandContext,
  type AppCommandGroup,
  type CommandMenuItemMatchContext,
  type CommandMenuItemMatcher,
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

describe("CommandMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    actionMocks.callAction.mockReset();
    onOpenChange.mockReset();
    agentEngineStatusMock.state = "missing";
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

  function renderAppCommands<TAppContext>({
    groups,
    context,
    filterLauncherSlot,
    embeddedChatSlot,
    initialSelection,
    footerSlot,
    itemMatcher,
    onSearchChange,
    renderResults,
    renderResultsHasItems,
    renderResultsPosition,
    emptyState,
    noMatchSuggestionsSlot,
    container: portalContainer,
    size,
    showSettingsCommand,
    showSignOutCommand,
    showAgentFallback = false,
    open = true,
  }: {
    groups: AppCommandGroup<TAppContext>[];
    context?: TAppContext;
    initialSelection?: "first" | "none";
    itemMatcher?: CommandMenuItemMatcher;
    onSearchChange?: (search: string) => void;
    renderResults?: (search: string) => React.ReactNode;
    renderResultsHasItems?: (search: string) => boolean;
    renderResultsPosition?: "before" | "after";
    emptyState?: React.ReactNode;
    noMatchSuggestionsSlot?: (search: string) => React.ReactNode;
    container?: HTMLElement;
    size?: "default" | "wide";
    showSettingsCommand?: boolean;
    showSignOutCommand?: boolean;
    showAgentFallback?: boolean;
    open?: boolean;
    filterLauncherSlot?: (options: {
      search: string;
      appContext: TAppContext | undefined;
      close: () => void;
    }) => React.ReactNode;
    embeddedChatSlot?: (options: {
      search: string;
      appContext: TAppContext | undefined;
      close: () => void;
    }) => React.ReactNode;
    footerSlot?: React.ReactNode;
  }) {
    act(() => {
      root.render(
        <CommandMenu
          open={open}
          onOpenChange={onOpenChange}
          showAgentFallback={showAgentFallback}
          showSettingsCommand={showSettingsCommand}
          showSignOutCommand={showSignOutCommand}
          appCommandGroups={groups}
          commandContext={context}
          filterLauncherSlot={filterLauncherSlot}
          embeddedChatSlot={embeddedChatSlot}
          initialSelection={initialSelection}
          footerSlot={footerSlot}
          itemMatcher={itemMatcher}
          onSearchChange={onSearchChange}
          renderResults={renderResults}
          renderResultsHasItems={renderResultsHasItems}
          renderResultsPosition={renderResultsPosition}
          emptyState={emptyState}
          noMatchSuggestionsSlot={noMatchSuggestionsSlot}
          container={portalContainer}
          size={size}
        >
          {null}
        </CommandMenu>,
      );
    });
  }

  const onOpenChange = vi.fn();

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
    expect(
      document.querySelector('[data-testid="command-menu-filter-launchers"]'),
    ).toBeNull();

    search("logs");
    expect(document.body.textContent).toContain(
      "Use the Chrome extension for browser logs",
    );

    search("calendar");
    expect(document.body.textContent).not.toContain(
      "Use the Chrome extension for browser logs",
    );
  });

  it("keeps the default dialog width and supports a shared wide variant", () => {
    renderMenu();
    expect(document.querySelector('[role="dialog"]')?.classList).toContain(
      "max-w-lg",
    );

    renderAppCommands({ groups: [], size: "wide" });
    expect(document.querySelector('[role="dialog"]')?.classList).toContain(
      "max-w-3xl",
    );
  });

  it("matches every sign-out search alias", () => {
    renderMenu();

    for (const term of SIGN_OUT_SEARCH_TERMS) {
      search(term);
      expect(document.body.textContent).toContain("Log out");
    }
  });

  it("keeps the disconnected setup card out of command search", async () => {
    actionMocks.callAction.mockResolvedValue({ engines: [], current: {} });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("env-status")) return Response.json([]);
        if (url.includes("builder/status")) {
          return Response.json({ configured: false });
        }
        return Response.json({});
      }),
    );

    await act(async () => {
      root.render(
        <CommandMenu open onOpenChange={() => undefined}>
          <CommandMenu.Group heading="Appearance">
            <CommandMenu.Item onSelect={() => undefined}>
              Toggle dark mode
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
      await Promise.resolve();
    });

    search("dark");

    expect(document.body.textContent).toContain("Toggle dark mode");
    expect(
      document.querySelector('[data-testid="builder-setup-card"]'),
    ).toBeNull();
  });

  it("enables Ask AI for an automatically selected local runtime", async () => {
    actionMocks.callAction.mockResolvedValue({
      engines: [
        {
          name: "codex-cli",
          label: "Codex CLI",
          supportedModels: ["gpt-5.6-sol"],
          requiredEnvVars: [],
        },
      ],
      current: { engine: "codex-cli", model: "gpt-5.6-sol" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("agent-engine/status")) {
          return Response.json({ configured: false });
        }
        if (url.includes("env-status")) return Response.json([]);
        if (url.includes("builder/status")) {
          return Response.json({ configured: false });
        }
        return Response.json({});
      }),
    );

    await act(async () => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          chatStorageKey="local-first-run"
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => undefined}>
              Open chat
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const askAi = [
      ...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
    ].find((item) => item.textContent?.includes("Ask AI anything"));
    expect(actionMocks.callAction).toHaveBeenCalledWith("manage-agent-engine", {
      action: "list",
    });
    expect(askAi).toBeTruthy();
    expect(askAi?.getAttribute("aria-disabled")).not.toBe("true");
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

  it("does not show the empty state beside groups wrapped in a fragment", () => {
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          emptyState="No matching commands"
          showAgentFallback={false}
        >
          <>
            <CommandMenu.Group heading="Actions">
              <CommandMenu.Item onSelect={() => undefined}>
                Open item
              </CommandMenu.Item>
            </CommandMenu.Group>
          </>
        </CommandMenu>,
      );
    });

    search("open");

    expect(document.body.textContent).toContain("Open item");
    expect(document.querySelector('[role="status"]')).toBeNull();
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

  it("dismisses a nested dialog before returning from an app page", async () => {
    const dismissNested = vi.fn();
    function NestedDialog() {
      useCommandMenuNestedDialog(dismissNested);
      return <div role="dialog" aria-label="Nested picker" />;
    }

    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={onOpenChange}
          showAgentFallback={false}
          showSettingsCommand={false}
          showSignOutCommand={false}
          appCommandGroups={[
            {
              id: "main",
              order: 1,
              commands: [
                {
                  id: "open-tools",
                  order: 1,
                  label: "Open tools",
                  page: {
                    id: "tools",
                    title: "Tools",
                    groups: [
                      {
                        id: "tool-actions",
                        order: 1,
                        commands: [
                          {
                            id: "refresh",
                            order: 1,
                            label: "Refresh data",
                            onSelect() {},
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ]}
          renderContent={({ renderList }) => (
            <>
              {renderList()}
              <NestedDialog />
            </>
          )}
        >
          {null}
        </CommandMenu>,
      );
    });

    const openPage = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:main:open-tools"]',
    );
    expect(openPage).toBeTruthy();
    act(() => openPage!.click());
    expect(document.body.textContent).toContain("Refresh data");

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await act(async () => Promise.resolve());

    expect(dismissNested).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Refresh data");
    expect(document.body.textContent).toContain("Back");
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

  it("opens from the focused agent composer without opting into contenteditable", () => {
    const onOpen = vi.fn();
    function ShortcutHarness() {
      useCommandMenuShortcut(onOpen);
      return (
        <>
          <div data-agent-composer-slot="root">
            <div contentEditable data-testid="composer" />
          </div>
          <div contentEditable data-testid="document" />
        </>
      );
    }
    act(() => root.render(<ShortcutHarness />));

    const composerEvent = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document
        .querySelector('[data-testid="composer"]')!
        .dispatchEvent(composerEvent);
    });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(composerEvent.defaultPrevented).toBe(true);

    // A rich-text document that did not opt in keeps swallowing the chord.
    act(() => {
      document.querySelector('[data-testid="document"]')!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onOpen).toHaveBeenCalledOnce();
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

  it("orders app groups and commands by their explicit positions", () => {
    renderAppCommands({
      groups: [
        {
          id: "later",
          order: 20,
          heading: "Later group",
          commands: [
            { id: "last", order: 20, label: "Last command", onSelect() {} },
            { id: "first", order: 1, label: "First command", onSelect() {} },
          ],
        },
        {
          id: "earlier",
          order: 1,
          heading: "Earlier group",
          commands: [
            { id: "only", order: 1, label: "Earlier command", onSelect() {} },
          ],
        },
      ],
    });

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[cmdk-item][data-value^="app-command:"]',
      ),
    );
    expect(rows.map((row) => row.textContent?.trim())).toEqual([
      "Earlier command",
      "First command",
      "Last command",
    ]);
  });

  it("shows shortcut hints, searches aliases, and activates the matching command", () => {
    const onSelect = vi.fn();
    renderAppCommands({
      groups: [
        {
          id: "actions",
          order: 1,
          commands: [
            {
              id: "jump-to-today",
              order: 1,
              label: "Today",
              keywords: ["current date", "jump"],
              shortcutHint: "⌘ J",
              deferSelect: false,
              onSelect,
            },
          ],
        },
      ],
    });

    expect(document.body.textContent).toContain("⌘ J");
    search("current date");
    expect(document.body.textContent).toContain("Today");

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    search("jump-to-today");
    expect(
      document.querySelector(
        '[cmdk-item][data-value="app-command:actions:jump-to-today"]',
      ),
    ).toBeNull();
    search("⌘ J");
    expect(
      document.querySelector(
        '[cmdk-item][data-value="app-command:actions:jump-to-today"]',
      ),
    ).toBeNull();
  });

  it("uses the latest nested page commands while the page is open", () => {
    const createGroups = (
      label: string,
      onSelect: () => void,
    ): AppCommandGroup[] => [
      {
        id: "main",
        order: 1,
        commands: [
          {
            id: "open-tools",
            order: 1,
            label: "Open tools",
            page: {
              id: "tools",
              title: "Tools",
              groups: [
                {
                  id: "tool-actions",
                  order: 1,
                  commands: [
                    {
                      id: "refresh",
                      order: 1,
                      label,
                      deferSelect: false,
                      onSelect,
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ];
    const originalSelect = vi.fn();
    const latestSelect = vi.fn();

    renderAppCommands({ groups: createGroups("Old command", originalSelect) });
    const parentRow = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:main:open-tools"]',
    );
    expect(parentRow).toBeTruthy();
    act(() => parentRow!.click());

    renderAppCommands({ groups: createGroups("Latest command", latestSelect) });

    expect(document.body.textContent).toContain("Latest command");
    expect(document.body.textContent).not.toContain("Old command");
    const currentRow = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:tool-actions:refresh"]',
    );
    expect(currentRow).toBeTruthy();
    act(() => currentRow!.click());
    expect(latestSelect).toHaveBeenCalledOnce();
    expect(originalSelect).not.toHaveBeenCalled();
  });

  it("pushes nested command pages and returns by Back or Escape", () => {
    renderAppCommands({
      groups: [
        {
          id: "main",
          order: 1,
          commands: [
            {
              id: "open-tools",
              order: 1,
              label: "Open tools",
              keywords: ["tools alias"],
              page: {
                id: "tools",
                title: "Tools",
                groups: [
                  {
                    id: "tool-actions",
                    order: 1,
                    heading: "Available tools",
                    commands: [
                      {
                        id: "refresh",
                        order: 1,
                        label: "Refresh data",
                        onSelect() {},
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    search("tools alias");
    const parentRow = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:main:open-tools"]',
    );
    expect(parentRow).toBeTruthy();
    act(() => parentRow!.click());
    expect(document.body.textContent).toContain("Refresh data");
    expect(document.body.textContent).toContain("Back");

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    const backRow = document.querySelector<HTMLElement>(
      '[data-testid="command-menu-page-back"]',
    );
    expect(backRow).toBeTruthy();
    backRow!.focus();
    expect(document.activeElement).toBe(backRow);
    act(() => backRow!.click());

    expect(input?.value).toBe("tools alias");
    expect(document.activeElement).toBe(input);
    expect(document.body.textContent).toContain("Open tools");
    expect(document.body.textContent).not.toContain("Refresh data");

    const returnedParentRow = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:main:open-tools"]',
    );
    expect(returnedParentRow).toBeTruthy();
    act(() => returnedParentRow!.click());
    expect(document.body.textContent).toContain("Refresh data");

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(input?.value).toBe("tools alias");
    expect(document.body.textContent).toContain("Open tools");
    expect(document.body.textContent).not.toContain("Refresh data");
  });

  it("shows an empty state when a nested page has no matching commands", () => {
    const hasRootResults = vi.fn(() => true);
    renderAppCommands({
      groups: [
        {
          id: "main",
          order: 1,
          commands: [
            {
              id: "open-tools",
              order: 1,
              label: "Open tools",
              page: {
                id: "tools",
                title: "Tools",
                groups: [
                  {
                    id: "tool-actions",
                    order: 1,
                    commands: [
                      {
                        id: "refresh",
                        order: 1,
                        label: "Refresh data",
                        onSelect() {},
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
      renderResults: () => (
        <CommandMenu.Group heading="Root results">
          <CommandMenu.Item onSelect={() => undefined}>
            Root fallback
          </CommandMenu.Item>
        </CommandMenu.Group>
      ),
      renderResultsHasItems: hasRootResults,
      emptyState: "No matching commands",
    });

    const parentRow = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:main:open-tools"]',
    );
    expect(parentRow).toBeTruthy();
    act(() => parentRow!.click());
    expect(document.body.textContent).toContain("Refresh data");
    expect(document.body.textContent).not.toContain("Root fallback");

    hasRootResults.mockClear();
    search("no-such-command");

    expect(hasRootResults).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "No matching commands",
    );
    expect(
      document.querySelector('[data-testid="command-menu-page-back"]'),
    ).toBeTruthy();
  });

  it("selects the first matching page command instead of Back", () => {
    const onSelect = vi.fn();
    renderAppCommands({
      groups: [
        {
          id: "main",
          order: 1,
          commands: [
            {
              id: "open-tools",
              order: 1,
              label: "Open tools",
              page: {
                id: "tools",
                title: "Tools",
                groups: [
                  {
                    id: "tool-actions",
                    order: 1,
                    commands: [
                      {
                        id: "refresh",
                        order: 1,
                        label: "Refresh data",
                        onSelect() {},
                      },
                      {
                        id: "open-settings",
                        order: 2,
                        label: "Open settings",
                        deferSelect: false,
                        onSelect,
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const parentRow = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:main:open-tools"]',
    );
    expect(parentRow).toBeTruthy();
    act(() => parentRow!.click());

    search("settings");
    const pageCommand = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:tool-actions:open-settings"]',
    );
    expect(pageCommand?.getAttribute("aria-selected")).toBe("true");

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    act(() =>
      input!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("keeps page transitions unselected in none-selection mode", () => {
    renderAppCommands({
      initialSelection: "none",
      groups: [
        {
          id: "main",
          order: 1,
          commands: [
            {
              id: "open-tools",
              order: 1,
              label: "Open tools",
              page: {
                id: "tools",
                title: "Tools",
                groups: [
                  {
                    id: "tool-actions",
                    order: 1,
                    commands: [
                      {
                        id: "refresh",
                        order: 1,
                        label: "Refresh data",
                        onSelect() {},
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    act(() =>
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    act(() =>
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(document.body.textContent).toContain("Refresh data");
    expect(
      document.querySelector('[cmdk-item][aria-selected="true"]'),
    ).toBeNull();

    const backButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="command-menu-page-back"]',
    );
    expect(backButton).toBeTruthy();
    act(() => backButton!.click());
    expect(document.body.textContent).toContain("Open tools");
    expect(
      document.querySelector('[cmdk-item][aria-selected="true"]'),
    ).toBeNull();
  });

  it("uses app context to control command visibility and enabled state", () => {
    const onSelect = vi.fn();
    renderAppCommands({
      context: { canEdit: false },
      groups: [
        {
          id: "actions",
          order: 1,
          commands: [
            {
              id: "hidden-record",
              order: 0,
              label: "Hidden record",
              visibleWhen: ({ appContext }) => appContext?.canEdit === true,
              onSelect,
            },
            {
              id: "edit-record",
              order: 1,
              label: "Edit record",
              enabledWhen: ({ appContext }) => appContext?.canEdit ?? false,
              onSelect,
            },
          ],
        },
      ],
    });

    const row = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:actions:edit-record"]',
    );
    expect(
      document.querySelector(
        '[cmdk-item][data-value="app-command:actions:hidden-record"]',
      ),
    ).toBeNull();
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    act(() => row?.click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("applies the public item matcher to app command rows", () => {
    const itemMatcher = vi.fn(
      ({ query, label, value, keywords }: CommandMenuItemMatchContext) =>
        query === "alias" &&
        label === "Open record" &&
        value === "record" &&
        keywords.includes("unrelated"),
    );
    renderAppCommands({
      itemMatcher,
      groups: [
        {
          id: "actions",
          order: 1,
          commands: [
            {
              id: "record",
              order: 1,
              label: "Open record",
              keywords: ["unrelated"],
              onSelect() {},
            },
          ],
        },
      ],
    });

    search("alias");

    expect(itemMatcher).toHaveBeenCalledWith({
      query: "alias",
      label: "Open record",
      value: "record",
      keywords: ["unrelated"],
    });
    expect(
      document.querySelector(
        '[cmdk-item][data-value="app-command:actions:record"]',
      ),
    ).toBeTruthy();
  });

  it("uses the app matcher even when the group heading matches", () => {
    const itemMatcher = vi.fn(() => false);
    renderAppCommands({
      itemMatcher,
      groups: [
        {
          id: "reports",
          order: 1,
          heading: "Reports",
          commands: [
            {
              id: "open-report",
              order: 1,
              label: "Open report",
              onSelect() {},
            },
          ],
        },
      ],
    });

    search("reports");

    expect(itemMatcher).toHaveBeenCalled();
    expect(
      document.querySelector(
        '[cmdk-item][data-value="app-command:reports:open-report"]',
      ),
    ).toBeNull();
  });

  it("renders the selected command inline preview", () => {
    renderAppCommands({
      groups: [
        {
          id: "results",
          order: 1,
          commands: [
            {
              id: "record",
              order: 1,
              label: "Meeting notes",
              preview: <p>First preview</p>,
              onSelect() {},
            },
            {
              id: "meeting-agenda",
              order: 2,
              label: "Meeting agenda",
              preview: <p>Selected preview</p>,
              onSelect() {},
            },
          ],
        },
      ],
    });

    expect(
      document.querySelector('[data-testid="command-menu-inline-preview"]')
        ?.textContent,
    ).toContain("First preview");

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    act(() =>
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(
      document.querySelector('[data-testid="command-menu-inline-preview"]')
        ?.textContent,
    ).toContain("Selected preview");
  });

  it("renders opt-in app command previews in only the selected row", () => {
    renderAppCommands({
      groups: [
        {
          id: "results",
          order: 1,
          commands: [
            {
              id: "record",
              order: 1,
              label: "Meeting notes",
              inlinePreview: <span>First row preview</span>,
              onSelect() {},
            },
            {
              id: "meeting-agenda",
              order: 2,
              label: "Meeting agenda",
              inlinePreview: <span>Second row preview</span>,
              onSelect() {},
            },
          ],
        },
      ],
    });

    const firstRow = document.querySelector(
      '[cmdk-item][data-value="app-command:results:record"]',
    );
    const secondRow = document.querySelector(
      '[cmdk-item][data-value="app-command:results:meeting-agenda"]',
    );
    expect(
      firstRow?.querySelector(
        '[data-testid="command-menu-app-command-preview"]',
      )?.textContent,
    ).toBe("First row preview");
    expect(
      secondRow?.querySelector(
        '[data-testid="command-menu-app-command-preview"]',
      ),
    ).toBeNull();

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    act(() =>
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );

    expect(
      firstRow?.querySelector(
        '[data-testid="command-menu-app-command-preview"]',
      ),
    ).toBeNull();
    expect(
      secondRow?.querySelector(
        '[data-testid="command-menu-app-command-preview"]',
      )?.textContent,
    ).toBe("Second row preview");
  });

  it("passes app context and search to an app command row preview", () => {
    const renderPreview = vi.fn(
      ({
        search: currentSearch,
        appContext,
      }: AppCommandContext<{ workspace: string }>) => (
        <span>{`${currentSearch}|${appContext?.workspace}`}</span>
      ),
    );
    renderAppCommands({
      initialSelection: "none",
      context: { workspace: "alpha" },
      groups: [
        {
          id: "results",
          order: 1,
          commands: [
            {
              id: "workspace",
              order: 1,
              label: "Open workspace",
              inlinePreview: renderPreview,
              onSelect() {},
            },
          ],
        },
      ],
    });

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    const moveDown = () =>
      act(() =>
        input!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        ),
      );
    moveDown();

    expect(renderPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "",
        appContext: { workspace: "alpha" },
      }),
    );
    expect(
      document.querySelector('[data-testid="command-menu-app-command-preview"]')
        ?.textContent,
    ).toBe("|alpha");

    search("workspace");
    moveDown();
    expect(
      document.querySelector(
        '[cmdk-item][data-value="app-command:results:workspace"]',
      ),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-testid="command-menu-app-command-preview"]')
        ?.textContent,
    ).toBe("workspace|alpha");
  });

  it("hides the app preview when a non-app result is selected", () => {
    renderAppCommands({
      groups: [
        {
          id: "results",
          order: 1,
          commands: [
            {
              id: "record",
              order: 1,
              label: "Meeting notes",
              preview: <p>Record preview</p>,
              onSelect() {},
            },
          ],
        },
      ],
      renderResults: () => (
        <CommandMenu.Group heading="Live results">
          <CommandMenu.Item onSelect={() => undefined}>
            Open live result
          </CommandMenu.Item>
        </CommandMenu.Group>
      ),
    });

    expect(
      document.querySelector('[cmdk-item][aria-selected="true"]')?.textContent,
    ).toContain("Open live result");
    expect(
      document.querySelector('[data-testid="command-menu-inline-preview"]'),
    ).toBeNull();
  });

  it("passes current search and close behavior to the embedded chat slot", () => {
    renderAppCommands({
      groups: [],
      context: { workspace: "alpha" },
      embeddedChatSlot: ({ search: currentSearch, close, appContext }) => (
        <div>
          <span>{currentSearch}</span>
          <span>{appContext?.workspace}</span>
          <button type="button" onClick={close}>
            Close embedded chat
          </button>
        </div>
      ),
    });

    search("summarize this");
    expect(document.body.textContent).toContain("summarize this");
    expect(document.body.textContent).toContain("alpha");

    const closeButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Close embedded chat",
    );
    expect(closeButton).toBeTruthy();
    act(() => closeButton!.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps embedded chat keyboard input out of command selection", () => {
    const onSelect = vi.fn();
    renderAppCommands({
      groups: [
        {
          id: "actions",
          order: 1,
          commands: [
            {
              id: "open-record",
              order: 1,
              label: "Open record",
              onSelect,
            },
          ],
        },
      ],
      embeddedChatSlot: () => <input aria-label="Embedded chat" />,
    });

    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Embedded chat"]',
    );
    expect(input).toBeTruthy();
    const selectedBefore = document.querySelector(
      '[cmdk-item][aria-selected="true"]',
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const dialogKeyDown = vi.fn();
    dialog?.addEventListener("keydown", dialogKeyDown);
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => input!.dispatchEvent(tab));
    expect(dialogKeyDown).toHaveBeenCalledOnce();
    const arrowDown = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input!.dispatchEvent(arrowDown);
      input!.dispatchEvent(enter);
    });

    expect(arrowDown.defaultPrevented).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.querySelector('[cmdk-item][aria-selected="true"]')).toBe(
      selectedBefore,
    );
  });

  it("passes palette context to filter launchers and keeps their keys out of command navigation", () => {
    renderAppCommands({
      groups: [
        {
          id: "reports",
          order: 1,
          commands: [
            {
              id: "revenue-report",
              order: 1,
              label: "Revenue report",
              onSelect() {},
            },
            {
              id: "revenue-forecast",
              order: 2,
              label: "Revenue forecast",
              onSelect() {},
            },
          ],
        },
      ],
      context: { workspace: "alpha" },
      showSettingsCommand: false,
      showSignOutCommand: false,
      filterLauncherSlot: ({ search: currentSearch, appContext, close }) => (
        <button type="button" onClick={close}>
          {currentSearch}:{appContext?.workspace}:Filter records
        </button>
      ),
    });

    search("revenue");
    const slot = document.querySelector(
      '[data-testid="command-menu-filter-launchers"]',
    );
    expect(slot?.textContent).toContain("revenue:alpha:Filter records");

    const selectedBefore = document.querySelector<HTMLElement>(
      '[cmdk-item][aria-selected="true"]',
    );
    expect(selectedBefore?.textContent).toContain("Revenue report");
    const arrowDown = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    const launcher = slot?.querySelector("button");
    expect(launcher).toBeTruthy();
    act(() => launcher!.dispatchEvent(arrowDown));
    expect(document.querySelector('[cmdk-item][aria-selected="true"]')).toBe(
      selectedBefore,
    );

    act(() => launcher!.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps disabled items searchable and unselectable", () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
          showSettingsCommand={false}
          showSignOutCommand={false}
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item
              value="locked-action"
              keywords={["locked alias"]}
              disabled
              onSelect={onSelect}
            >
              Locked action
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    search("locked alias");
    const row = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="locked-action"]',
    );
    expect(row?.textContent).toContain("Locked action");
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    act(() => row?.click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a dynamic item's preview inside only its selected row", () => {
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
          showSettingsCommand={false}
          showSignOutCommand={false}
          initialSelection="first"
        >
          <CommandMenu.Group heading="Records">
            <CommandMenu.Item
              value="record-one"
              preview={<span>First record details</span>}
              onSelect={() => undefined}
            >
              First record
            </CommandMenu.Item>
            <CommandMenu.Item
              value="record-two"
              preview={<span>Second record details</span>}
              onSelect={() => undefined}
            >
              Second record
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    const selectedRow = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="record-one"]',
    );
    const otherRow = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="record-two"]',
    );
    expect(
      selectedRow?.querySelector('[data-testid="command-menu-item-preview"]')
        ?.textContent,
    ).toBe("First record details");
    expect(
      otherRow?.querySelector('[data-testid="command-menu-item-preview"]'),
    ).toBeNull();

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    act(() =>
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );

    expect(
      document
        .querySelector('[cmdk-item][data-value="record-two"]')
        ?.querySelector('[data-testid="command-menu-item-preview"]')
        ?.textContent,
    ).toBe("Second record details");
  });

  it("uses an app matcher and reports each search change", () => {
    const itemMatcher = vi.fn(
      ({
        query,
        label,
        value,
        keywords,
      }: Parameters<CommandMenuItemMatcher>[0]) =>
        query === "alias" &&
        label === "Open record" &&
        value === "record" &&
        keywords.includes("unrelated"),
    );
    const onSearchChange = vi.fn();

    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
          showSettingsCommand={false}
          showSignOutCommand={false}
          itemMatcher={itemMatcher}
          onSearchChange={onSearchChange}
        >
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item
              value="record"
              keywords={["unrelated"]}
              onSelect={() => undefined}
            >
              Open record
            </CommandMenu.Item>
          </CommandMenu.Group>
        </CommandMenu>,
      );
    });

    search("alias");

    expect(itemMatcher).toHaveBeenCalledWith({
      query: "alias",
      label: "Open record",
      value: "record",
      keywords: ["unrelated"],
    });
    expect(
      document.querySelector('[cmdk-item][data-value="record"]'),
    ).toBeTruthy();
    expect(onSearchChange).toHaveBeenLastCalledWith("alias");
    expect(onSearchChange.mock.calls.map(([query]) => query)).toEqual([
      "alias",
    ]);

    search("unrelated");
    expect(
      document.querySelector('[cmdk-item][data-value="record"]'),
    ).toBeNull();
    expect(onSearchChange.mock.calls.map(([query]) => query)).toEqual([
      "alias",
      "unrelated",
    ]);

    act(() => {
      root.render(
        <CommandMenu
          open={false}
          onOpenChange={() => undefined}
          showAgentFallback={false}
          onSearchChange={onSearchChange}
        >
          {null}
        </CommandMenu>,
      );
    });
    expect(onSearchChange).toHaveBeenLastCalledWith("");
    expect(onSearchChange.mock.calls.map(([query]) => query)).toEqual([
      "alias",
      "unrelated",
      "",
    ]);
  });

  it("places dynamic results around app command groups", () => {
    const groups = [
      {
        id: "app-actions",
        order: 1,
        heading: "App actions",
        commands: [
          {
            id: "open-record",
            order: 1,
            label: "Open record",
            keywords: ["match"],
            onSelect() {},
          },
        ],
      },
    ];
    const renderResults = () => (
      <CommandMenu.Group heading="Live results">
        <CommandMenu.Item onSelect={() => undefined}>
          Live match
        </CommandMenu.Item>
      </CommandMenu.Group>
    );

    renderAppCommands({
      groups,
      renderResultsPosition: "after",
      renderResults,
    });
    search("match");

    const listText = document.querySelector("[cmdk-list]")?.textContent ?? "";
    expect(listText.indexOf("Open record")).toBeGreaterThanOrEqual(0);
    expect(listText.indexOf("Live match")).toBeGreaterThan(
      listText.indexOf("Open record"),
    );

    renderAppCommands({ groups, renderResults });
    search("match");
    const defaultListText =
      document.querySelector("[cmdk-list]")?.textContent ?? "";
    expect(defaultListText.indexOf("Live match")).toBeLessThan(
      defaultListText.indexOf("Open record"),
    );
  });

  it("allows apps to hide Settings and Sign out while preserving their defaults", () => {
    renderMenu();
    expect(document.body.textContent).toContain("Settings");
    expect(document.body.textContent).toContain("Log out");

    renderAppCommands({
      groups: [],
      showSettingsCommand: false,
      showSignOutCommand: false,
    });
    expect(document.body.textContent).not.toContain("Settings");
    expect(document.body.textContent).not.toContain("Log out");
  });

  it("renders a custom empty state beside the agent fallback and palette footer", async () => {
    actionMocks.callAction.mockResolvedValue({ engines: [], current: {} });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("env-status")) return Response.json([]);
        if (url.includes("agent-engine/status")) {
          return Response.json({ configured: false });
        }
        return Response.json({});
      }),
    );

    renderAppCommands({
      groups: [],
      emptyState: "No matching records",
      footerSlot: <span>⌘ K to search</span>,
      showAgentFallback: true,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    search("no-such-command");

    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "No matching records",
    );
    expect(document.querySelector('[role="note"]')?.textContent).toContain(
      "⌘ K to search",
    );
    expect(document.body.textContent).toContain("Ask AI");
  });

  it("shows the custom empty state when dynamic results contain no command items", () => {
    renderAppCommands({
      groups: [],
      renderResults: () => (
        <CommandMenu.Group heading="Dynamic results">{null}</CommandMenu.Group>
      ),
      emptyState: "No matching records",
    });

    search("missing");

    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "No matching records",
    );
  });

  it("uses result presence for opaque components that render no rows", () => {
    function EmptyResults() {
      return null;
    }

    renderAppCommands({
      groups: [],
      renderResults: () => <EmptyResults />,
      renderResultsHasItems: () => false,
      emptyState: "No matching records",
    });

    search("missing");

    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "No matching records",
    );
  });

  it("shows app search suggestions only when a non-empty query has no results", () => {
    renderAppCommands({
      groups: [],
      emptyState: "No matching records",
      noMatchSuggestionsSlot: (query) => (
        <button type="button">Search {query} everywhere</button>
      ),
    });

    search("missing");

    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Search missing everywhere",
    );
  });

  it("does not show the empty state beside component-rendered results", () => {
    function LiveResults() {
      return (
        <CommandMenu.Group heading="Live results">
          <CommandMenu.Item onSelect={() => undefined}>
            Live result
          </CommandMenu.Item>
        </CommandMenu.Group>
      );
    }

    renderAppCommands({
      groups: [],
      renderResults: () => <LiveResults />,
      renderResultsHasItems: () => true,
      emptyState: "No matching records",
    });

    search("active");

    expect(document.body.textContent).toContain("Live result");
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("uses the render-results presence signal for components that render no rows", () => {
    function EmptyLiveResults() {
      return null;
    }

    renderAppCommands({
      groups: [],
      renderResults: () => <EmptyLiveResults />,
      renderResultsHasItems: () => false,
      emptyState: "No matching records",
    });

    search("missing");

    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "No matching records",
    );
  });

  it("uses the explicit list's rows instead of the default result signal", () => {
    const hasDefaultResults = vi.fn(() => true);

    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
          renderResults={() => (
            <CommandMenu.Group heading="Default results">
              <CommandMenu.Item onSelect={() => undefined}>
                Default result
              </CommandMenu.Item>
            </CommandMenu.Group>
          )}
          renderResultsHasItems={hasDefaultResults}
          renderContent={({ renderList }) => renderList(null)}
          emptyState="No matching records"
        >
          {null}
        </CommandMenu>,
      );
    });

    expect(document.body.textContent).not.toContain("Default result");
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "No matching records",
    );
    expect(hasDefaultResults).not.toHaveBeenCalled();
  });

  it("does not show the empty state beside custom list rows", () => {
    const hasDefaultResults = vi.fn(() => false);

    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
          renderResults={() => null}
          renderResultsHasItems={hasDefaultResults}
          renderContent={({ renderList }) =>
            renderList(
              <CommandMenu.Group heading="Custom results">
                <CommandMenu.Item onSelect={() => undefined}>
                  Custom result
                </CommandMenu.Item>
              </CommandMenu.Group>,
            )
          }
          emptyState="No matching records"
        >
          {null}
        </CommandMenu>,
      );
    });

    expect(document.body.textContent).toContain("Custom result");
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(hasDefaultResults).not.toHaveBeenCalled();
  });

  it("accepts a presence hint for custom component results", () => {
    function EmptyCustomResults() {
      return null;
    }

    const hasDefaultResults = vi.fn(() => true);

    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
          renderResults={() => (
            <CommandMenu.Group heading="Default results">
              <CommandMenu.Item onSelect={() => undefined}>
                Default result
              </CommandMenu.Item>
            </CommandMenu.Group>
          )}
          renderResultsHasItems={hasDefaultResults}
          renderContent={({ renderList }) =>
            renderList(<EmptyCustomResults />, { hasSelectableItems: false })
          }
          emptyState="No matching records"
        >
          {null}
        </CommandMenu>,
      );
    });

    expect(document.body.textContent).not.toContain("Default result");
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "No matching records",
    );
    expect(hasDefaultResults).not.toHaveBeenCalled();
  });

  it("honors first and none initial selection modes", () => {
    const groups = [
      {
        id: "actions",
        order: 1,
        commands: [
          { id: "first", order: 1, label: "First", onSelect() {} },
          { id: "second", order: 2, label: "Second", onSelect() {} },
        ],
      },
    ];

    renderAppCommands({ groups, initialSelection: "first" });
    expect(
      document.querySelector(
        '[cmdk-item][data-value="app-command:actions:first"][aria-selected="true"]',
      ),
    ).toBeTruthy();

    renderAppCommands({ groups, initialSelection: "none", open: false });
    renderAppCommands({ groups, initialSelection: "none" });
    expect(
      document.querySelector('[cmdk-item][aria-selected="true"]'),
    ).toBeNull();

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    act(() =>
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(
      document.querySelector('[cmdk-item][aria-selected="true"]'),
    ).toBeTruthy();

    renderAppCommands({ groups, open: false });
    renderAppCommands({ groups });
    expect(
      document.querySelector(
        '[cmdk-item][data-value="app-command:actions:first"][aria-selected="true"]',
      ),
    ).toBeTruthy();
  });

  it("keeps typing unselected until keyboard navigation begins", () => {
    const onSelect = vi.fn();
    renderAppCommands({
      groups: [
        {
          id: "actions",
          order: 1,
          commands: [
            {
              id: "match",
              order: 1,
              label: "Matching action",
              deferSelect: false,
              onSelect,
            },
          ],
        },
      ],
      initialSelection: "none",
    });

    search("matching");
    expect(
      document.querySelector('[cmdk-item][aria-selected="true"]'),
    ).toBeNull();

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(input).toBeTruthy();
    act(() =>
      input!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onSelect).not.toHaveBeenCalled();

    act(() =>
      input!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(
      document.querySelector('[cmdk-item][aria-selected="true"]'),
    ).toBeTruthy();
    act(() =>
      input!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("selects the first app result when it arrives after the menu opens", () => {
    renderAppCommands({
      groups: [],
      initialSelection: "first",
      showSettingsCommand: false,
      showSignOutCommand: false,
    });
    expect(
      document.querySelector('[cmdk-item][aria-selected="true"]'),
    ).toBeNull();

    renderAppCommands({
      groups: [
        {
          id: "async-results",
          order: 1,
          commands: [
            {
              id: "first-result",
              order: 1,
              label: "First result",
              onSelect() {},
            },
          ],
        },
      ],
      initialSelection: "first",
      showSettingsCommand: false,
      showSignOutCommand: false,
    });

    expect(
      document.querySelector(
        '[cmdk-item][data-value="app-command:async-results:first-result"][aria-selected="true"]',
      ),
    ).toBeTruthy();
  });

  it("allows pointer selection when initialSelection is none", () => {
    renderAppCommands({
      groups: [
        {
          id: "actions",
          order: 1,
          commands: [{ id: "first", order: 1, label: "First", onSelect() {} }],
        },
      ],
      initialSelection: "none",
    });

    const row = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:actions:first"]',
    );
    expect(row).toBeTruthy();
    act(() => {
      row!.dispatchEvent(new Event("pointermove", { bubbles: true }));
    });

    expect(row?.getAttribute("aria-selected")).toBe("true");
  });

  it("allows direct pointer activation when initialSelection is none", () => {
    const onSelect = vi.fn();
    renderAppCommands({
      groups: [
        {
          id: "actions",
          order: 1,
          commands: [
            {
              id: "first",
              order: 1,
              label: "First",
              deferSelect: false,
              onSelect,
            },
          ],
        },
      ],
      initialSelection: "none",
    });

    const row = document.querySelector<HTMLElement>(
      '[cmdk-item][data-value="app-command:actions:first"]',
    );
    expect(row).toBeTruthy();
    act(() => {
      row!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      row!.click();
    });

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("portals the menu into an app-provided container", () => {
    const portalContainer = document.createElement("div");
    portalContainer.dataset.testid = "command-menu-portal";
    document.body.appendChild(portalContainer);

    renderAppCommands({ groups: [], container: portalContainer });

    expect(portalContainer.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.body.querySelector('[role="dialog"]')).toBe(
      portalContainer.querySelector('[role="dialog"]'),
    );
  });
});
