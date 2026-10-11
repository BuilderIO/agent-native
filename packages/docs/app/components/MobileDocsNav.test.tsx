// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../i18n";
import { getDocsNavSections } from "./docsNavItems";
import MobileDocsNav from "./MobileDocsNav";

afterEach(() => cleanup());

function renderMobileNav(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <MobileDocsNav />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

function openNav() {
  fireEvent.click(screen.getByRole("button", { name: "Navigate docs" }));
}

describe("MobileDocsNav", () => {
  it("keeps sections and nested groups collapsed until opened", () => {
    const sections = getDocsNavSections("en-US");
    const section = sections.find(
      (candidate, index) =>
        index > 0 &&
        candidate.items.some((item) => !item.to && item.children?.length),
    );
    const group = section?.items.find(
      (item) => !item.to && item.children?.length,
    );

    if (!section || !group) {
      throw new Error("Expected a collapsible section and group in docs nav");
    }

    renderMobileNav("/docs/");
    openNav();

    const sectionTrigger = screen.getByRole("button", {
      name: section.title,
    });
    expect(sectionTrigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(sectionTrigger);
    expect(sectionTrigger.getAttribute("aria-expanded")).toBe("true");

    const groupTrigger = screen.getByRole("button", { name: group.label });
    expect(groupTrigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(groupTrigger);
    expect(groupTrigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens the active section and group for the current doc", () => {
    const sections = getDocsNavSections("en-US");
    const section = sections.find(
      (candidate, index) =>
        index > 0 &&
        candidate.items.some((item) =>
          item.children?.some((child) => child.to),
        ),
    );
    const group = section?.items.find(
      (item) => !item.to && item.children?.some((child) => child.to),
    );
    const child = group?.children?.find((item) => item.to);

    if (!section || !group || !child?.to) {
      throw new Error("Expected an active child route in a collapsible group");
    }

    renderMobileNav(child.to);
    openNav();

    expect(
      screen
        .getByRole("button", { name: section.title })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: group.label })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
