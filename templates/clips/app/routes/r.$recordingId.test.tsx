// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { BackToLibraryButton } from "./r.$recordingId";

vi.mock("@agent-native/core/client", () => ({
  useT: () => (key: string) => key,
}));

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location">{location.pathname}</div>;
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
        <MemoryRouter initialEntries={["/r/recording-1"]}>
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

  it("renders an icon-only control that navigates directly to /library", () => {
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
  });
});
