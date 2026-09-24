// @vitest-environment happy-dom

import * as React from "react";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FindTimeTakeover } from "./FindTimePanel";

const { useActionQuery } = vi.hoisted(() => ({
  useActionQuery: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({ useActionQuery }));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/calendar/AttendeeAutocomplete", () => ({
  AttendeeAutocomplete: () => null,
}));

vi.mock("@/components/ui/dialog", () => {
  let onOpenChange: ((open: boolean) => void) | undefined;

  return {
    Dialog: ({
      open,
      children,
      onOpenChange: nextOnOpenChange,
    }: {
      open?: boolean;
      children?: ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => {
      onOpenChange = nextOnOpenChange;
      return open ? <div>{children}</div> : null;
    },
    DialogClose: ({ children }: { children?: ReactNode }) => {
      if (
        !React.isValidElement<{ onClick?: React.MouseEventHandler }>(children)
      ) {
        return null;
      }
      return React.cloneElement(children, {
        onClick: (event) => {
          children.props.onClick?.(event);
          onOpenChange?.(false);
        },
      });
    },
    DialogContent: ({
      children,
      className,
      overlayClassName,
    }: {
      children?: ReactNode;
      className?: string;
      overlayClassName?: string;
    }) => (
      <div
        data-dialog-content-class={className}
        data-dialog-overlay-class={overlayClassName}
      >
        {children}
      </div>
    ),
    DialogDescription: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    DialogTitle: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

describe("FindTimeTakeover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useActionQuery.mockReturnValue({
      data: undefined,
      isFetching: false,
      isLoading: false,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("closes from the labeled header action on the first click", () => {
    const onOpenChange = vi.fn();

    act(() => {
      root.render(
        <FindTimeTakeover
          open
          onOpenChange={onOpenChange}
          title="Find a time"
          subtitle="Test event"
          date="2026-08-09"
          timezone="America/New_York"
          durationMinutes={30}
          attendees={[]}
          onSelectSlot={() => undefined}
        />,
      );
    });

    const closeButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="eventDialog.close"]',
    );
    expect(closeButton).toBeTruthy();
    expect(closeButton?.className).toContain("h-10");

    act(() => closeButton?.click());

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders above nested event popovers", () => {
    act(() => {
      root.render(
        <FindTimeTakeover
          open
          onOpenChange={() => undefined}
          title="Find a time"
          date="2026-08-09"
          timezone="America/New_York"
          durationMinutes={30}
          attendees={[]}
          onSelectSlot={() => undefined}
        />,
      );
    });

    expect(
      document
        .querySelector("[data-dialog-content-class]")
        ?.getAttribute("data-dialog-content-class"),
    ).toContain("z-[320]");
    expect(
      document
        .querySelector("[data-dialog-overlay-class]")
        ?.getAttribute("data-dialog-overlay-class"),
    ).toContain("z-[310]");
  });

  it("keeps evening suggestions inside the time grid", () => {
    useActionQuery.mockReturnValue({
      data: {
        range: {
          from: "2026-08-09T00:00:00.000Z",
          to: "2026-08-16T00:00:00.000Z",
          timezone: "UTC",
          durationMinutes: 30,
          slotStepMinutes: 30,
        },
        googleConnected: true,
        participants: [],
        busy: [
          {
            participantEmail: "guest@example.com",
            start: "2026-08-09T20:00:00.000Z",
            end: "2026-08-09T21:00:00.000Z",
            title: "Evening conflict",
          },
        ],
        slots: [
          {
            start: "2026-08-09T20:00:00.000Z",
            end: "2026-08-09T20:30:00.000Z",
            date: "2026-08-09",
            durationMinutes: 30,
            availableParticipantEmails: [],
            unavailableParticipantEmails: [],
          },
        ],
      },
      isFetching: false,
      isLoading: false,
    });

    act(() => {
      root.render(
        <FindTimeTakeover
          open
          onOpenChange={() => undefined}
          date="2026-08-09"
          timezone="UTC"
          durationMinutes={30}
          attendees={[]}
          onSelectSlot={() => undefined}
        />,
      );
    });

    const lateSlot = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("8:00 PM"),
    );
    const grid = Array.from(document.querySelectorAll<HTMLElement>("div")).find(
      (node) => node.style.minHeight,
    );

    expect(lateSlot).toBeTruthy();
    expect(grid).toBeTruthy();
    expect(
      document.querySelector('[title="guest@example.com: Evening conflict"]'),
    ).toBeTruthy();
    expect(Number.parseFloat(lateSlot?.style.top ?? "0")).toBeLessThan(
      Number.parseFloat(grid?.style.minHeight ?? "0"),
    );
  });
});
