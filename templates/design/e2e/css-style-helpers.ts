import type { Page } from "@playwright/test";

export async function normalizedStyle(page: Page, css: string | undefined) {
  return page.evaluate((text) => {
    const probe = document.createElement("div");
    probe.style.cssText = text;
    const declarations: [string, string, string][] = [];
    for (let index = 0; index < probe.style.length; index += 1) {
      const property = probe.style.item(index);
      declarations.push([
        property,
        probe.style.getPropertyValue(property),
        probe.style.getPropertyPriority(property),
      ]);
    }
    return declarations.sort(([left], [right]) => left.localeCompare(right));
  }, css ?? "");
}
