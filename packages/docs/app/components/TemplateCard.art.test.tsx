// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../i18n";
import { templates, TemplateCard } from "./TemplateCard";
import { APP_ART } from "./website-redesign/app-art";

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

function imageClasses(container: HTMLElement) {
  return Array.from(container.querySelectorAll("img")).map(
    (image) => image.className,
  );
}

describe("TemplateCard artwork", () => {
  it("shows only the wireframe, with no image swap on hover", () => {
    const { container } = renderCard("clips");

    const classes = imageClasses(container);
    expect(classes).toHaveLength(2);
    expect(classes[0]).toContain("theme-img-dark");
    expect(classes[1]).toContain("theme-img-light");
    expect(classes.join(" ")).not.toContain("group-hover:opacity-100");
  });

  it("has art for every app in the catalog", () => {
    for (const template of templates) {
      expect(APP_ART[template.slug]).toBeDefined();
    }

    const { container } = renderCard("forms");
    expect(imageClasses(container)).toHaveLength(2);
  });
});

describe("TemplateCard copy", () => {
  it("renders only the description, matching the homepage carousel card", () => {
    const { container } = renderCard("clips");

    const paragraphs = Array.from(container.querySelectorAll("article p"));
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toContain("Record your screen.");
    expect(container.textContent).not.toContain(
      "Screen recordings your AI can actually watch",
    );
  });
});
