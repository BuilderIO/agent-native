// @vitest-environment happy-dom

import { CommandMenu } from "@agent-native/core/client/navigation";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

import { useCommandPaletteFocus } from "./use-command-palette-focus";

const mocks = vi.hoisted(() => ({
  contacts: [
    { name: "Ada Example", email: "ada@example.test" },
    { name: "Bea Example", email: "bea@example.test" },
  ],
  emails: [
    {
      id: "message-ad",
      threadId: "thread-ad",
      subject: "Advisory update",
      from: { name: "Alex Sender", email: "alex@example.test" },
      snippet: "A synthetic message for search interaction coverage.",
      accountEmail: "demo@example.test",
    },
    {
      id: "message-be",
      threadId: "thread-be",
      subject: "Before launch",
      from: { name: "Blair Sender", email: "blair@example.test" },
      snippet: "A second synthetic message for search interaction coverage.",
      accountEmail: "demo@example.test",
    },
  ],
  getQueriesData: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", () => ({
  useIsFetching: () => 0,
  useQueryClient: () => ({ getQueriesData: mocks.getQueriesData }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/hooks/use-emails", () => ({
  useContacts: () => ({ data: mocks.contacts }),
}));

vi.mock("@/lib/thread-cache", () => ({
  ensureThread: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("@/lib/threads", () => ({
  groupIntoThreads: (emails: Array<Record<string, unknown>>) =>
    emails.map((latestMessage) => ({ latestMessage })),
}));

import { SearchBar } from "./SearchBar";

function SearchPaletteHarness({
  initialQuery = "",
  hasActiveSearch = false,
}: { initialQuery?: string; hasActiveSearch?: boolean } = {}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchMounted, setSearchMounted] = useState(true);
  const { openPalette, handleOpenChange, restoreFocusAfterEscape } =
    useCommandPaletteFocus(paletteOpen, setPaletteOpen);

  useKeyboardShortcuts([
    { key: "k", meta: true, handler: openPalette, skipInInput: false },
  ]);

  return (
    <>
      {searchMounted ? (
        <SearchBar
          autoFocus
          hasActiveSearch={hasActiveSearch}
          initialQuery={initialQuery}
          onClose={() => setSearchMounted(false)}
        />
      ) : (
        <input
          id="mail-search"
          className="sr-only"
          tabIndex={-1}
          onFocus={() => setSearchMounted(true)}
        />
      )}
      <CommandMenu
        open={paletteOpen}
        onOpenChange={handleOpenChange}
        onCloseAutoFocus={restoreFocusAfterEscape}
        clearSearchOnEscape
        placeholder="Search commands"
        showAgentFallback={false}
      >
        <CommandMenu.Group heading="Actions">
          <CommandMenu.Item onSelect={() => undefined} deferSelect={false}>
            Archive
          </CommandMenu.Item>
        </CommandMenu.Group>
      </CommandMenu>
    </>
  );
}

describe("SearchBar suggestion selection", () => {
  beforeEach(() => {
    mocks.getQueriesData.mockReturnValue([
      [["emails", "synthetic-fixture"], { pages: [{ emails: mocks.emails }] }],
    ]);
    mocks.navigate.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("exposes localized search and clear labels to assistive technology", () => {
    render(<SearchBar onClose={vi.fn()} />);

    const search = screen.getByRole("combobox", {
      name: "mail.search.label",
    });
    expect(search).toBeTruthy();

    fireEvent.change(search, { target: { value: "synthetic no-match" } });

    expect(
      screen.getByRole("button", { name: "mail.search.clear" }),
    ).toBeTruthy();
  });

  it("clears an active query when the visible clear control is clicked", () => {
    const onClose = vi.fn();
    render(
      <SearchBar
        hasActiveSearch
        initialQuery="synthetic active search"
        onClose={onClose}
      />,
    );

    fireEvent.mouseDown(
      screen.getByRole("button", { name: "mail.search.clear" }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
  });

  it("clears an active query through keyboard button activation", () => {
    const onClose = vi.fn();
    render(
      <SearchBar
        hasActiveSearch
        initialQuery="synthetic keyboard search"
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "mail.search.clear" }), {
      detail: 0,
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
  });

  it("keeps Enter aligned with the visible selection after same-size results change", () => {
    render(<SearchBar onClose={vi.fn()} />);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "ad" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      "mail-search-suggestion-1",
    );

    fireEvent.change(input, { target: { value: "be" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[1].textContent).toContain("Before launch");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[1].getAttribute("id"),
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.navigate).toHaveBeenCalledWith("/all/thread-be");
  });

  it("drops a stale selection before Enter when a rapid query change removes all results", () => {
    render(<SearchBar onClose={vi.fn()} />);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "ad" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    act(() => {
      fireEvent.change(input, { target: { value: "be" } });
      fireEvent.change(input, { target: { value: "xy" } });
    });

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["one-character", " a "],
    ["two-character", " ab "],
  ])("does not auto-navigate for a trimmed %s query", (_label, query) => {
    vi.useFakeTimers();
    render(<SearchBar onClose={vi.fn()} />);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: query } });
    act(() => vi.advanceTimersByTime(1_000));

    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("auto-navigates a trimmed three-character query at 400ms", () => {
    vi.useFakeTimers();
    render(<SearchBar onClose={vi.fn()} />);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: " a b " } });
    act(() => vi.advanceTimersByTime(399));
    expect(mocks.navigate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/all?q=a%20b");
  });

  it("submits a qualifying query immediately on Enter without a second timed navigation", () => {
    vi.useFakeTimers();
    render(<SearchBar onClose={vi.fn()} />);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: " a b " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/all?q=a%20b");

    act(() => vi.advanceTimersByTime(400));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it("returns focus to Search when the command palette outlives its search input", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    render(<SearchPaletteHarness />);
    const search = screen.getByRole("combobox");
    expect(document.activeElement).toBe(search);

    const shortcutEvent = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => search.dispatchEvent(shortcutEvent));
    expect(shortcutEvent.defaultPrevented).toBe(true);

    const commandInput =
      document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(commandInput).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(commandInput));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(search.isConnected).toBe(false);
    expect(document.getElementById("mail-search")).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("combobox"));
    });
  });

  it("clears the palette query before dismissal without changing active Mail search", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    render(<SearchPaletteHarness initialQuery="abc" hasActiveSearch />);
    const search = screen.getByRole("combobox", {
      name: "mail.search.label",
    }) as HTMLInputElement;
    expect(search.value).toBe("abc");

    const shortcutEvent = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => search.dispatchEvent(shortcutEvent));

    const commandInput =
      document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(commandInput).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(commandInput));

    fireEvent.change(commandInput!, { target: { value: "archive" } });
    expect(commandInput?.value).toBe("archive");

    const pressEscape = () =>
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      });

    pressEscape();
    expect(commandInput?.value).toBe("");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(search.value).toBe("abc");
    expect(mocks.navigate).not.toHaveBeenCalled();

    pressEscape();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(search.value).toBe("abc");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("cancels the pending Search collapse when focus returns before the delay", () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    render(<SearchPaletteHarness />);
    const search = screen.getByRole("combobox");
    const shortcutEvent = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => search.dispatchEvent(shortcutEvent));

    const commandInput =
      document.querySelector<HTMLInputElement>("[cmdk-input]");
    expect(commandInput).toBeTruthy();
    expect(document.activeElement).toBe(commandInput);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    act(() => vi.advanceTimersByTime(120));

    expect(search.isConnected).toBe(true);
    expect(document.activeElement).toBe(search);
  });
});
