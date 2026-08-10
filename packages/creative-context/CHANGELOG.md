# @agent-native/creative-context

## 0.6.3

### Patch Changes

- 25f588e: Redirect legacy `/agent` management URLs to the canonical settings routes and preserve app-owned settings tabs.

## 0.6.2

### Patch Changes

- e177059: Restore the serverless Playwright fallback so production URL extraction can use packaged Chromium.

## 0.6.1

### Patch Changes

- aa24c7e: Use the declared optional Playwright runtime through a literal import so Cloudflare deployments can apply their fail-closed browser stub.
- 9d8ae68: Run website brand extraction in an isolated real browser through the SSRF-safe network proxy, with serverless Chromium support and an explicit static fallback.

## 0.6.0

### Minor Changes

- abb0cf5: Add a shared browser-rendered website design-system extraction surface with computed visual tokens, component evidence, and bounded design.md summaries.

## 0.5.12

### Patch Changes

- 2765110: Avoid database migrations and recurring sweeps during durable background cold starts.

## 0.5.11

### Patch Changes

- c71d383: Include the shared creative-context and toolkit updates in the next package release.

## 0.5.10

### Patch Changes

- d6e7c5c: Stop a second Chromium from being downloaded alongside the one already on disk.

  First-party workspace packages now take Playwright from an exact catalog pin, so
  a caret cannot resolve forward to a release tied to a different Chromium
  revision. The two packages that declare Playwright as a published optional
  dependency — `@agent-native/creative-context` and `@agent-native/recap-cli` —
  deliberately keep a caret range instead: an exact range in a library stops a
  consumer who already has a different Playwright from deduping, which forces a
  nested copy and downloads exactly the second browser this change exists to
  avoid.

## 0.5.9

### Patch Changes

- f499dff: Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
  worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
  25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
  config merges it in.

## 0.5.8

### Patch Changes

- c8a0bcf: Declare `@tanstack/react-query` as a peer/dev dependency so `tsc` can name its types under pnpm's isolated layout. Without it the package fails to build with TS2883 in a generated workspace, which breaks the root `postinstall` and therefore `pnpm install`.

## 0.5.7

### Patch Changes

- 8453025: Add manifest-driven feature ejection with dry-run planning, committed provenance, import rewrites, drift inspection, hash-gated restore, protected-runtime guidance, and complete first-party coverage guards.

## 0.5.6

### Patch Changes

- e53a34e: Extract reusable Postgres search and embedding primitives into Core while preserving Creative Context imports.
  The pgvector setup error now consistently says "Vector search" instead of the narrower "Visual search" wording.

## 0.5.5

### Patch Changes

- 6acaad0: Extract reusable Postgres search and embedding primitives into Core while preserving Creative Context imports.
  The pgvector setup error now consistently says "Vector search" instead of the narrower "Visual search" wording.

## 0.5.4

### Patch Changes

- 079e19a: Adopt focused Core client entrypoints and ship package migration metadata where applicable.

## 0.5.3

### Patch Changes

- b6d7f87: Move portable rich-editor, context presentation, and visual design controls into Toolkit while preserving Core compatibility re-exports, and add accurate side-effect metadata to capability packages.

## 0.5.2

### Patch Changes

- 915c940: Preserve stubbed optional package imports and package subpaths when bundling Cloudflare Pages workers.

## 0.5.1

### Patch Changes

- 8e0afec: Improve Creative Context sharing and connection-chip interactions.

## 0.5.0

### Minor Changes

- 149c0ee: Add bounded, app-owned native resource update checks and Library update submission controls.

### Patch Changes

- 149c0ee: Add governed creative-context sharing, host-backed native clone actions, and a reusable organization-admin permission helper.

## 0.4.0

### Minor Changes

- a485fbe: Add the Creative Context package for importing, versioning, searching, and reusing workspace decks, designs, assets, websites, and content across creative apps.

  Expose reusable ingestion, prompt-context provider, and search utility seams from core for package-driven creative context.

  Includes bounded image-region cropping for durable localized creative-context fallbacks.

## 0.3.0

### Minor Changes

- 9f2f7a7: Add the Creative Context package for importing, versioning, searching, and reusing workspace decks, designs, assets, websites, and content across creative apps.

  Expose reusable ingestion, prompt-context provider, and search utility seams from core for package-driven creative context.

  Includes bounded image-region cropping for durable localized creative-context fallbacks.

## 0.2.0

### Minor Changes

- 2625de5: Add the Creative Context package for importing, versioning, searching, and reusing workspace decks, designs, assets, websites, and content across creative apps.

  Expose reusable ingestion, prompt-context provider, and search utility seams from core for package-driven creative context.

  Includes bounded image-region cropping for durable localized creative-context fallbacks.
