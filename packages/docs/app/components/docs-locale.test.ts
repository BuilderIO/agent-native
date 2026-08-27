import { describe, expect, it } from "vitest";

import {
  comparableDocsPath,
  docsLocaleFromSegment,
  docsMarkdownPathForSlug,
  docsPathForSlug,
  docsSlugFromPathname,
  DOCS_LOCALES,
  localizeDocsHref,
  sitePathForLocale,
} from "./docs-locale";

describe("docsPathForSlug", () => {
  it("emits the canonical trailing-slash form for the default locale", () => {
    expect(docsPathForSlug("actions-overview")).toBe("/docs/actions-overview/");
  });

  it("emits the docs root for getting-started rather than a slug path", () => {
    expect(docsPathForSlug("getting-started")).toBe("/docs/");
  });

  it("lowercases the locale segment for a non-default locale", () => {
    expect(docsPathForSlug("actions-overview", "es-ES")).toBe(
      "/es-es/docs/actions-overview/",
    );
  });

  it("emits the localized docs root for getting-started", () => {
    expect(docsPathForSlug("getting-started", "es-ES")).toBe("/es-es/docs/");
  });

  it.each(DOCS_LOCALES)(
    "emits a lowercase segment matching the locale tag for %s",
    (locale) => {
      const path = docsPathForSlug("actions-overview", locale);
      expect(path).toBe(path.toLowerCase());
      expect(path.endsWith("/")).toBe(true);
      if (locale !== "en-US") {
        expect(path.startsWith(`/${locale.toLowerCase()}/docs/`)).toBe(true);
      }
    },
  );
});

describe("sitePathForLocale", () => {
  it("canonicalizes a non-docs path for the default locale", () => {
    expect(sitePathForLocale("/apps")).toBe("/apps/");
  });

  it("prefixes and lowercases a non-docs path for a non-default locale", () => {
    expect(sitePathForLocale("/apps", "es-ES")).toBe("/es-es/apps/");
  });

  it("keeps the site root as the bare root", () => {
    expect(sitePathForLocale("/")).toBe("/");
    expect(sitePathForLocale("/", "es-ES")).toBe("/es-es/");
  });

  it("strips an existing locale prefix when switching to the default locale", () => {
    expect(sitePathForLocale("/ar-SA/apps")).toBe("/apps/");
  });

  // A language picker feeds its own output back in when the visitor switches
  // twice; a non-idempotent builder silently doubles the slash or the prefix.
  it("is idempotent", () => {
    for (const locale of DOCS_LOCALES) {
      const once = sitePathForLocale("/apps", locale);
      expect(sitePathForLocale(once, locale)).toBe(once);
    }
  });

  it("leaves a file-like path unslashed", () => {
    expect(sitePathForLocale("/openapi.json")).toBe("/openapi.json");
  });
});

describe("localizeDocsHref", () => {
  it("keeps the fragment after the trailing slash", () => {
    expect(localizeDocsHref("/docs/client-data#usedbsync", "de-DE")).toBe(
      "/de-de/docs/client-data/#usedbsync",
    );
  });

  it("leaves an already-prefixed href untouched", () => {
    expect(localizeDocsHref("/de-DE/docs/client-data", "de-DE")).toBe(
      "/de-DE/docs/client-data",
    );
  });
});

describe("docsMarkdownPathForSlug", () => {
  it("appends .md without a trailing slash", () => {
    expect(docsMarkdownPathForSlug("actions-overview")).toBe(
      "/docs/actions-overview.md",
    );
  });

  // The route builder emits `/docs/`; appending onto it produced
  // `/docs//getting-started.md`, which 404s.
  it("does not double the slash for getting-started", () => {
    expect(docsMarkdownPathForSlug("getting-started")).toBe(
      "/docs/getting-started.md",
    );
  });

  it("lowercases the locale segment for a localized twin", () => {
    expect(docsMarkdownPathForSlug("actions-overview", "es-ES")).toBe(
      "/es-es/docs/actions-overview.md",
    );
  });

  it.each(DOCS_LOCALES)("never emits `/.md` for %s", (locale) => {
    for (const slug of ["getting-started", "actions-overview"]) {
      const path = docsMarkdownPathForSlug(slug, locale);
      expect(path).not.toContain("//");
      expect(path).not.toContain("/.md");
      expect(path.endsWith(".md")).toBe(true);
    }
  });
});

describe("comparableDocsPath", () => {
  // This is an equality key, not a URL — every inbound form of one doc must
  // collapse to the same token or every comparison against it silently fails.
  it("collapses every inbound form of one doc to a single key", () => {
    const forms = [
      "/docs/actions-overview",
      "/docs/actions-overview/",
      "/es-ES/docs/actions-overview",
      "/es-es/docs/actions-overview/",
    ];
    const keys = new Set(forms.map(comparableDocsPath));
    expect(keys).toEqual(new Set(["/docs/actions-overview"]));
  });

  it("collapses the docs index forms to the bare docs path", () => {
    for (const form of ["/docs", "/docs/", "/es-es/docs/", "/es-ES/docs"]) {
      expect(comparableDocsPath(form)).toBe("/docs");
    }
  });
});

describe("inbound path reading", () => {
  // The reader must keep accepting every form that resolves today: external
  // links point at the bare and mixed-case URLs.
  it.each([
    "/docs/actions-overview",
    "/docs/actions-overview/",
    "/es-ES/docs/actions-overview",
    "/es-es/docs/actions-overview/",
  ])("resolves %s to the same slug", (pathname) => {
    expect(docsSlugFromPathname(pathname)).toBe("actions-overview");
  });

  it.each(["/docs", "/docs/", "/es-es/docs/"])(
    "resolves %s to getting-started",
    (pathname) => {
      expect(docsSlugFromPathname(pathname)).toBe("getting-started");
    },
  );
});

describe("docsLocaleFromSegment", () => {
  // Emitted paths are lowercase, so route params arrive lowercase. Comparing
  // them against the BCP-47 tag made every localized SSR route 404 -- which
  // stayed invisible until prerendering started rendering those paths itself.
  it.each(DOCS_LOCALES)("resolves %s in either casing", (locale) => {
    expect(docsLocaleFromSegment(locale)).toBe(locale);
    expect(docsLocaleFromSegment(locale.toLowerCase())).toBe(locale);
  });

  // A doc slug must never read as a locale, or the docs route redirects
  // instead of rendering the page.
  it.each([
    "agent-surfaces",
    "actions-overview",
    "getting-started",
    "de",
    "",
    "not-a-locale",
  ])("does not resolve %s", (segment) => {
    expect(docsLocaleFromSegment(segment)).toBeUndefined();
  });

  it("ignores non-string values", () => {
    expect(docsLocaleFromSegment(undefined)).toBeUndefined();
    expect(docsLocaleFromSegment(null)).toBeUndefined();
  });
});
