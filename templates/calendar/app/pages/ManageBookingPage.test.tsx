// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  booking: {
    eventTitle: "Project review",
    name: "Alex Example",
    start: "2026-09-26T16:00:00.000Z",
    end: "2026-09-26T16:30:00.000Z",
    slug: "project-review",
    meetingLinkPending: true,
    status: "confirmed",
  },
  mutate: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.booking, isLoading: false, error: null }),
  useMutation: () => ({ mutate: mocks.mutate, isPending: false }),
}));

vi.mock("react-router", () => ({
  Link: ({
    to,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useParams: () => ({ token: "cancel-token" }),
}));

import { ManageBookingPage } from "./ManageBookingPage";

describe("ManageBookingPage", () => {
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

  it("keeps pending meeting details visible after reopening a booking", async () => {
    await act(async () => {
      root.render(<ManageBookingPage />);
    });

    expect(container.textContent).toContain(
      "bookingLinks.meetingDetailsPending",
    );
  });
});
