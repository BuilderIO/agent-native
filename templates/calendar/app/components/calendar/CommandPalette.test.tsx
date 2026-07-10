// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette, type QuickCreateEvent } from "./CommandPalette";

vi.mock("@agent-native/core/client", async () => {
  const React = await import("react");

  const CommandMenu = Object.assign(
    ({
      children,
      open,
      renderResults,
    }: {
      children: React.ReactNode;
      open: boolean;
      renderResults?: (search: string) => React.ReactNode;
    }) => {
      const [search, setSearch] = React.useState("");
      if (!open) return null;

      return (
        <div>
          <input
            aria-label="Command search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {renderResults?.(search)}
          {children}
        </div>
      );
    },
    {
      Group: ({ children }: { children: React.ReactNode }) => (
        <section>{children}</section>
      ),
      Item: ({
        children,
        onSelect,
      }: {
        children: React.ReactNode;
        onSelect: () => void;
      }) => (
        <button type="button" onClick={onSelect}>
          {children}
        </button>
      ),
      Shortcut: ({ children }: { children: React.ReactNode }) => (
        <span>{children}</span>
      ),
      Separator: () => <hr />,
    },
  );

  return {
    CommandMenu,
    useT:
      () =>
      (key: string, values?: Record<string, unknown>): string =>
        values?.title ? `${key}: ${String(values.title)}` : key,
  };
});

describe("CommandPalette quick create", () => {
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
    vi.unstubAllGlobals();
  });

  it("keeps a parsed natural-language result selectable for the full query", () => {
    const onCreateEventFromText = vi.fn<(event: QuickCreateEvent) => void>();

    act(() => {
      root.render(
        <CommandPalette
          open
          onClose={() => undefined}
          events={[] as CalendarEvent[]}
          onGoToDate={() => undefined}
          onEventClick={() => undefined}
          onCreateEvent={() => undefined}
          onCreateEventFromText={onCreateEventFromText}
          onViewChange={() => undefined}
          onToday={() => undefined}
        />,
      );
    });

    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Command search"]',
    );
    expect(input).toBeTruthy();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Lunch with Pat tomorrow 12:30");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const quickCreateButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Lunch with Pat"));
    expect(quickCreateButton).toBeTruthy();

    act(() => quickCreateButton!.click());

    expect(onCreateEventFromText).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Lunch with Pat",
        hasExplicitTime: true,
      }),
    );
  });
});
