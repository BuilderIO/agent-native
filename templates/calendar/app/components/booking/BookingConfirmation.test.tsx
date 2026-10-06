// @vitest-environment happy-dom

import type { Booking } from "@shared/api";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { meetingDetailsPendingText } = vi.hoisted(() => ({
  meetingDetailsPendingText:
    "Your time is reserved. The host will follow up with meeting details.",
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "bookingLinks.meetingDetailsPending"
      ? meetingDetailsPendingText
      : key,
}));

import { BookingConfirmation } from "./BookingConfirmation";

describe("BookingConfirmation", () => {
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

  it("explains that meeting details will follow when the link is pending", async () => {
    await act(async () => {
      root.render(
        <BookingConfirmation
          booking={
            {
              eventTitle: "Project review",
              start: "2026-09-26T16:00:00.000Z",
              end: "2026-09-26T16:30:00.000Z",
              name: "Alex Example",
              meetingLinkPending: true,
            } as Booking
          }
          onReset={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain(meetingDetailsPendingText);
  });
});
