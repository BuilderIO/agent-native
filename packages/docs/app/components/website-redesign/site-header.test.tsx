// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real modal pulls the docs search index; the header only owns the open
// state, so the lazy chunk is stubbed with a probe.
vi.mock("../SearchModal", () => ({
  SearchModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="search-modal" /> : null,
}));

import { docsI18nCatalog } from "../../i18n";
import { SiteHeader } from "./site-header";

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
});
