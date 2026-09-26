// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bookings: [] as Array<Record<string, unknown>>,
  cancelBooking: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "bookingLinks.zoomNeedsReview"
      ? "Check Zoom before retrying"
      : key === "bookingLinks.cancelBooking"
        ? "Cancel booking"
        : key,
}));

vi.mock("@/hooks/use-booking-links", () => ({
  useBookingLinks: () => ({ data: [] }),
}));

vi.mock("@/hooks/use-bookings", () => ({
  useBookings: () => ({ data: mocks.bookings }),
  useDeleteBooking: () => ({
    isPending: false,
    mutate: mocks.cancelBooking,
  }),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Dialog: Part,
    DialogContent: Part,
    DialogHeader: Part,
    DialogTitle: Part,
    DialogTrigger: Part,
  };
});

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => (
    <table>{children}</table>
  ),
  TableBody: ({ children }: { children: React.ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  TableCell: ({ children }: { children: React.ReactNode }) => (
    <td>{children}</td>
  ),
  TableHead: ({ children }: { children: React.ReactNode }) => (
    <th>{children}</th>
  ),
  TableHeader: ({ children }: { children: React.ReactNode }) => (
    <thead>{children}</thead>
  ),
  TableRow: ({ children }: { children: React.ReactNode }) => (
    <tr>{children}</tr>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@tabler/icons-react", () => ({
  IconCircleX: () => <svg />,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import BookingsList from "./BookingsList";

describe("BookingsList Zoom review state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.bookings = [
      {
        id: "booking-1",
        name: "Java Yang",
        email: "java@example.com",
        eventTitle: "Jyang + Java",
        start: "2026-09-25T23:30:00.000Z",
        end: "2026-09-26T00:00:00.000Z",
        slug: "jason-yang/30-mins",
        status: "confirmed",
        zoomNeedsReview: true,
      },
    ];
    mocks.cancelBooking.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows the Zoom review status and keeps the existing cancellation action", async () => {
    await act(async () => root.render(<BookingsList />));

    expect(container.textContent).toContain("Check Zoom before retrying");
    const cancelButton = container.querySelector(
      'button[aria-label="Cancel booking"]',
    );
    expect(cancelButton).not.toBeNull();

    await act(async () =>
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(mocks.cancelBooking).toHaveBeenCalledWith(
      "booking-1",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
