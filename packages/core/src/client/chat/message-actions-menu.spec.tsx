// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  message: {
    id: "assistant-ui-local-id",
    content: [{ type: "text", text: "Done" }],
    metadata: { custom: { runId: "server-run-id" } },
    createdAt: "2026-08-10T12:00:00.000Z",
  },
  writeClipboardText: vi.fn(),
  getActiveRun: vi.fn(),
}));

vi.mock("@assistant-ui/react", () => ({
  useMessageRuntime: () => ({ getState: () => harness.message }),
}));

vi.mock("../clipboard.js", () => ({
  writeClipboardText: harness.writeClipboardText,
}));

vi.mock("../active-run-state.js", () => ({
  getActiveRun: harness.getActiveRun,
}));

vi.mock("../components/ui/dropdown-menu.js", async () => {
  const React = await import("react");
  const MenuContext = React.createContext<{
    onOpenChange: (open: boolean) => void;
  } | null>(null);

  return {
    DropdownMenu: ({
      children,
      onOpenChange,
    }: {
      children: React.ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <MenuContext.Provider
        value={{ onOpenChange: onOpenChange ?? (() => undefined) }}
      >
        {children}
      </MenuContext.Provider>
    ),
    DropdownMenuTrigger: ({ children }: { children: React.ReactElement }) => {
      const menu = React.useContext(MenuContext);
      return React.cloneElement(children, {
        onClick: () => menu?.onOpenChange(true),
      });
    },
    DropdownMenuContent: ({
      children,
      className: _className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <div role="menu">{children}</div>,
    DropdownMenuItem: ({
      children,
      onSelect,
    }: {
      children: React.ReactNode;
      onSelect?: (event: { preventDefault: () => void }) => void;
    }) => (
      <button
        type="button"
        role="menuitem"
        onClick={() => onSelect?.({ preventDefault: () => undefined })}
      >
        {children}
      </button>
    ),
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
      <span>{children}</span>
    ),
    DropdownMenuSeparator: () => <hr />,
  };
});

import { MessageActionsMenu } from "./message-components.js";

describe("MessageActionsMenu request ID copy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    harness.writeClipboardText.mockReset();
    harness.getActiveRun.mockReset();
    harness.message = {
      id: "assistant-ui-local-id",
      content: [{ type: "text", text: "Done" }],
      metadata: { custom: { runId: "server-run-id" } },
      createdAt: "2026-08-10T12:00:00.000Z",
    };
    harness.writeClipboardText.mockResolvedValue(true);
    harness.getActiveRun.mockReturnValue(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function openAndSelectRequestId(
    ui: React.ReactElement = <MessageActionsMenu />,
  ) {
    await act(async () => {
      root.render(ui);
    });
    const trigger = container.querySelector(
      'button[aria-label="Message actions"]',
    );
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const item = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((candidate) => candidate.textContent?.includes("Copy request ID"));
    expect(item).toBeTruthy();
    await act(async () => {
      item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("copies the server run ID, never the local assistant-ui message ID", async () => {
    await openAndSelectRequestId();

    expect(harness.writeClipboardText).toHaveBeenCalledWith("server-run-id");
    expect(harness.writeClipboardText).not.toHaveBeenCalledWith(
      "assistant-ui-local-id",
    );
  });

  it("does not copy an active run belonging to another thread", async () => {
    harness.message = { ...harness.message, metadata: undefined };
    harness.getActiveRun.mockReturnValue({
      threadId: "other-thread",
      runId: "other-thread-run",
    });

    await openAndSelectRequestId(
      <MessageActionsMenu threadId="current-thread" />,
    );

    expect(harness.writeClipboardText).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Request ID unavailable");
  });

  it("shows truthful feedback when clipboard writing fails", async () => {
    harness.writeClipboardText.mockResolvedValue(false);

    await openAndSelectRequestId();

    expect(container.textContent).toContain("Copy failed");
  });

  it("shows truthful feedback when no server ID exists", async () => {
    harness.message = {
      ...harness.message,
      metadata: undefined,
    };

    await openAndSelectRequestId();

    expect(harness.writeClipboardText).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Request ID unavailable");
  });
});
