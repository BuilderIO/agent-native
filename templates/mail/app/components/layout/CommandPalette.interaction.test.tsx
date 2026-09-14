// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "commandPalette.search" ? "Search emails" : key,
}));

vi.mock("@agent-native/core/client/navigation", async () => {
  const React = await import("react");
  const Group = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children);
  const Item = ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect: () => void;
  }) => React.createElement("button", { onClick: onSelect }, children);
  const Shortcut = ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children);
  const Separator = () => React.createElement("hr");
  const CommandMenu = Object.assign(
    ({
      children,
      clearSearchOnEscape,
      onCloseAutoFocus,
    }: {
      children: React.ReactNode;
      clearSearchOnEscape?: boolean;
      onCloseAutoFocus?: (event: Event) => void;
    }) =>
      React.createElement(
        "div",
        {
          "data-clear-search-on-escape": String(Boolean(clearSearchOnEscape)),
          "data-has-close-auto-focus": String(Boolean(onCloseAutoFocus)),
        },
        children,
      ),
    { Group, Item, Shortcut, Separator },
  );

  return { CommandMenu };
});

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: "light",
    setTheme: vi.fn(),
    theme: "light",
  }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/use-emails", () => ({
  useSettings: () => ({ data: {} }),
  useUpdateSettings: () => ({ mutate: vi.fn() }),
}));

import { CommandPalette } from "./CommandPalette";

describe("CommandPalette Search action", () => {
  afterEach(() => {
    cleanup();
    mocks.navigate.mockReset();
  });

  it("delegates Search emails to the existing search focus path", () => {
    const onSearch = vi.fn();

    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        onCompose={vi.fn()}
        onSearch={onSearch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search emails /" }));

    expect(onSearch).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("opts into command-query clearing and focus restoration on Escape", () => {
    const onCloseAutoFocus = vi.fn();
    const { container } = render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        onCloseAutoFocus={onCloseAutoFocus}
        onCompose={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    expect(
      container.querySelector('[data-clear-search-on-escape="true"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-has-close-auto-focus="true"]'),
    ).toBeTruthy();
  });
});
