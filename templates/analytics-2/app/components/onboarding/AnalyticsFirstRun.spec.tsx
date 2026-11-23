// @vitest-environment jsdom

import { listFirstRunOnboardingExtensions } from "@agent-native/core/client/onboarding";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsFirstRun } from "./AnalyticsFirstRun";

vi.mock("@agent-native/core/client/i18n", async () => {
  const { i18nMock } = await import("../../skins/reference/testing/i18n");
  return i18nMock;
});

/**
 * Row 145: a new workspace had no setup screen at all, because nothing in this
 * app registered a first-run extension. This pins the registration and the three
 * things the tester names: the title, sample datasets and a way to bring a file,
 * plus Skip.
 */
describe("analytics first-run setup", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("registers a first-run extension for this app", () => {
    const ids = listFirstRunOnboardingExtensions().map((entry) => entry.id);
    expect(ids).toContain("analytics-first-run");
  });

  it("renders the setup screen with sample datasets and Skip", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <AnalyticsFirstRun onComplete={() => true} onSkip={() => undefined} />
        </MemoryRouter>,
      );
    });

    const text = host.textContent ?? "";
    expect(text).toContain("Start your first analysis");
    expect(text).toContain("Sample datasets");
    expect(text).toContain("orders");
    expect(text).toContain("Skip");
    expect(text).toContain("Upload a file");
    expect(
      host.querySelector('input[type="file"]')?.getAttribute("accept"),
    ).toBe(".csv,text/csv");
  });

  it("completes and skips when Skip is used", async () => {
    const onComplete = vi.fn(() => true);
    const onSkip = vi.fn();
    act(() => {
      root.render(
        <MemoryRouter>
          <AnalyticsFirstRun onComplete={onComplete} onSkip={onSkip} />
        </MemoryRouter>,
      );
    });
    const skip = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Skip",
    );
    await act(async () => {
      skip?.click();
      await Promise.resolve();
    });
    expect(onComplete).toHaveBeenCalled();
    expect(onSkip).toHaveBeenCalled();
  });
});
