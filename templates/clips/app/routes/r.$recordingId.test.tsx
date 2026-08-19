// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  BackToLibraryButton,
  mergeRecordingReactions,
  removePendingReaction,
} from "./r.$recordingId";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

function LocationProbe() {
  const location = useLocation();

  const navigate = useNavigate();

  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <button data-testid="history-back" onClick={() => navigate(-1)} />
    </>
  );
}

describe("BackToLibraryButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <MemoryRouter
          initialEntries={["/library", "/r/recording-1"]}
          initialIndex={1}
        >
          <TooltipProvider delayDuration={0}>
            <BackToLibraryButton />
            <LocationProbe />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders an icon-only control and replaces the recording history entry", () => {
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="recordingPage.backToLibrary"]',
    );
    const location = container.querySelector<HTMLDivElement>(
      '[data-testid="location"]',
    );

    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("");
    expect(location?.textContent).toBe("/r/recording-1");

    act(() => {
      button?.click();
    });

    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/library");

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="history-back"]')
        ?.click();
    });

    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("/library");
  });
});

describe("mergeRecordingReactions", () => {
  it("keeps optimistic reactions visible until the server copy arrives", () => {
    const merged = mergeRecordingReactions(
      [{ id: "reaction-1", emoji: "🔥", videoTimestampMs: 42_000 }],
      [
        {
          id: "pending-1",
          emoji: "🔥",
          videoTimestampMs: 42_000,
          recordingId: "recording-1",
        },
      ],
      "recording-1",
    );

    expect(merged).toEqual([
      { id: "reaction-1", emoji: "🔥", videoTimestampMs: 42_000 },
      {
        id: "pending-1",
        emoji: "🔥",
        videoTimestampMs: 42_000,
        recordingId: "recording-1",
      },
    ]);
  });

  it("does not show pending reactions from another recording", () => {
    expect(
      mergeRecordingReactions(
        [],
        [
          {
            id: "pending-a",
            emoji: "🔥",
            videoTimestampMs: 42_000,
            recordingId: "recording-a",
          },
          {
            id: "pending-b",
            emoji: "👏",
            videoTimestampMs: 5_000,
            recordingId: "recording-b",
          },
        ],
        "recording-b",
      ),
    ).toEqual([
      {
        id: "pending-b",
        emoji: "👏",
        videoTimestampMs: 5_000,
        recordingId: "recording-b",
      },
    ]);
  });
});

describe("removePendingReaction", () => {
  it("removes the client-only entry after the server refetch succeeds", () => {
    expect(
      removePendingReaction(
        [
          {
            id: "pending-1",
            emoji: "🔥",
            videoTimestampMs: 42_000,
            recordingId: "recording-1",
          },
          {
            id: "pending-2",
            emoji: "👏",
            videoTimestampMs: 42_000,
            recordingId: "recording-1",
          },
        ],
        "pending-1",
      ),
    ).toEqual([
      {
        id: "pending-2",
        emoji: "👏",
        videoTimestampMs: 42_000,
        recordingId: "recording-1",
      },
    ]);
  });
});
