// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { formsNavigateCommandPath } from "./use-navigation-state";

describe("formsNavigateCommandPath", () => {
  it("prefers a command URL path over semantic fallback fields", () => {
    expect(
      formsNavigateCommandPath({
        view: "home",
        path: "/forms/CSVP7Bz6dC?tab=edit",
      }),
    ).toBe("/forms/CSVP7Bz6dC?tab=edit");
  });

  it("accepts same-origin absolute URLs", () => {
    expect(
      formsNavigateCommandPath({
        view: "home",
        url: "http://localhost:3000/forms/CSVP7Bz6dC?tab=settings",
      }),
    ).toBe("/forms/CSVP7Bz6dC?tab=settings");
  });

  it("falls back to semantic navigation when the URL is not local", () => {
    expect(
      formsNavigateCommandPath({
        view: "form",
        formId: "CSVP7Bz6dC",
        tab: "responses",
        url: "https://example.com/forms/CSVP7Bz6dC",
      }),
    ).toBe("/forms/CSVP7Bz6dC?tab=responses");
  });
});
