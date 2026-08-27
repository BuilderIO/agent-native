// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../../i18n";
import { TemplateShowcase } from "./template-showcase";

const EXPECTED_APP_HREFS = [
  "/apps/clips",
  "/apps/design",
  "/apps/slides",
  "/apps/analytics",
  "/apps/calendar",
  "/apps/mail",
  "/apps/assets",
  "/apps/content",
];

const REMOVED_APP_HREFS = [
  "/apps/chat",
  "/apps/dispatch",
  "/apps/forms",
  "/apps/plan",
];

afterEach(() => {
  cleanup();
});

function renderShowcase() {
  return render(
    <MemoryRouter>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <TemplateShowcase />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

function cardHrefs(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLAnchorElement>("a.app-carousel-card"),
  ).map((card) => card.getAttribute("href"));
}

describe("TemplateShowcase", () => {
  it("renders exactly the eight kept apps", () => {
    const { container } = renderShowcase();

    expect(cardHrefs(container)).toEqual(EXPECTED_APP_HREFS);
  });

  it("keeps the removed apps out of the carousel", () => {
    const { container } = renderShowcase();

    const hrefs = cardHrefs(container);
    for (const removed of REMOVED_APP_HREFS) {
      expect(hrefs).not.toContain(removed);
    }
  });

  it("ends the track with a bonus card that is not itself a link", () => {
    const { container } = renderShowcase();

    const bonus = container.querySelector<HTMLElement>(
      ".app-carousel-cta-card",
    );
    expect(bonus).not.toBeNull();
    expect(bonus?.closest("a")).toBeNull();
    expect(bonus?.tagName).not.toBe("A");

    const card = bonus as HTMLElement;
    expect(
      within(card).getByRole("heading", { name: "Build from scratch" }),
    ).toBeTruthy();
    // The two interactive children are the reason the card cannot be an anchor.
    expect(
      within(card).getByRole("button", { name: "Build online" }),
    ).toBeTruthy();
    expect(
      within(card).getByRole("link", { name: "Read the docs" }),
    ).toBeTruthy();

    const track = container.querySelector(".app-carousel-track");
    expect(track?.lastElementChild).toBe(card);
  });

  it("points the section CTA at the apps index", () => {
    renderShowcase();

    expect(
      screen.getByRole("link", { name: "Browse apps" }).getAttribute("href"),
    ).toBe("/apps");
  });
});
