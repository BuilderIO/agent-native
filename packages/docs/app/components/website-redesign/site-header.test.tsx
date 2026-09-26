// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../SearchModal", () => ({
  SearchModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="search-modal" /> : null,
}));
import { docsI18nCatalog } from "../../i18n";
import { SnackbarProvider } from "./ds/snackbar";
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

function renderHeader(starCount: number | null = 1234) {
  return render(
    <MemoryRouter>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <SnackbarProvider>
          <SiteHeader starCount={starCount} />
        </SnackbarProvider>
        <LocationProbe />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

describe("SiteHeader search", () => {
  it("renders the server-provided GitHub star count", () => {
    renderHeader(4647);
    expect(
      screen.getAllByRole("link", { name: "GitHub — 4.6k stars" }),
    ).toHaveLength(1);
  });

  it("reserves the GitHub button width without a server count", () => {
    renderHeader(null);
    expect(screen.getByRole("link", { name: "GitHub" }).className).toContain(
      "min-w-[96px]",
    );
  });

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
