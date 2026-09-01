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
  it("shows the wireframe by default and reveals the screenshot on hover", () => {
    const { container } = renderCard("clips");

    const classes = imageClasses(container);
    expect(classes).toHaveLength(3);
    expect(classes[0]).toContain("theme-img-dark");
    expect(classes[1]).toContain("theme-img-light");

    // The screenshot sits on top at zero opacity until the card is hovered,
    // which is the whole effect: no hover, no screenshot.
    expect(classes[2]).toContain("opacity-0");
    expect(classes[2]).toContain("group-hover:opacity-100");
    expect(container.querySelector("article")?.className).toContain("group");
  });

  it("leaves apps without wireframe art on their plain screenshot", () => {
    expect(APP_ART.forms).toBeUndefined();

    const { container } = renderCard("forms");

    const classes = imageClasses(container);
    expect(classes).toHaveLength(1);
    expect(classes[0]).not.toContain("group-hover:opacity-100");
  });
});
