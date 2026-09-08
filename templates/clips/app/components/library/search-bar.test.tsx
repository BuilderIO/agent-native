// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  searchParams: new URLSearchParams(),
  setSearchParams: vi.fn(),
  useRecordingSearch: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tabler/icons-react", () => {
  const Icon = () => <span />;
  return { IconClock: Icon, IconSearch: Icon, IconX: Icon };
});

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock("@/components/player/scrubber", () => ({
  msToClock: (value: number) => String(value),
}));

vi.mock("@/components/ui/popover", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Popover: Passthrough,
    PopoverContent: Passthrough,
    PopoverAnchor: Passthrough,
  };
});

vi.mock("@/hooks/use-library", () => ({
  useRecordingSearch: mocks.useRecordingSearch,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | undefined>) =>
    values.filter(Boolean).join(" "),
  shortcutLabel: (shortcut: string) => shortcut,
}));

import { SearchBar } from "./search-bar";

describe("SearchBar command-menu handoff", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    mocks.navigate.mockReset();
    mocks.searchParams = new URLSearchParams();
    mocks.setSearchParams.mockReset();
    mocks.useRecordingSearch.mockReset().mockReturnValue({
      data: { results: [] },
      isFetching: false,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (vi.isFakeTimers()) {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
    vi.unstubAllGlobals();
  });

  it("focuses the recordings input and clears the route marker", () => {
    mocks.searchParams = new URLSearchParams({ focus: "search" });
    act(() => root.render(<SearchBar />));

    const input = container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(mocks.setSearchParams).toHaveBeenCalledWith(expect.any(Function), {
      replace: true,
    });
  });

  it("leaves Cmd+K available for the app command menu", () => {
    act(() => root.render(<SearchBar />));

    const input = container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "k",
          metaKey: true,
        }),
      );
    });

    expect(document.activeElement).not.toBe(input);
    expect(mocks.setSearchParams).not.toHaveBeenCalled();
  });

  it("shows the slash shortcut for inline recording search", () => {
    act(() => root.render(<SearchBar />));

    expect(container.textContent).toContain("/");
    const input = container.querySelector<HTMLInputElement>("input");
    expect(input?.type).toBe("search");
    expect(input?.getAttribute("aria-label")).toBe("searchBar.placeholder");
    expect(input?.className).toContain("focus-visible:ring-inset");
    expect(input?.className).toContain("focus-visible:ring-offset-0");
    expect(input?.className).toContain("focus-visible:ring-ring/40");
    expect(container.querySelector("kbd")?.dataset.slot).toBe("kbd");
    expect(container.querySelector("kbd")?.textContent).toBe("/");
    expect(container.textContent).not.toContain("cmd+k");
  });

  it("searches only the latest query after 200ms", () => {
    vi.useFakeTimers();
    act(() => root.render(<SearchBar />));

    const input = container.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();

    const inputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    expect(inputValueSetter).toBeDefined();

    const enterQuery = (query: string) => {
      act(() => {
        if (!input || !inputValueSetter) return;
        inputValueSetter.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    enterQuery("c");
    act(() => vi.advanceTimersByTime(100));
    enterQuery("cl");
    act(() => vi.advanceTimersByTime(100));
    enterQuery("clip");

    expect(input?.value).toBe("clip");
    expect(mocks.useRecordingSearch).not.toHaveBeenCalledWith("c");
    expect(mocks.useRecordingSearch).not.toHaveBeenCalledWith("cl");
    expect(mocks.useRecordingSearch).not.toHaveBeenCalledWith("clip");

    act(() => vi.advanceTimersByTime(199));
    expect(mocks.useRecordingSearch).not.toHaveBeenCalledWith("clip");

    act(() => vi.advanceTimersByTime(1));
    expect(mocks.useRecordingSearch).toHaveBeenLastCalledWith("clip");
  });
});
