---
date: 2026-08-27
topic: docs-canonical-url-form
---

# Docs Canonical URL Form

## Summary

Make the docs site publish the URLs it actually serves: trailing slash as the canonical form, lowercase locale path segments, and every canonical tag, `hreflang` href, sitemap entry, internal link, and redirect target pointing at the URL that returns `200`.

---

## Problem Frame

`www.agent-native.com` serves its prerendered pages from directory-style output, so Netlify answers the trailing-slash form with `200` and permanently redirects the bare form to it. Netlify also lowercases locale path segments. The site's own code never adopted either convention — it builds every URL it advertises from the bare, mixed-case form.

The result is a site whose self-description contradicts its own server on nearly every page:

| URL form | Server response | Where the site points |
|---|---|---|
| `/docs/actions-overview` | `301` → `/docs/actions-overview/` | canonical, sitemap, hreflang, internal links |
| `/docs/actions-overview/` | `200` | nothing |
| `/es-ES/docs/actions-overview` | `301` → `/es-es/docs/actions-overview/` | canonical, sitemap, hreflang |
| `/es-es/docs/actions-overview/` | `200` | nothing |

Measured on the live sitemap: **1,509 URLs, of which 1,508 return `301`.** Only the homepage returns `200` on first request. Every page's self-referencing canonical is a redirect, and for the 1,291 locale-prefixed URLs it is a two-hop redirect to a URL that is never advertised anywhere.

This is not theoretical. Ahrefs' crawler currently holds both forms of nearly every page as distinct crawled URLs and re-crawls both — `/apps/chat` (`301`, crawled 2026-08-23) alongside `/apps/chat/` (`200`, crawled 2026-08-25). Googlebot has no reason to behave differently. The cost is doubled crawl budget, diluted link signals, and canonical tags that point away from the page serving them, paid continuously for as long as the mismatch stands.

The content itself is correct. `/es-es/docs/actions-overview/` returns proper Spanish with `<html lang="es-ES">`. The locale reader in `packages/docs/app/components/docs-locale.ts` already normalizes case on the way in via `Intl.getCanonicalLocales`. Only the URL *writer* is wrong.

---

## Requirements

**Canonical URL form**

- R1. The trailing-slash form of every HTML page is the canonical form and returns `200`.
- R2. The bare form permanently redirects to the trailing-slash form in a single hop.
- R3. Locale path segments are lowercase (`/es-es/`, `/zh-cn/`, `/pt-br/`). The lowercase form returns `200`; mixed-case redirects to it in a single hop.
- R4. `hreflang` attribute *values* keep canonical BCP-47 casing (`hreflang="zh-CN"`) while their `href` *paths* use the lowercase form. These are separate concerns and must not be derived from one another.
- R5. File-like paths are excluded from slash normalization: Markdown twins, machine-readable endpoints, and `.well-known` resources resolve exactly as they do today.

**Self-description surfaces**

- R6. Every page's `<link rel="canonical">` is self-referencing — it names the exact URL that served the response.
- R7. Every `hreflang` alternate `href` names a URL that returns `200`.
- R8. Every sitemap entry names a URL that returns `200`.
- R9. Internal links rendered by the app point at the canonical form, so in-app navigation and hard loads never traverse a redirect.
- R10. Redirect targets in host configuration name the canonical form, and are internally consistent with each other. Today they are not: one legacy rule targets a slashed path while another targets a bare path.

**Build output**

- R11. Prerendered output is written to lowercase locale directories, so the canonical locale URL is served directly from a static file rather than reached through host path normalization.

**Compatibility**

- R12. Every URL form that resolves today continues to resolve — bare, mixed-case, and both combined — via redirect. No externally-linked URL starts returning `404`.
- R13. Tests asserting current URL strings are updated within the same change, not deferred.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R6.** Given a published English doc, when `/docs/actions-overview` is requested, the response is a `301` to `/docs/actions-overview/`; that URL returns `200`, and its canonical tag reads `https://www.agent-native.com/docs/actions-overview/`.
- AE2. **Covers R3, R11, R12.** Given the Spanish translation of that doc, when `/es-ES/docs/actions-overview` is requested, the response is a single `301` to `/es-es/docs/actions-overview/`, which returns `200` from a prerendered file and serves Spanish content.
- AE3. **Covers R4, R7.** Given any localized doc page, its Simplified Chinese alternate is emitted as `hreflang="zh-CN"` with `href` ending `/zh-cn/docs/<slug>/`.
- AE4. **Covers R5.** Given a Markdown twin, when `/docs/actions-overview.md` is requested, it returns `200` with a Markdown content type and no trailing slash is appended.
- AE5. **Covers R8.** Given the deployed sitemap, when every `<loc>` in it is fetched without following redirects, all of them return `200`.

---

## Success Criteria

- Crawling the deployed sitemap produces `200` on every URL, and every fetched page's canonical points at the URL that was fetched. This is the check that proves the work — reading the diff does not.
- The redirect that currently normalizes locale case disappears rather than merely getting shorter: the canonical locale URL is served directly from a prerendered file.
- Re-checking third-party crawl data some weeks after deploy shows the duplicate-form pairs consolidating rather than both being re-crawled.
- A planner picking this up knows which URL form is canonical, which paths are carved out, and how to verify the result, without re-deriving any of it from the live site.

---

## Scope Boundaries

- Markdown twins currently returning `200` at both `/docs/<slug>.md` and `/docs/<slug>.md/`. Real duplication, different code path, separate change.
- The `/docs/adding-a-feature` and `/apps/video` `404`s surfaced in crawl data. Both are linked from somewhere and worth fixing; neither is a URL-form problem.
- Any broader SEO audit, Search Console setup, or content and keyword work. This change is about URL form only.
- Changing the supported locale set, or moving locales to per-locale subdomains the way React did.
- Any change to Netlify site settings. The entire fix stays in-repo and reviewable in a diff.

---

## Key Decisions

- **Trailing slash over no-slash.** Not an aesthetic call. React Router prerenders directory-style `index.html`, and Netlify serves that at the slashed form. No-slash would require disabling Netlify's Pretty URLs — a site setting, not expressible in `netlify.toml` — plus explicit redirects for the slash form, or the site lands in the both-forms-`200` state that is worse than either. Trailing slash keeps every moving part inside the repo.
- **Lowercase locale paths, BCP-47 `hreflang` values.** This is what Astro docs, Tauri, Kubernetes, and Microsoft Learn all converge on: `hreflang="zh-CN"` with `href` `/zh-cn/`. MDN is the visible counter-example using mixed-case paths, but it owns its routing layer; on Netlify the host normalizes to lowercase regardless of intent.
- **Both changes in one branch, against the initial instinct to split them.** They are not two changes. They are one wrong behavior — the URL builder does not emit the form the server serves — with two symptoms, and both live in the same URL-construction path. Splitting them means editing the same functions and churning the same test strings twice while 86% of the indexable surface stays broken in between.
- **Fix the writer, not the reader.** The locale reader already accepts lowercase. Nothing about route matching or content resolution changes.

---

## Dependencies / Assumptions

- Verified: React Router prerender emits `build/client/<path>/index.html`, confirmed against existing build output.
- Verified: `/es-es/docs/actions-overview/` returns `200` with correct Spanish content and `<html lang="es-ES">`.
- Verified: `docsSlugFromPathname` in `packages/docs/app/components/docs-locale.ts` resolves the locale segment through `normalizeLocaleCode`, which is case-insensitive via `Intl.getCanonicalLocales`.
- Verified: `canonicalPathForPath` in `packages/docs/app/components/docs-seo.ts` explicitly strips trailing slashes, and `docsPathForSlug` interpolates the mixed-case locale tag into the path.
- Assumed, not verified: the exact Netlify mechanism performing lowercase normalization. The observed behavior is what the requirements are written against; the mechanism matters only if R11 does not remove the redirect as expected.
- The branch is cut fresh. `feat/agent-start-guide` currently has uncommitted work that includes `packages/docs/app/vite-sitemap-plugin.ts` — a file this change also touches. That work must not ride along.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] Markdown twin paths are derived from `docsPathForSlug`. Confirm they do not inherit a trailing slash when that builder changes, and that the Netlify Markdown-negotiation edge function does not key off path shape.
- [Affects R10][Technical] The host redirect rules need a consistency sweep — legacy `/templates` rules target bare paths while the `/docs/getting-started` rule targets a slashed path. Determine whether these collapse into one normalization rule or stay enumerated.
- [Affects R11][Needs research] Confirm whether emitting lowercase prerender paths is sufficient for React Router to write lowercase output directories, or whether the locale directory name is derived separately.
- [Affects R9][Technical] Identify how internal links are constructed across routes and components, and whether they all flow through one builder or several.
