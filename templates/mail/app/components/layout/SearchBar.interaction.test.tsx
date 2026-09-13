// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});
