import { describe, expect, it } from "vitest";

import {
  comparableDocsPath,
  docsLocaleFromSegment,
  docsMarkdownPathForSlug,
  docsPathForSlug,
  docsSlugFromPathname,
  DOCS_LOCALES,
  localizeDocsHref,
  localizeDocsMarkdownLinks,
  localizeSiteHref,
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

  // Rendered doc bodies are where most internal links on the site come from.
  // Passing the default locale through untouched left every one of them
  // pointing at the redirecting form.
  it("canonicalizes a default-locale href", () => {
    expect(localizeDocsHref("/docs/client-data", "en-US")).toBe(
      "/docs/client-data/",
    );
  });

  it("canonicalizes an already-prefixed href instead of passing it through", () => {
    expect(localizeDocsHref("/de-DE/docs/client-data", "de-DE")).toBe(
      "/de-de/docs/client-data/",
    );
  });

  it("keeps an href's own locale rather than the page's", () => {
    expect(localizeDocsHref("/fr-FR/docs/client-data", "de-DE")).toBe(
      "/fr-fr/docs/client-data/",
    );
  });

  // A query would otherwise be read as part of the slug and end up inside the
  // path, as `/docs/client-data?tab=api/`.
  it("keeps a query string after the trailing slash", () => {
    expect(localizeDocsHref("/docs/client-data?tab=api", "de-DE")).toBe(
      "/de-de/docs/client-data/?tab=api",
    );
  });

  it("keeps a query and a fragment together, in order", () => {
    expect(
      localizeDocsHref("/docs/client-data?tab=api#overview", "de-DE"),
    ).toBe("/de-de/docs/client-data/?tab=api#overview");
  });

  it("leaves a Markdown twin link alone", () => {
    expect(localizeDocsHref("/docs/client-data.md", "de-DE")).toBe(
      "/docs/client-data.md",
    );
  });

  it.each([
    "https://example.com/docs/client-data",
    "docs/client-data",
    "#usedbsync",
    "/apps/forms",
  ])("leaves %s alone", (href) => {
    expect(localizeDocsHref(href, "de-DE")).toBe(href);
  });
});

describe("localizeDocsMarkdownLinks", () => {
  // The twins are served to agents verbatim, so an un-rewritten link hands out
  // the redirecting URL.
  it("rewrites same-site docs links in a body", () => {
    const body =
      "See [actions](/docs/actions-overview) and [data](/docs/client-data#usedbsync).";

    expect(localizeDocsMarkdownLinks(body, "es-ES")).toBe(
      "See [actions](/es-es/docs/actions-overview/) and [data](/es-es/docs/client-data/#usedbsync).",
    );
  });

  it("canonicalizes default-locale bodies too", () => {
    expect(
      localizeDocsMarkdownLinks("[a](/docs/actions-overview)", "en-US"),
    ).toBe("[a](/docs/actions-overview/)");
  });

  it("leaves external links and Markdown twins alone", () => {
    const body = "[x](https://example.com/docs/a) [y](/docs/a.md)";

    expect(localizeDocsMarkdownLinks(body, "es-ES")).toBe(body);
  });

  // Docs teach syntax by example. Rewriting a link inside a fence edits the
  // sample the reader is meant to copy.
  it("leaves links inside fenced code alone", () => {
    const body = [
      "Prose [a](/docs/actions-overview).",
      "",
      "```md",
      "Copy this: [Actions](/docs/actions-overview)",
      "```",
    ].join("\n");

    const out = localizeDocsMarkdownLinks(body, "en-US");

    expect(out).toContain("Prose [a](/docs/actions-overview/).");
    expect(out).toContain("Copy this: [Actions](/docs/actions-overview)");
  });

  it("leaves links inside inline code alone", () => {
    expect(localizeDocsMarkdownLinks("use `[a](/docs/x)` here", "en-US")).toBe(
      "use `[a](/docs/x)` here",
    );
  });
});

describe("localizeSiteHref", () => {
  it("localizes policy links and preserves fragments", () => {
    expect(localizeSiteHref("/legal/dmca#notice", "de-DE")).toBe(
      "/de-de/legal/dmca/#notice",
    );
    expect(localizeSiteHref("/privacy", "es-ES")).toBe("/es-es/privacy/");
  });

  it("keeps an explicit policy locale", () => {
    expect(localizeSiteHref("/fr-FR/terms", "de-DE")).toBe("/fr-fr/terms/");
  });

  it("leaves non-policy site links alone", () => {
    expect(localizeSiteHref("/apps/forms", "de-DE")).toBe("/apps/forms");
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
