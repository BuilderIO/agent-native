// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtensionsListPage } from "./ExtensionsListPage.js";

vi.mock("../agent-chat.js", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("../AgentPanel.js", () => ({
  AgentToggleButton: () => <button type="button">Agent</button>,
}));

vi.mock("../composer/PromptComposer.js", () => ({
  PromptComposer: ({ placeholder }: { placeholder: string }) => (
    <textarea aria-label={placeholder} placeholder={placeholder} />
  ),
}));

vi.mock("../components/ui/dropdown-menu.js", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const DropdownContext = React.createContext<{
    open: boolean;
    setOpen: (open: boolean) => void;
  }>({
    open: false,
    setOpen: () => {},
  });

  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      return (
        <DropdownContext.Provider value={{ open, setOpen }}>
          {children}
        </DropdownContext.Provider>
      );
    },
    DropdownMenuCheckboxItem: ({
      children,
      checked,
      onCheckedChange,
    }: {
      children: React.ReactNode;
      checked?: boolean;
      onCheckedChange?: (checked: boolean) => void;
    }) => (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={Boolean(checked)}
        onClick={() => onCheckedChange?.(!checked)}
      >
        {children}
      </button>
    ),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => {
      const context = React.useContext(DropdownContext);
      return context.open ? <div role="menu">{children}</div> : null;
    },
    DropdownMenuTrigger: ({ children }: { children: React.ReactElement }) => {
      const context = React.useContext(DropdownContext);
      return React.cloneElement(children, {
        onClick: () => context.setOpen(!context.open),
      });
    },
  };
});

vi.mock("../components/ui/popover.js", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe("ExtensionsListPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderListPage() {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/extensions"]}>
          <QueryClientProvider client={queryClient}>
            <ExtensionsListPage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
  }

  it("keeps show hidden inside the header overflow menu", async () => {
    await renderListPage();

    expect(container.textContent).not.toContain("Show hidden");

    const optionsButton = container.querySelector(
      'button[aria-label="Options for Extensions"]',
    ) as HTMLButtonElement | null;
    expect(optionsButton).not.toBeNull();

    await act(async () => {
      optionsButton?.click();
    });

    const showHiddenItem = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Show hidden");
    expect(showHiddenItem).toBeTruthy();

    await act(async () => {
      showHiddenItem?.click();
    });

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes("includeGloballyHidden=true"),
        ),
      ).toBe(true);
    });
  });
});
