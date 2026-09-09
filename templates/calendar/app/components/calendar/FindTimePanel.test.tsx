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

/** Suggested-time chips reported as floating below the grid after 7 PM. */
const LATE_NIGHT_LABELS = ["10:30 PM", "10:45 PM", "11:00 PM", "11:30 PM"];

/** Intl separates the day period with a narrow no-break space in newer ICU. */
function normalizeTime(value: string | null) {
  return (value ?? "").split(/\s+/).join(" ");
}

function findGrid() {
  return Array.from(document.querySelectorAll<HTMLElement>("div")).find(
    (node) => node.style.minHeight,
  );
}

function lateNightSlot(start: string, end: string) {
  return {
    start,
    end,
    date: start.slice(0, 10),
    durationMinutes: 30,
    availableParticipantEmails: [],
    unavailableParticipantEmails: [],
  };
}

function renderLateNightWeek(root: Root) {
  useActionQuery.mockReturnValue({
    data: {
      range: {
        from: "2026-08-09T00:00:00.000Z",
        to: "2026-08-16T00:00:00.000Z",
        timezone: "UTC",
        durationMinutes: 30,
        slotStepMinutes: 15,
      },
      googleConnected: true,
      participants: [],
      busy: [
        {
          participantEmail: "guest@example.com",
          start: "2026-08-09T21:00:00.000Z",
          end: "2026-08-09T22:00:00.000Z",
          title: "Late conflict",
        },
      ],
      slots: [
        lateNightSlot("2026-08-09T22:30:00.000Z", "2026-08-09T23:00:00.000Z"),
        lateNightSlot("2026-08-09T22:45:00.000Z", "2026-08-09T23:15:00.000Z"),
        lateNightSlot("2026-08-09T23:00:00.000Z", "2026-08-09T23:30:00.000Z"),
        lateNightSlot("2026-08-09T23:30:00.000Z", "2026-08-10T00:00:00.000Z"),
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
}

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

  it("keeps late-night suggestions and busy blocks inside the time grid", () => {
    renderLateNightWeek(root);

    const grid = findGrid();
    const gridHeight = Number.parseFloat(grid?.style.minHeight ?? "0");
    expect(gridHeight).toBeGreaterThan(0);

    // The reported symptom: chips for slots past 7 PM were positioned below the
    // rendered hour rows, so they floated in unstyled space under the grid.
    for (const label of LATE_NIGHT_LABELS) {
      const chip = Array.from(
        document.querySelectorAll<HTMLElement>("button"),
      ).find((button) => normalizeTime(button.textContent).includes(label));
      expect(chip, `no suggestion chip rendered for ${label}`).toBeTruthy();

      const top = Number.parseFloat(chip?.style.top ?? "-1");
      const height = Number.parseFloat(chip?.style.height ?? "0");
      expect(top, `${label} chip starts above the grid`).toBeGreaterThanOrEqual(
        0,
      );
      expect(
        top + height,
        `${label} chip overflows the bottom of the grid`,
      ).toBeLessThanOrEqual(gridHeight);
    }

    const busyBlock = document.querySelector<HTMLElement>(
      '[title="guest@example.com: Late conflict"]',
    );
    expect(busyBlock).toBeTruthy();
    expect(
      Number.parseFloat(busyBlock?.style.top ?? "-1") +
        Number.parseFloat(busyBlock?.style.height ?? "0"),
    ).toBeLessThanOrEqual(gridHeight);
  });

  it("rules hour lines and labels through midnight", () => {
    renderLateNightWeek(root);

    const grid = findGrid();
    const gridHeight = Number.parseFloat(grid?.style.minHeight ?? "0");
    const dayColumns = Array.from(
      document.querySelectorAll<HTMLElement>("div"),
    ).filter((node) => node.style.height === `${gridHeight}px`);
    expect(dayColumns).toHaveLength(7);

    // Hour lines must tile the full column, or later rows read as empty and
    // unstyled even though the column reserves space for them.
    for (const column of dayColumns) {
      const ruled = Array.from(column.children)
        .filter(
          (child): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.tagName === "DIV" &&
            child.className.includes("border-b"),
        )
        .reduce((total, row) => total + Number.parseFloat(row.style.height), 0);
      expect(ruled).toBe(gridHeight);
    }

    const gutterLabels = Array.from(document.querySelectorAll("span")).map(
      (node) => node.textContent,
    );
    expect(gutterLabels).toContain("11pm");
  });
});
