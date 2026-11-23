import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { resolveRoutePage } from "./pages";
import { NOT_FOUND_COPY, SettingsRouteFallback } from "./SettingsRouteFallback";

/**
 * Row: an unknown `/settings/<slug>` URL must not render an empty main. The
 * settings shell renders a page only when the view resolves; when it does not,
 * the frame shows the app's own not-found copy with a way home.
 */
function render(view: string) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SettingsRouteFallback view={view} />
    </MemoryRouter>,
  );
}

const settingsPage = (view: string) =>
  resolveRoutePage({ id: "settings", view } as never);

describe("an unknown settings view", () => {
  it("resolves no page for a slug the app does not implement", () => {
    expect(settingsPage("environment")).toBeFalsy();
    expect(settingsPage("definitely-not-a-settings-page")).toBeFalsy();
  });

  it("still resolves the pages the rail advertises", () => {
    expect(settingsPage("profile")).toBeTruthy();
    expect(settingsPage("compute")).toBeTruthy();
  });

  it("renders the app's not-found copy instead of nothing", () => {
    const html = render("environment");
    // Compare the copy as text: the markup escapes the apostrophe.
    const text = html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
    expect(text).toContain(NOT_FOUND_COPY.title);
    expect(text).toContain(NOT_FOUND_COPY.details);
    expect(text).toContain(NOT_FOUND_COPY.goHome);
    expect(html).toContain('href="/home"');
    // The unknown slug is recorded on the node, so a check can prove the frame
    // answered for that view rather than for a resolved page.
    expect(html).toContain('data-settings-unknown-view="environment"');
  });

  it("keeps the app's own 404 wording (no invented copy)", () => {
    expect(NOT_FOUND_COPY).toEqual({
      title: "Page not found",
      details: "This page doesn't exist. It may have been moved or deleted.",
      goHome: "Go home",
    });
  });
});
