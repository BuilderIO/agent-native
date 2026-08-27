---
date: 2026-08-27
status: active
type: fix
origin: docs/brainstorms/docs-canonical-url-form-requirements.md
branch: fix/docs-canonical-url-form
---

# fix: Docs canonical URL form

## Summary

Make the docs site publish the URLs it actually serves. `docsPathForSlug` becomes the canonical route builder — trailing slash, lowercase locale segment — and the two helpers that derive non-route strings from it are rebuilt from the slug instead. Canonical tags, `hreflang` hrefs, sitemap entries, prerender paths, and redirect targets all follow from that one change.

---

## Problem Frame

Netlify serves the docs site's prerendered pages from directory-style output, so the trailing-slash form returns `200` and the bare form permanently redirects to it. Netlify also lowercases locale path segments. The app's URL builders adopted neither convention.

Live measurement: the deployed sitemap lists **1,509 URLs, of which 1,508 return `301`**. Only the homepage returns `200` on first request. Every page's self-referencing canonical points at a redirect, and for the 1,291 locale-prefixed URLs it is a two-hop redirect to a URL nothing advertises. Ahrefs currently holds both forms of most pages as separate crawled entries and re-crawls both.

The content and the reader are already correct. `/es-es/docs/actions-overview/` serves proper Spanish with `<html lang="es-ES">`, and `normalizeLocaleCode` resolves the locale segment case-insensitively via `Intl.getCanonicalLocales`. Only the writer is wrong. (see origin: `docs/brainstorms/docs-canonical-url-form-requirements.md`)

---

## High-Level Technical Design

The change hinges on separating three string kinds that today all flow out of one builder:

```text
docsPathForSlug(slug, locale)      -> ROUTE path      -> /es-es/docs/actions-overview/
docsMarkdownPathForSlug(...)       -> ASSET path      -> /es-es/docs/actions-overview.md
comparableDocsPath(pathname)       -> EQUALITY key    -> /docs/actions-overview
```

Today the second and third are built by string-appending onto the first. That is why a trailing slash on the route builder silently corrupts them:

```text
"/docs/actions-overview/" + ".md"            -> /docs/actions-overview/.md      (404)
"/docs/" + "/getting-started.md"             -> /docs//getting-started.md       (404)
```

*This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

The route builder becomes canonical; the asset path and the equality key are built from `(slug, locale)` directly. Reader-side functions are untouched — they already normalize case and strip trailing slashes before matching.

---

## Key Technical Decisions

- **Make the default builder canonical rather than adding a second one.** Introducing a parallel `canonicalDocsPathForSlug` alongside the existing builder would leave two forms in circulation, making every future call site a coin flip about which to use. Default-correct with two explicit, tested exceptions matches the repo's stated rule about fixing the boundary that made the special case necessary.
- **Lowercase only at the point the segment is written into a path.** `DocsLocale` values stay BCP-47 (`es-ES`) throughout the type system, `hreflang` attribute values stay BCP-47, and the lowercase transform applies solely to the path segment. This is the split Astro, Tauri, Kubernetes, and Microsoft Learn all converge on.
- **No new host redirect rules for slash normalization.** Netlify already `301`s bare to slashed for prerendered paths. The work is making redirect *targets* consistent, not adding normalization.
- **Test-first on the builders.** The failure mode is string shape — a test catches `/docs//getting-started.md` instantly and code review reliably does not.

---

## Requirements Traceability

| Origin requirement | Covered by |
|---|---|
| R1, R2 (slash canonical, single-hop redirect) | U1, U5 |
| R3 (lowercase locale segments) | U1, U4 |
| R4 (BCP-47 `hreflang` values, lowercase hrefs) | U1, U3 |
| R5 (file-like paths carved out) | U2 |
| R6 (self-referencing canonical) | U3 |
| R7 (`hreflang` hrefs return 200) | U3 |
| R8 (sitemap entries return 200) | U4 |
| R9 (internal links) | U1 |
| R10 (consistent redirect targets) | U5 |
| R11 (lowercase prerender output) | U4 |
| R12 (nothing that resolves today starts 404ing) | U2, U5 |
| R13 (tests updated in the same change) | all units |

---

## Implementation Units

### U1. Canonical route builder

**Goal:** `docsPathForSlug` emits the canonical form — trailing slash, lowercase locale segment — so every internal link, redirect target, and canonical path inherits it.

**Requirements:** R1, R3, R4, R9

**Dependencies:** none

**Files:**
- `packages/docs/app/components/docs-locale.ts`
- `packages/docs/app/components/docs-localization.test.ts`

**Approach:** Add a locale-segment lowercase transform applied where the segment is written into a path, not to the `DocsLocale` value itself. `docsPathForSlug` returns `/docs/`, `/docs/<slug>/`, `/<locale-lower>/docs/`, `/<locale-lower>/docs/<slug>/`. `sitePathForLocale`, `localizedDocsPath`, and `localizeDocsHref` inherit through it — confirm the non-docs branch of `sitePathForLocale` (which handles `/apps`, `/pricing`, and the bare locale root) emits the same shape rather than falling through untouched. Reader-side functions are not modified.

**Execution note:** Test-first. Write the shape assertions before changing the builder.

**Patterns to follow:** the existing `normalizePath` and `pathSegments` helpers in the same module.

**Test scenarios:**
- Default locale, ordinary slug produces `/docs/<slug>/`.
- Default locale, `getting-started` produces `/docs/` — not `/docs/getting-started/`.
- Non-default locale, ordinary slug produces `/es-es/docs/<slug>/`.
- Non-default locale, `getting-started` produces `/es-es/docs/`.
- Table-driven across every configured locale: the emitted segment is lowercase and matches the locale's own lowercased BCP-47 tag (catches `zh-TW` → `zh-tw`, `pt-BR` → `pt-br`).
- `sitePathForLocale` on a non-docs path returns `/apps/` for the default locale and `/es-es/apps/` for a non-default one.
- `sitePathForLocale` is idempotent: feeding its own output back returns the same value.
- `localizeDocsHref` keeps the fragment after the slash: `/docs/client-data#usedbsync` becomes `/de-de/docs/client-data/#usedbsync`.
- Regression guard: `docsSlugFromPathname` still resolves bare, mixed-case, and slashed inbound paths to the same slug.

**Verification:** Unit tests pass. Grep confirms no call site constructs a docs path by string concatenation outside this module.

---

### U2. Decouple the asset path and equality key from the route builder

**Goal:** `docsMarkdownPathForSlug` and `comparableDocsPath` stop deriving from the route path, so the trailing slash cannot corrupt them.

**Requirements:** R5, R12

**Dependencies:** U1

**Files:**
- `packages/docs/app/components/docs-locale.ts`
- `packages/docs/app/components/docs-localization.test.ts`
- `packages/docs/tests/markdown-mirror.test.ts`
- `packages/docs/tests/markdown-negotiation.test.ts`

**Approach:** Build the Markdown twin path from `(slug, locale)` directly rather than appending onto the route path. `comparableDocsPath` returns a bare normalized key — it is an equality token for comparison, not a URL, and giving it a trailing slash would change nothing visible while quietly breaking every comparison that already normalizes.

**Execution note:** Test-first, and land these assertions before or alongside U1 — this is the specific trap the design exists to avoid.

**Test scenarios:**
- Covers AE4. `/docs/actions-overview.md` — exactly one slash before the filename, no trailing slash, no `/.md`.
- `getting-started` produces `/docs/getting-started.md`, not `/docs//getting-started.md`.
- Localized twin produces `/es-es/docs/actions-overview.md`.
- `comparableDocsPath` returns the same key for all four of `/docs/x`, `/docs/x/`, `/es-ES/docs/x`, and `/es-es/docs/x/`.
- Markdown negotiation on a slashed HTML path still resolves to the right mirror — the edge function keys off the `.md` extension, so a slashed HTML path must not be misrouted.
- Markdown mirror lookup succeeds for both the default and a non-default locale after the path shape changes.

**Verification:** Markdown twins resolve locally for default and localized slugs, including `getting-started`.

---

### U3. Canonical and hreflang emission

**Goal:** Every page's canonical points at itself, and every `hreflang` alternate href names a URL that returns `200`.

**Requirements:** R4, R6, R7

**Dependencies:** U1

**Files:**
- `packages/docs/app/components/docs-seo.ts`
- `packages/docs/app/root.tsx`
- `packages/docs/app/components/docs-localization.test.ts`

**Approach:** `canonicalPathForPath` currently strips the trailing slash before returning; it should return the canonical form instead. Its internal `normalizePath` call stays — matching still happens on the bare form, only the return value changes. Update the `CANONICAL_ALIASES` target for `getting-started`. For alternates, keep the `hrefLang` value sourced from `DOCS_LOCALES` (BCP-47, unchanged) while the `path` runs through the canonical builder.

**Test scenarios:**
- Canonical for a request at `/docs/x/` is `/docs/x/`.
- Canonical for a request at the bare `/docs/x` — reachable via the SSR fallback — still emits the slashed form.
- `getting-started` alias: a request at `/docs/getting-started` canonicalizes to `/docs/`.
- Covers AE3. Alternate pairs emit `hrefLang="zh-CN"` with an href ending `/zh-cn/docs/<slug>/` — asserting value and path casing differ.
- `x-default` is present and uses the canonical slashed form.
- A locale with no available translation is still omitted from alternates after the shape change.

**Verification:** Rendering a localized doc page produces a self-referencing canonical and alternates whose paths all end in `/`.

---

### U4. Sitemap, agent-web pages, and prerender paths

**Goal:** Every advertised URL and every prerendered output directory uses the canonical form.

**Requirements:** R8, R11

**Dependencies:** U1, U2

**Files:**
- `packages/docs/app/vite-sitemap-plugin.ts`
- `packages/docs/app/vite-sitemap-plugin.spec.ts`

**Approach:** Page paths are currently assembled inline as template literals (`/docs/${slug}`, `/${locale}/docs/${slug}`, `/apps/${slug}`). Route these through the canonical builder so the sitemap, the llms surface, and the prerender list all agree by construction rather than by parallel string-building. `markdownPath` entries use the Markdown builder from U2 and stay bare. React Router writes `${prerenderPath}/index.html` verbatim, so lowercase paths in the prerender list land as lowercase directories with no further work.

**Trap to avoid:** `buildPrerenderPaths` filters with `isRedirectedDocsPath(page.path)`. Once `page.path` carries a trailing slash, that predicate must be fed the comparable form or it silently stops matching — and a redirected slug would get prerendered as a `200`, baking a wrong page into a static file. This is the exact silent-coercion shape the repo's guards target.

**Test scenarios:**
- Every generated page path ends with `/`, except paths that are file-like.
- Every locale-prefixed page path uses a lowercase segment.
- `markdownPath` entries end in `.md` with no trailing slash and no doubled slash.
- Covers AE5. The prerender list equals the page list minus drafts and redirected slugs — the existing invariant, re-asserted against the new path shape.
- Regression guard: a known renamed slug is still excluded from the prerender list after the path shape changed.
- A draft doc and every translation of a canonically-draft slug remain excluded.

**Verification:** A local build writes lowercase locale directories under the client output, and no prerendered file exists for a redirected or draft slug.

---

### U5. Host redirect surfaces

**Goal:** Redirect targets name the canonical form and the three surfaces holding redirect data agree with each other.

**Requirements:** R2, R10, R12

**Dependencies:** U1

**Files:**
- `packages/docs/netlify.toml`
- `packages/docs/netlify/edge-functions/markdown-negotiation.ts`
- `packages/docs/tests/redirects.test.ts`

**Approach:** No new normalization rules — Netlify already redirects bare to slashed for prerendered paths. The work is target consistency. Today `/templates/*` targets `/apps/:splat` (bare) while `/docs/getting-started` targets `/docs/` (slashed); both should be canonical. The SSR slug redirect at `packages/docs/app/routes/docs.$slug.tsx` builds its target with `docsPathForSlug` and therefore inherits the fix, collapsing today's live two-hop chain `/docs/actions` → `/docs/actions-overview` → `/docs/actions-overview/`. The edge function's `excludedPath` array duplicates several of these paths in bare form and must stay in sync.

**Test scenarios:**
- Covers AE1. Legacy template redirects target the canonical form for bare, slashed, splat, and locale-prefixed variants.
- Covers AE2. The `getting-started` redirect targets `/docs/` for the default locale and `/<locale-lower>/docs/` otherwise.
- Every path enumerated in a `netlify.toml` redirect has a corresponding entry in the edge function's `excludedPath` list — asserted programmatically, not by eye.
- A renamed slug reaches its destination in one redirect hop, not two.

**Verification:** Redirect tests pass; no rule targets a URL that another rule would redirect again.

---

## Verification Strategy

Unit and integration tests cover the string shapes. The claim this plan actually makes, though, is about the deployed site, and only a deployed crawl proves it:

- After deploy, fetch every `<loc>` in the live sitemap **without following redirects** and assert `200` on all of them. This is the success criterion from the origin document, and it is the check that would have caught the current state.
- Spot-check a localized page's served HTML: its canonical must equal the URL that was fetched.
- Confirm `/es-ES/docs/<slug>` reaches its destination in exactly one hop.

Do not report this fixed on the basis of green unit tests alone — the current bug passes every existing test.

---

## System-Wide Impact

- **20 test files** in `packages/docs` assert URL strings and will need updating. This is the bulk of the diff and is expected, not a smell.
- **Localized docs across 11 non-default locales** change URL shape. Content and translations are untouched.
- **External links** to bare or mixed-case URLs keep working via redirect; nothing that resolves today starts returning `404`.
- **Search engines** will re-crawl and consolidate. Expect a transitional period where both forms appear in third-party indexes.

---

## Concurrent Work

A separate session is fixing two unrelated `404`s (`/docs/adding-a-feature`, `/apps/video`) on its own branch. Its brief explicitly excludes URL-form logic, but it touches files this plan also edits:

- `packages/docs/netlify.toml`
- `packages/docs/app/components/docs-slug-redirects.ts`
- `packages/docs/tests/redirects.test.ts`

Whichever branch lands second should rebase and re-read those files rather than resolving by clobber. If that work adds a slug redirect, its target inherits the canonical form automatically once U1 lands.

---

## Scope Boundaries

- Markdown twins currently returning `200` at both `/docs/<slug>.md` and `/docs/<slug>.md/`. Real duplication, different code path.
- Any broader SEO audit, Search Console setup, or content and keyword work.
- Changing the supported locale set, or moving locales to per-locale subdomains.
- Any change to Netlify site settings. The entire fix stays in-repo.

### Deferred to Follow-Up Work

- A guard that crawls the deployed sitemap and fails on any non-`200`. It is the right mechanism for keeping this fixed, but it is network-dependent and does not belong in the same change as the fix itself.

---

## Deferred to Implementation

- Exact helper naming for the locale-segment lowercase transform.
- Whether `sitePathForLocale`'s non-docs branch needs its own slash handling or inherits cleanly — visible once U1's tests run.
- The precise set of test files needing updates; the count is known but the per-file edits surface during execution.
