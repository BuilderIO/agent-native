// @vitest-environment jsdom
import {
  AgentNativeI18nProvider,
  LOCALE_STORAGE_KEY,
  useLocale,
} from "@agent-native/core/client/i18n";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../../../i18n";
import { LanguagePicker } from "./language-picker";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function LocationProbe() {
  const location = useLocation();
  const { preference } = useLocale();
  return (
    <output data-testid="location" data-preference={preference}>
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}

function renderPicker(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <LanguagePicker />
        <LocationProbe />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

describe("website LanguagePicker campaign URLs", () => {
  it("keeps a localized alias navigation on the English canonical page and saves the locale preference", async () => {
    renderPicker("/fr-fr/articles/test-article/?utm_source=campaign#faq");
    fireEvent.click(screen.getByRole("button", { name: /^Language:/ }));

    const french = screen.getByRole("option", { name: /Français/ });
    expect(french.getAttribute("href")).toBe(
      "/articles/test-article/?utm_source=campaign#faq",
    );
    fireEvent.click(french);

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/articles/test-article/?utm_source=campaign#faq",
      );
      expect(
        screen.getByTestId("location").getAttribute("data-preference"),
      ).toBe("fr-FR");
    });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr-FR");
  });

  it("does not create a localized campaign URL when selecting a language", () => {
    renderPicker("/articles/test-article/");
    fireEvent.click(screen.getByRole("button", { name: /^Language:/ }));

    expect(
      screen.getByRole("option", { name: /Deutsch/ }).getAttribute("href"),
    ).toBe("/articles/test-article/");
  });
});
