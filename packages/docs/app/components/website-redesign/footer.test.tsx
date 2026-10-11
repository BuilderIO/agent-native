// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { docsI18nCatalog } from "../../i18n";
import { templates } from "../TemplateCard";
import { FOOTER_APPS, Footer } from "./footer";

vi.mock("@agent-native/toolkit/app/feedback", () => ({
  FeedbackButton: () => null,
}));

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
});

function renderFooter(locale: "en-US" | "es-ES") {
  return render(
    <MemoryRouter>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale={locale}
        initialPreference={locale}
        persistPreference={false}
      >
        <Footer />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

function hrefOf(name: string): string | null {
  return screen.getByRole("link", { name }).getAttribute("href");
}

describe("Footer", () => {
  it("lists the same apps as the app catalog", () => {
    expect(FOOTER_APPS).toEqual(
      templates.map(({ slug, name }) => ({ slug, name })),
    );
  });

  it("links every app page, About, and the key docs", () => {
    renderFooter("en-US");

    for (const app of FOOTER_APPS) {
      expect(hrefOf(app.name)).toBe(`/apps/${app.slug}/`);
    }
    expect(hrefOf("About Agent-Native")).toBe("/about/");
    expect(hrefOf("What is Agent-Native?")).toBe("/docs/what-is-agent-native/");
    expect(hrefOf("Key Concepts")).toBe("/docs/key-concepts/");
  });

  it("keeps the new links in the reader's locale", () => {
    const { container } = renderFooter("es-ES");

    const hrefs = Array.from(
      container.querySelectorAll<HTMLAnchorElement>("footer a[href^='/']"),
    ).map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/es-es/apps/chat/",
        "/es-es/about/",
        "/es-es/docs/key-concepts/",
      ]),
    );
  });
});
