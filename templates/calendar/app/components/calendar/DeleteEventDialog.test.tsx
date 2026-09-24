// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import {
  act,
  type KeyboardEventHandler,
  type ReactNode,
  useEffect,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeleteEventDialog } from "./DeleteEventDialog";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string): string =>
      key,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogContent: ({
    children,
    onKeyDown,
    onOpenAutoFocus,
  }: {
    children: ReactNode;
    onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
    onOpenAutoFocus?: (event: { preventDefault: () => void }) => void;
  }) => {
    useEffect(() => {
      onOpenAutoFocus?.({ preventDefault: vi.fn() });
    }, [onOpenAutoFocus]);
    return <div onKeyDown={onKeyDown}>{children}</div>;
  },
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <h2>{children}</h2>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RadioGroupItem: ({ value }: { value: string }) => (
    <input type="radio" value={value} />
  ),
}));

describe("DeleteEventDialog", () => {
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

  it("focuses the delete action so Enter can confirm the default scope", () => {
    const onConfirm = vi.fn();
    const event: CalendarEvent = {
      id: "event-1",
      title: "Recurring sync",
      description: "",
      location: "",
      start: "2026-07-12T16:00:00.000Z",
      end: "2026-07-12T16:30:00.000Z",
      allDay: false,
      source: "google",
      recurringEventId: "series-1",
      createdAt: "2026-07-12T15:00:00.000Z",
      updatedAt: "2026-07-12T15:00:00.000Z",
    };

    act(() => {
      root.render(
        <DeleteEventDialog
          event={event}
          open
          onClose={() => undefined}
          onConfirm={onConfirm}
        />,
      );
    });

    const deleteButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "deleteEvent.deleteEvent",
    );
    expect(deleteButton).toBeTruthy();
    expect(document.activeElement).toBe(deleteButton);

    act(() => deleteButton!.click());

    expect(onConfirm).toHaveBeenCalledWith({
      scope: "single",
      sendUpdates: "none",
      notificationMessage: undefined,
      removeOnly: false,
    });
  });

  it("focuses the no-notification action when deleting an event with guests", () => {
    const event: CalendarEvent = {
      id: "event-with-guests",
      title: "Customer call",
      description: "",
      location: "",
      start: "2026-07-12T16:00:00.000Z",
      end: "2026-07-12T16:30:00.000Z",
      allDay: false,
      source: "google",
      organizer: { email: "owner@example.com", self: true },
      attendees: [
        { email: "owner@example.com", self: true, organizer: true },
        { email: "guest@example.com" },
      ],
      createdAt: "2026-07-12T15:00:00.000Z",
      updatedAt: "2026-07-12T15:00:00.000Z",
    };

    act(() => {
      root.render(
        <DeleteEventDialog
          event={event}
          open
          onClose={() => undefined}
          onConfirm={() => undefined}
        />,
      );
    });

    const dontNotifyButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => button.textContent === "deleteEvent.dontNotify");
    expect(dontNotifyButton).toBeTruthy();
    expect(document.activeElement).toBe(dontNotifyButton);
  });
});
