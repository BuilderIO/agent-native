// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { docsI18nCatalog } from "../../i18n";
import { StartCtas } from "./start-ctas";

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("@agent-native/core/client/analytics", () => ({ trackEvent }));

afterEach(() => {
  cleanup();
  trackEvent.mockClear();
});

function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="pathname">{pathname}</span>;
}

function renderCtas() {
  return render(
    <MemoryRouter>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <StartCtas location="hero" />
        <LocationProbe />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

describe("StartCtas", () => {
  it("links Get started directly to the canonical docs index", () => {
    renderCtas();

    const link = screen.getByRole("link", { name: "Get started" });
    expect(link.getAttribute("href")).toBe("/docs");

    fireEvent.click(link);
    expect(screen.getByTestId("pathname").textContent).toBe("/docs");
    expect(trackEvent).toHaveBeenCalledWith("click get started", {
      location: "hero",
    });
  });

  it("links Try an app directly to the app catalog", () => {
    renderCtas();

    const link = screen.getByRole("link", { name: "Try an app" });
    expect(link.getAttribute("href")).toBe("/apps");

    fireEvent.click(link);
    expect(screen.getByTestId("pathname").textContent).toBe("/apps");
    expect(trackEvent).toHaveBeenCalledWith("choose get started path", {
      option: "browse_apps",
      location: "hero",
    });
  });
});
