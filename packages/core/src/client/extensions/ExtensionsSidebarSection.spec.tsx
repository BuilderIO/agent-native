// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtensionsSidebarSection } from "./ExtensionsSidebarSection.js";

vi.mock("../agent-chat.js", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("../composer/PromptComposer.js", () => ({
  PromptComposer: ({ placeholder }: { placeholder: string }) => (
    <textarea aria-label={placeholder} placeholder={placeholder} />
  ),
}));

vi.mock("../components/ui/dropdown-menu.js", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuCheckboxItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuRadioItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <div />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../components/ui/hover-card.js", () => ({
  HoverCard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../components/ui/tooltip.js", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../components/ui/popover.js", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const PopoverContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>({
    open: false,
    onOpenChange: () => {},
  });

  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <PopoverContext.Provider
        value={{
          open: Boolean(open),
          onOpenChange: onOpenChange ?? (() => {}),
        }}
      >
        {children}
      </PopoverContext.Provider>
    ),
    PopoverContent: ({
      children,
      className,
      collisionPadding,
    }: {
      children: React.ReactNode;
      className?: string;
      collisionPadding?: number;
    }) => {
      const context = React.useContext(PopoverContext);
      if (!context.open) return null;
      return (
        <div
          className={className}
          data-collision-padding={collisionPadding}
          data-testid="extension-create-popover"
        >
          {children}
        </div>
      );
    },
    PopoverTrigger: ({ children }: { children: React.ReactElement }) => {
      const context = React.useContext(PopoverContext);
      return React.cloneElement(children, {
        "data-state": context.open ? "open" : "closed",
        onClick: () => context.onOpenChange(!context.open),
      });
    },
  };
});

describe("ExtensionsSidebarSection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([])),
    );

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

  it("renders the create popover above raised app surfaces", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <ExtensionsSidebarSection />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });

    const createButton = container.querySelector(
      'button[aria-label="New extension"]',
    ) as HTMLButtonElement | null;
    expect(createButton).not.toBeNull();

    act(() => {
      createButton?.click();
    });

    const popover = container.querySelector(
      '[data-testid="extension-create-popover"]',
    ) as HTMLDivElement | null;
    expect(popover).not.toBeNull();
    expect(popover?.className).toContain("relative");
    expect(popover?.className).toContain("z-[360]");
    expect(popover?.className).toContain("w-[min(420px,calc(100vw-16px))]");
    expect(popover?.dataset.collisionPadding).toBe("8");
  });
});
