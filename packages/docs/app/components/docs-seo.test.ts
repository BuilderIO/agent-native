import { describe, expect, it } from "vitest";

import { hasAvailableDoc } from "./docs-availability";
import { docsAlternateLinksForPath } from "./docs-seo";

describe("docsAlternateLinksForPath", () => {
  it("self-references every locale, including ones with no translated doc", () => {
    // "environment-variables" has no fr-FR translation — the route still
    // resolves by falling back to the English doc (see
    // docs-localization.test.ts), so it's a real, indexable page that needs
    // its own self-referencing hreflang entry.
    expect(hasAvailableDoc("fr-FR", "environment-variables")).toBe(false);

    const links = docsAlternateLinksForPath("/docs/environment-variables/");
    const frLink = links.find((link) => link.hrefLang === "fr-FR");

    expect(frLink?.path).toBe("/fr-fr/docs/environment-variables/");
  });

  it("still lists the default locale and x-default for a fully translated doc", () => {
    expect(hasAvailableDoc("fr-FR", "internationalization")).toBe(true);

    const links = docsAlternateLinksForPath("/docs/internationalization/");
    const hrefLangs = links.map((link) => link.hrefLang);

    expect(hrefLangs).toContain("en-US");
    expect(hrefLangs).toContain("fr-FR");
    expect(hrefLangs).toContain("x-default");
  });

  it("returns no alternates for a path with no doc at all", () => {
    expect(docsAlternateLinksForPath("/docs/not-a-real-slug/")).toEqual([]);
  });
});
