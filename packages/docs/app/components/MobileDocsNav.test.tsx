// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { docsI18nCatalog } from "../i18n";
import { getDocsNavSections } from "./docsNavItems";
import MobileDocsNav from "./MobileDocsNav";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

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
  it("keeps the active parent indicators after opening another group", () => {
    const deployment = getDocsNavSections("en-US").find(
      (section) => section.id === "deployment",
    );
    const hosting = deployment?.items.find(
      (item) => item.id === "deployment-providers",
    );
    const databases = deployment?.items.find(
      (item) => item.id === "database-providers",
    );
    if (!deployment || !hosting || !databases) {
      throw new Error("Expected deployment navigation groups");
    }

    renderMobileNav("/docs/docker/");
    openNav();
    const sectionButton = screen.getByRole("button", {
      name: deployment.title,
    });
    const hostingButton = screen.getByRole("button", { name: hosting.label });
    const otherButton = screen.getByRole("button", { name: databases.label });

    expect(sectionButton.getAttribute("data-active-descendant")).toBe("true");
    expect(hostingButton.getAttribute("data-active-descendant")).toBe("true");
    expect(otherButton.hasAttribute("data-active-descendant")).toBe(false);

    fireEvent.click(otherButton);
    expect(hostingButton.getAttribute("aria-expanded")).toBe("false");
    expect(hostingButton.getAttribute("data-active-descendant")).toBe("true");
    fireEvent.click(sectionButton);
    expect(sectionButton.getAttribute("aria-expanded")).toBe("false");
    expect(sectionButton.getAttribute("data-active-descendant")).toBe("true");
  });

  it("marks both sections for a page listed twice", () => {
    const sections = getDocsNavSections("en-US");
    const integrations = sections.find(
      (section) => section.id === "integrations",
    );
    const toolkit = sections.find((section) => section.id === "toolkits");
    const toolkitGroup = toolkit?.items.find((item) =>
      item.children?.some((child) => child.to === "/docs/notifications/"),
    );
    if (!integrations || !toolkit || !toolkitGroup) {
      throw new Error("Expected two navigation placements for Notifications");
    }

    renderMobileNav("/docs/notifications/");
    openNav();
    expect(
      screen
        .getByRole("button", { name: integrations.title })
        .getAttribute("data-active-descendant"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: toolkit.title })
        .getAttribute("data-active-descendant"),
    ).toBe("true");
    const toolkitButton = screen.getByRole("button", {
      name: toolkit.title,
    });
    if (toolkitButton.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(toolkitButton);
    }
    expect(
      screen
        .getByRole("button", { name: toolkitGroup.label })
        .getAttribute("data-active-descendant"),
    ).toBe("true");
  });

  it("closes the docs dropdown when the viewport switches to desktop", () => {
    let handleChange: ((event: MediaQueryListEvent) => void) | undefined;
    const query = {
      matches: false,
      addEventListener: (_type: string, listener: EventListener) => {
        handleChange = listener as (event: MediaQueryListEvent) => void;
      },
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => query),
    );

    renderMobileNav("/docs/");
    openNav();

    const trigger = screen.getByRole("button", { name: "Navigate docs" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      handleChange?.({ matches: true } as MediaQueryListEvent);
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
