// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/use-account-filter", () => ({
  useAccountFilter: () => ({ activeAccounts: new Set(), allAccounts: [] }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/popover", async () => {
  const { createPortal } = await import("react-dom");
  return {
    Popover: ({ children }: { children: React.ReactNode }) => children,
    PopoverTrigger: ({ children }: { children: React.ReactNode }) => children,
    PopoverContent: ({
      children,
      className,
      onClick,
    }: {
      children: React.ReactNode;
      className?: string;
      onClick?: React.MouseEventHandler<HTMLDivElement>;
    }) =>
      createPortal(
        <div className={className} onClick={onClick}>
          {children}
        </div>,
        document.body,
      ),
  };
});

import { EmailListItem } from "./EmailListItem";

const email = {
  id: "message-1",
  threadId: "thread-1",
  from: { name: "Synthetic Sender", email: "sender@example.test" },
  to: [{ name: "Synthetic User", email: "user@example.test" }],
  subject: "Synthetic subject",
  snippet: "Synthetic snippet",
  body: "Synthetic body",
  date: new Date("2026-01-01T12:00:00.000Z").toISOString(),
  isRead: true,
  isStarred: false,
  isArchived: false,
  isTrashed: false,
  labelIds: [],
  accountEmail: "synthetic@example.test",
};

const thread = {
  id: "thread-1",
  latestMessage: email,
  messageCount: 1,
  participants: ["Synthetic Sender"],
  hasUnread: false,
  hasStarred: false,
  labelIds: [],
};

function renderRow(
  overrides: Partial<React.ComponentProps<typeof EmailListItem>> = {},
) {
  const props: React.ComponentProps<typeof EmailListItem> = {
    email,
    thread,
    isSelected: false,
    isFocused: false,
    onSelect: vi.fn(),
    onToggleMultiSelect: vi.fn(),
    onStar: vi.fn(),
    onHover: vi.fn(),
    ...overrides,
  };
  render(<EmailListItem {...props} />, { wrapper: MemoryRouter });
  return {
    row: screen.getByRole("row"),
    props,
  };
}

function touch(
  row: HTMLElement,
  type: "touchStart" | "touchMove",
  x: number,
  y = 0,
) {
  fireEvent[type](row, {
    touches: [{ identifier: 1, target: row, clientX: x, clientY: y }],
    changedTouches: [{ identifier: 1, target: row, clientX: x, clientY: y }],
  });
}

describe("EmailListItem touch swipe interactions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows trash for trashable rows and the importance menu when supplied", () => {
    renderRow({ canTrash: true, onTrash: vi.fn() });
    expect(screen.getByLabelText("mail.actions.moveToTrash")).toBeTruthy();
    expect(
      screen.queryByLabelText("mail.sort.priorityFeedbackLabel"),
    ).toBeNull();

    cleanup();
    renderRow({ onImportanceFeedback: vi.fn() });
    expect(
      screen.getByLabelText("mail.sort.priorityFeedbackLabel"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("mail.actions.moveToTrash")).toBeNull();
  });

  it.each([
    ["button", "mail.aiFilter.importantMode", "important"],
    ["button", "mail.aiFilter.notImportantMode", "not-important"],
    ["link", "mail.sort.priorityEditRules", undefined],
  ] as const)(
    "keeps the row closed when the score popover's %s is selected",
    (role, name, decision) => {
      const onImportanceFeedback = vi.fn();
      const { props } = renderRow({
        importanceScore: 0.91,
        onImportanceFeedback,
      });

      fireEvent.click(
        screen.getByRole("button", { name: "mail.sort.priority 0.91" }),
      );
      const control = screen.getByRole(role, { name });
      fireEvent.click(control);

      expect(props.onSelect).not.toHaveBeenCalled();
      if (decision) expect(onImportanceFeedback).toHaveBeenCalledWith(decision);
    },
  );

  it("keeps both score feedback labels on one line", () => {
    renderRow({ importanceScore: 0.91 });
    fireEvent.click(
      screen.getByRole("button", { name: "mail.sort.priority 0.91" }),
    );

    expect(
      screen.getByRole("button", { name: "mail.aiFilter.notImportantMode" })
        .className,
    ).toContain("whitespace-nowrap");
  });

  it("commits left archive at 80px after the 180ms handoff, then suppresses the trailing click", () => {
    const onSwipeArchive = vi.fn();
    const { row, props } = renderRow({ onSwipeArchive });

    touch(row, "touchStart", 120);
    touch(row, "touchMove", 40);
    fireEvent.touchEnd(row);

    expect(onSwipeArchive).not.toHaveBeenCalled();
    expect(row.style.transform).toBe(`translateX(${-window.innerWidth}px)`);
    vi.advanceTimersByTime(179);
    expect(onSwipeArchive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSwipeArchive).toHaveBeenCalledExactlyOnceWith(thread);

    fireEvent.click(row);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("commits right snooze at the 80px threshold immediately and suppresses the trailing click", () => {
    const onSwipeSnooze = vi.fn();
    const { row, props } = renderRow({ onSwipeSnooze });

    touch(row, "touchStart", 20);
    touch(row, "touchMove", 100);
    fireEvent.touchEnd(row);

    expect(onSwipeSnooze).toHaveBeenCalledExactlyOnceWith(thread);
    expect(row.style.transform).toBe("translateX(0px)");
    fireEvent.click(row);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("snaps back without action when a horizontal swipe ends below 80px", () => {
    const onSwipeArchive = vi.fn();
    const { row, props } = renderRow({ onSwipeArchive });

    touch(row, "touchStart", 100);
    vi.advanceTimersByTime(1_000);
    touch(row, "touchMove", 21);
    fireEvent.touchEnd(row);

    expect(onSwipeArchive).not.toHaveBeenCalled();
    expect(row.style.transform).toBe("translateX(0px)");
    fireEvent.click(row);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("commits a 56px left fling above 0.11px/ms", () => {
    const onSwipeArchive = vi.fn();
    const { row } = renderRow({ onSwipeArchive });

    touch(row, "touchStart", 120);
    vi.advanceTimersByTime(100);
    touch(row, "touchMove", 76);
    vi.advanceTimersByTime(100);
    touch(row, "touchMove", 64);
    fireEvent.touchEnd(row);

    expect(onSwipeArchive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(180);
    expect(onSwipeArchive).toHaveBeenCalledExactlyOnceWith(thread);
  });

  it("commits a 56px right fling above 0.11px/ms", () => {
    const onSwipeSnooze = vi.fn();
    const { row } = renderRow({ onSwipeSnooze });

    touch(row, "touchStart", 20);
    vi.advanceTimersByTime(100);
    touch(row, "touchMove", 64);
    vi.advanceTimersByTime(100);
    touch(row, "touchMove", 76);
    fireEvent.touchEnd(row);

    expect(onSwipeSnooze).toHaveBeenCalledExactlyOnceWith(thread);
  });

  it("does not commit a 56px movement whose release velocity is below 0.11px/ms", () => {
    const onSwipeSnooze = vi.fn();
    const { row } = renderRow({ onSwipeSnooze });

    touch(row, "touchStart", 20);
    vi.advanceTimersByTime(100);
    touch(row, "touchMove", 66);
    vi.advanceTimersByTime(100);
    touch(row, "touchMove", 76);
    fireEvent.touchEnd(row);

    expect(onSwipeSnooze).not.toHaveBeenCalled();
    expect(row.style.transform).toBe("translateX(0px)");
  });

  it("locks vertical and diagonal-dominant movement to scrolling, not swipe actions", () => {
    for (const [dx, dy] of [
      [8, 24],
      [18, 16],
    ]) {
      const onSwipeSnooze = vi.fn();
      const { row } = renderRow({ onSwipeSnooze });

      touch(row, "touchStart", 20, 20);
      touch(row, "touchMove", 20 + dx, 20 + dy);
      touch(row, "touchMove", 120, 20 + dy);
      fireEvent.touchEnd(row);

      expect(onSwipeSnooze).not.toHaveBeenCalled();
      expect(row.style.transform).toBe("translateX(0px)");
      cleanup();
    }
  });

  it("resets a canceled horizontal gesture and allows the next independent row click", () => {
    const onSwipeArchive = vi.fn();
    const { row, props } = renderRow({ onSwipeArchive });

    touch(row, "touchStart", 120);
    touch(row, "touchMove", 40);
    fireEvent.touchCancel(row);

    expect(row.style.transform).toBe("translateX(0px)");
    expect(onSwipeArchive).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(thread);
  });

  it("does not start swiping without swipe handlers", () => {
    const { row, props } = renderRow();

    touch(row, "touchStart", 120);
    touch(row, "touchMove", 20);
    fireEvent.touchEnd(row);
    fireEvent.click(row);

    expect(row.style.transform).toBe("");
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(thread);
  });

  it("uses localized read-state labels in the hover action tooltip", () => {
    const unreadTooltipRow = renderRow({ onToggleRead: vi.fn() }).row;
    expect(unreadTooltipRow.textContent).toContain("mail.actions.markUnread");

    cleanup();
    const readTooltipRow = renderRow({
      email: { ...email, isRead: false },
      thread: {
        ...thread,
        latestMessage: { ...email, isRead: false },
        hasUnread: true,
      },
      onToggleRead: vi.fn(),
    }).row;
    expect(readTooltipRow.textContent).toContain("mail.actions.markRead");
  });

  it("names every visible row action for keyboard and assistive technology", () => {
    renderRow({
      onToggleRead: vi.fn(),
      onArchive: vi.fn(),
      canArchive: true,
      onSnooze: vi.fn(),
      canSnooze: true,
      onImportanceFeedback: vi.fn(),
      onSendNow: vi.fn(),
      onCancelSchedule: vi.fn(),
      scheduledJobId: "scheduled-1",
    });

    for (const name of [
      "mail.selection.selectEmail",
      "mail.actions.markUnread",
      "mail.actions.archive",
      "mail.snooze.snooze",
      "mail.sendLater.sendNow",
      "mail.sendLater.cancelScheduledSend",
      "mail.sort.priorityFeedbackLabel",
      "mail.actions.star",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }

    cleanup();
    renderRow({
      email: { ...email, isRead: false, isStarred: true },
      thread: {
        ...thread,
        latestMessage: { ...email, isRead: false, isStarred: true },
        hasUnread: true,
        hasStarred: true,
      },
      isMultiSelected: true,
      onToggleRead: vi.fn(),
    });

    expect(
      screen.getByRole("button", { name: "mail.selection.deselectEmail" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "mail.actions.markRead" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "mail.actions.unstar" }),
    ).toBeTruthy();
  });

  it("does not reveal or commit the direction whose handler is absent", () => {
    const onSwipeArchive = vi.fn();
    const { row } = renderRow({ onSwipeArchive });

    touch(row, "touchStart", 20);
    touch(row, "touchMove", 120);
    expect(row.style.transform).toBe("translateX(0px)");
    fireEvent.touchEnd(row);

    expect(onSwipeArchive).not.toHaveBeenCalled();
  });
});
