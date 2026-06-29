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
import DocsLanguageSuggestion, {
  DOCS_LANGUAGE_SUGGESTION_DISMISSED_KEY,
  shouldSuggestDocsLocale,
} from "./DocsLanguageSuggestion";

const ORIGINAL_NAVIGATOR_LANGUAGES = navigator.languages;
const ORIGINAL_NAVIGATOR_LANGUAGE = navigator.language;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setBrowserLanguages(
    ORIGINAL_NAVIGATOR_LANGUAGES,
    ORIGINAL_NAVIGATOR_LANGUAGE,
  );
});

function setBrowserLanguages(
  languages: readonly string[],
  language = languages[0] ?? "en-US",
) {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    value: languages,
  });
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: language,
  });
}

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

function renderSuggestion(
  path = "/docs/internationalization?tab=api#overview",
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <DocsLanguageSuggestion />
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

  it("renders locale options in product order", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: /^Language:/ }));

    const optionLabels = screen
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());

    expect(optionLabels).toEqual([
      "System",
      "English (en-US)",
      "Español (es-ES)",
      "Français (fr-FR)",
      "Deutsch (de-DE)",
      "Português (Brasil) (pt-BR)",
      "简体中文 (zh-CN)",
      "繁體中文 (zh-TW)",
      "日本語 (ja-JP)",
      "한국어 (ko-KR)",
      "हिन्दी (hi-IN)",
      "العربية (ar-SA)",
    ]);
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

describe("DocsLanguageSuggestion", () => {
  it("renders a proactive switch link for supported browser locales", async () => {
    setBrowserLanguages(["fr-FR", "en-US"]);
    renderSuggestion();

    expect(await screen.findByText("Read this page in Français?")).toBeTruthy();
    expect(
      screen.getByText("Your browser language is Français (fr-FR)."),
    ).toBeTruthy();

    const switchLink = screen.getByRole("link", {
      name: "Switch to Français",
    });
    expect(switchLink.getAttribute("href")).toBe(
      "/fr-FR/docs/internationalization?tab=api#overview",
    );
  });

  it("stores the accepted locale while routing to the localized page", async () => {
    setBrowserLanguages(["fr-FR", "en-US"]);
    renderSuggestion();

    fireEvent.click(
      await screen.findByRole("link", { name: "Switch to Français" }),
    );

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr-FR");
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/fr-FR/docs/internationalization?tab=api#overview",
      );
    });
  });

  it("dismisses without changing the language preference or route", async () => {
    setBrowserLanguages(["fr-FR", "en-US"]);
    renderSuggestion();

    fireEvent.click(
      await screen.findByRole("button", { name: "Keep English" }),
    );

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(
      window.localStorage.getItem(DOCS_LANGUAGE_SUGGESTION_DISMISSED_KEY),
    ).toBe("fr-FR");
    expect(screen.getByTestId("location").textContent).toBe(
      "/docs/internationalization?tab=api#overview",
    );
    await waitFor(() => {
      expect(screen.queryByText("Read this page in Français?")).toBeNull();
    });
  });

  it("keeps localized routes and explicit preferences quiet", () => {
    expect(
      shouldSuggestDocsLocale({
        routeLocale: "fr-FR",
        browserLocale: "fr-FR",
        storedPreference: null,
        dismissedTarget: null,
      }),
    ).toBe(false);

    expect(
      shouldSuggestDocsLocale({
        routeLocale: "en-US",
        browserLocale: "fr-FR",
        storedPreference: "en-US",
        dismissedTarget: null,
      }),
    ).toBe(false);

    expect(
      shouldSuggestDocsLocale({
        routeLocale: "en-US",
        browserLocale: "fr-FR",
        storedPreference: null,
        dismissedTarget: "fr-FR",
      }),
    ).toBe(false);
  });
});
