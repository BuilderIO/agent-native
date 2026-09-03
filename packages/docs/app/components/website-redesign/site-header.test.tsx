// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real modal pulls the docs search index; the header only owns the open
// state, so the lazy chunk is stubbed with a probe.
vi.mock("../SearchModal", () => ({
  SearchModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="search-modal" /> : null,
}));

import { docsI18nCatalog } from "../../i18n";
import { SiteHeader } from "./site-header";

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderHeader() {
  return render(
    <MemoryRouter>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <SiteHeader starCount={1234} />
        <LocationProbe />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

describe("SiteHeader search", () => {
  it("does not mount the search modal until it is asked for", () => {
    renderHeader();

    expect(screen.queryByTestId("search-modal")).toBeNull();
  });

  it("opens the modal from the search trigger", async () => {
    renderHeader();

    fireEvent.click(screen.getAllByRole("button", { name: "Search docs" })[0]);

    expect(await screen.findByTestId("search-modal")).toBeTruthy();
  });

  it.each([
    ["cmd", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
  ])("opens the modal on %s+k", async (_name, init) => {
    renderHeader();

    fireEvent.keyDown(document, { key: "k", ...init });

    expect(await screen.findByTestId("search-modal")).toBeTruthy();
  });

  it("closes the mobile menu after choosing a navigation link", () => {
    renderHeader();

    const toggle = screen.getByRole("button", {
      name: "Toggle navigation menu",
    });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const docsLinks = screen.getAllByRole("link", { name: "Docs" });
    fireEvent.click(docsLinks[docsLinks.length - 1]);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("location").textContent).toBe("/docs/");
  });
});
