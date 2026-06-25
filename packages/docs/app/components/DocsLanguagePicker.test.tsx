// @vitest-environment jsdom

import {
  AgentNativeI18nProvider,
  LOCALE_STORAGE_KEY,
} from "@agent-native/core/client";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../i18n";
import DocsLanguagePicker from "./DocsLanguagePicker";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderPicker(path = "/docs/internationalization?tab=api#overview") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <DocsLanguagePicker />
        <LocationProbe />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}

describe("DocsLanguagePicker", () => {
  it("renders locale options as real localized links", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: /^Language:/ }));

    const zhLink = screen.getByRole("link", { name: /简体中文/ });
    expect(zhLink.getAttribute("href")).toBe(
      "/zh-CN/docs/internationalization?tab=api#overview",
    );
    expect(zhLink.getAttribute("data-an-prefetch")).toBe("render");
  });

  it("stores the selected preference while routing client-side", async () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: /^Language:/ }));
    const frLink = screen.getByRole("link", { name: /Français/ });
    fireEvent.click(frLink);

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr-FR");
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/fr-FR/docs/internationalization?tab=api#overview",
      );
    });
  });
});
