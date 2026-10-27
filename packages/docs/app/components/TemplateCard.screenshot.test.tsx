// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../i18n";
import { TEMPLATE_SCREENSHOTS } from "./template-screenshots";
import { templates, TemplateCard } from "./TemplateCard";

afterEach(() => {
  cleanup();
});

function renderCard(slug: string) {
  const template = templates.find((entry) => entry.slug === slug);
  if (!template) {
    throw new Error(`No template fixture for slug "${slug}"`);
  }

  return render(
    <MemoryRouter>
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <TemplateCard template={template} />
      </AgentNativeI18nProvider>
    </MemoryRouter>,
  );
}

describe("TemplateCard screenshots", () => {
  it("uses both catalog screenshot variants as the card images", () => {
    const template = templates.find((entry) => entry.slug === "clips");
    const { container } = renderCard("clips");
    const images = Array.from(container.querySelectorAll("img"));

    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute("src")).toBe(template!.screenshot.dark);
    expect(images[1]?.getAttribute("src")).toBe(template!.screenshot.light);
    expect(images[1]?.getAttribute("alt")).toBe("");
  });

  it("has dark and light screenshots for every app in the catalog", () => {
    for (const template of templates) {
      expect(template.screenshot.dark).toMatch(/^\/app-hero-screenshots\//);
      expect(template.screenshot.light).toMatch(/^\/app-hero-screenshots\//);
      expect(TEMPLATE_SCREENSHOTS[template.slug]).toEqual(template.screenshot);
    }
  });
});

describe("TemplateCard copy", () => {
  it("renders only the description, matching the homepage carousel card", () => {
    const { container } = renderCard("clips");

    const clipsCopy = docsI18nCatalog.messages.templateLanding.clips;

    const paragraphs = Array.from(container.querySelectorAll("article p"));
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toContain(clipsCopy.s008);
    expect(container.textContent).not.toContain(clipsCopy.s007Secondary);
  });
});
