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
});
