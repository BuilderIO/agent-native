// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  trackOnboardingEvent: vi.fn(),
  start: vi.fn(),
  storage: undefined as unknown,
  builder: {} as Record<string, unknown>,
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: (...args: unknown[]) => mocks.trackEvent(...args),
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => path,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/onboarding/use-onboarding", () => ({
  createOnboardingCorrelationId: () => "view-1",
  trackOnboardingEvent: (...args: unknown[]) =>
    mocks.trackOnboardingEvent(...args),
}));
vi.mock("@agent-native/toolkit/app/settings", () => ({
  hasBuilderOAuthCredential: () => false,
  useBuilderConnectFlow: () => mocks.builder,
}));
vi.mock("@/hooks/use-video-storage-status", () => ({
  VIDEO_STORAGE_STATUS_KEY: ["clips", "video-storage-status"],
  fetchVideoStorageStatus: vi.fn(),
  useVideoStorageStatus: () => ({ data: mocks.storage }),
}));

import { FreeClipsLimitCard } from "@/components/recorder/free-clips-limit-card";

import { builderOfferMilestone, FreeClipsSidebar } from "./free-clips-sidebar";

function hosted(remaining: number, limit = 3) {
  return {
    configured: remaining > 0,
    mode: remaining > 0 ? "hosted" : "none",
    hostedRemaining: remaining,
    hostedLimit: limit,
    maxClipBytes: 1,
    maxClipDurationMs: 1,
    ...(remaining > 0 ? {} : { denyReason: "exhausted" }),
  };
}

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  const client = new QueryClient();
  act(() => {
    root.render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    );
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find(
    (b) =>
      b.textContent.trim() === label || b.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`No button ${label}`);
  return match;
}

function events(name: string) {
  return mocks.trackEvent.mock.calls.filter(([n]) => n === name);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  mocks.trackEvent.mockReset();
  mocks.trackOnboardingEvent.mockReset();
  mocks.start.mockReset();
  mocks.builder = {
    start: mocks.start,
    cancel: vi.fn(),
    connecting: false,
    error: null,
    accountExists: false,
    statusResolved: true,
    agentNativeProvisioningEnabled: true,
    effective: null,
    canConnect: { org: true, personal: false },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root.unmount());
  container.remove();
});

describe("builderOfferMilestone", () => {
  it("offers Builder.io only on the last free clip and once they are used up", () => {
    expect(builderOfferMilestone(0, 3)).toBeNull();
    expect(builderOfferMilestone(1, 3)).toBeNull();
    expect(builderOfferMilestone(2, 3)).toBe("last_clip");
    expect(builderOfferMilestone(3, 3)).toBe("used_up");
    expect(builderOfferMilestone(0, 0)).toBeNull();
  });
});

describe("FreeClipsSidebar", () => {
  it("shows only the count while two or more free clips are left", () => {
    mocks.storage = hosted(2);
    render(<FreeClipsSidebar />);
    expect(container.textContent).toContain("freeClips.badgeTitle");
    expect(container.textContent).not.toContain("freeClips.offerTitleLastClip");
    expect(events("clips_free_clips_offer_viewed")).toHaveLength(0);
  });

  it("swaps the count for the offer on the last clip and records the view and dismissal", () => {
    mocks.storage = hosted(1);
    render(<FreeClipsSidebar />);
    expect(container.textContent).toContain("freeClips.offerTitleLastClip");
    expect(container.textContent).not.toContain("freeClips.badgeTitle");
    expect(events("clips_free_clips_offer_viewed")).toEqual([
      [
        "clips_free_clips_offer_viewed",
        {
          surface: "sidebar_card",
          milestone: "last_clip",
          remaining: 1,
          limit: 3,
        },
      ],
    ]);

    act(() => button("freeClips.offerDismiss").click());
    expect(events("clips_free_clips_offer_dismissed")).toEqual([
      [
        "clips_free_clips_offer_dismissed",
        {
          surface: "sidebar_card",
          milestone: "last_clip",
          remaining: 1,
          limit: 3,
        },
      ],
    ]);
    expect(container.textContent).toContain("freeClips.badgeTitle");
  });

  it("brings the offer back once the clips are used up, after a dismissal", () => {
    window.localStorage.setItem("clips:builder-offer-minimized", "last_clip");
    mocks.storage = hosted(0);
    render(<FreeClipsSidebar />);
    expect(container.textContent).toContain("freeClips.offerDescriptionUsedUp");
  });
});

describe("FreeClipsLimitCard", () => {
  it("creates the Builder.io account in one click and tags the funnel", () => {
    render(<FreeClipsLimitCard limit={3} onDismiss={() => {}} />);
    expect(events("clips_free_clips_offer_viewed")).toEqual([
      [
        "clips_free_clips_offer_viewed",
        {
          surface: "record_limit_card",
          milestone: "used_up",
          remaining: 0,
          limit: 3,
          action: "record",
        },
      ],
    ]);
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_step_viewed",
      expect.objectContaining({
        step_id: "file-storage",
        flow: "clips_record_free_clips_limit",
        setup_reason: "free_clips_used_up",
      }),
    );

    act(() => button("freeClips.offerDialogAction").click());
    expect(mocks.start).toHaveBeenCalledWith({
      provisionAccount: true,
      scope: "org",
    });
    expect(mocks.trackOnboardingEvent).toHaveBeenCalledWith(
      "onboarding_method_clicked",
      expect.objectContaining({ method_id: "builder" }),
    );
  });

  it("records Maybe later as a dismissal", () => {
    const onDismiss = vi.fn();
    render(<FreeClipsLimitCard limit={3} onDismiss={onDismiss} />);
    act(() => button("freeClips.limitDismiss").click());
    expect(onDismiss).toHaveBeenCalled();
    expect(events("clips_free_clips_offer_dismissed")).toHaveLength(1);
  });

  it("records using the last clip as going ahead, not a dismissal", () => {
    const onProceed = vi.fn();
    render(
      <FreeClipsLimitCard
        variant="popover"
        kind="last_clip"
        action="upload"
        limit={3}
        onDismiss={() => {}}
        onProceed={onProceed}
      />,
    );
    act(() => button("freeClips.lastClipUpload").click());
    expect(onProceed).toHaveBeenCalled();
    expect(events("clips_free_clips_offer_dismissed")).toHaveLength(0);
    expect(events("clips_free_clips_offer_proceeded")).toEqual([
      [
        "clips_free_clips_offer_proceeded",
        {
          surface: "library_limit_popover",
          milestone: "last_clip_intent",
          remaining: 1,
          limit: 3,
          action: "upload",
        },
      ],
    ]);
  });
});
