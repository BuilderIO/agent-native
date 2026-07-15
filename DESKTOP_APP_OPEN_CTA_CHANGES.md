# Clips: "Open Desktop App" CTA

Summary of changes that make the Clips "Download desktop app" call-to-action
turn into "Open desktop app" once the user has the app, and actually launch the
installed desktop app via a `clips://` custom URL scheme.

## What changed (user-facing)

- The desktop CTA now shows **"Open desktop app"** after the user has downloaded
  it, instead of always saying "Download desktop app".
- Clicking the CTA **tries to launch the installed desktop app** (`clips://open`)
  and falls back to the `/download` page if the app is not installed.
- A successful launch self-heals the stored state, so the button reliably shows
  "Open desktop app" afterward.

## How it works

Browsers cannot query whether a custom protocol is registered, so detection is
best-effort at click time:

1. The click navigates to `clips://open`.
2. If the tab loses focus within ~800ms (the app took over), we treat it as
   launched and mark the app as downloaded.
3. If nothing happens, we fall back to the `/download` page.

The stored "downloaded" hint only drives the button wording; the click behavior
is always try-open-then-fallback, so correctness never depends on the hint being
right.

## Files touched

### Web (`templates/clips/app`)

- `lib/capture-install-options.ts`
  - Split storage flags: `clips.desktop-app.downloaded` (downloaded) vs the
    existing `clips.desktop-promo.dismissed` (promo dismissed). Downloading sets
    both; dismissing sets only the dismissed flag.
  - Added `hasDismissedDesktopPromo()` / `markDesktopPromoDismissed()`.
  - Added `attemptOpenDesktopApp(fallbackHref)` — try `clips://open`, watch for
    focus loss, fall back to the download page, self-heal on success.
- `hooks/use-desktop-promo.ts` — dismiss now only writes the dismissed flag, so
  dismissing the promo no longer wrongly flips the CTA label.
- `components/capture-install-options.tsx`
  - Added optional `downloadedChildren` label prop and an SSR-safe downloaded
    check.
  - CTAs try-open-then-fallback; when already downloaded, the CTA opens the app
    directly (no installer chooser popover).
- Call sites pass the "Open" label: `routes/record.tsx`,
  `routes/_app.dictate.tsx`, `components/library/library-layout.tsx`,
  `routes/share.$shareId.tsx`.
- `i18n/*.ts` — added `captureInstall.openDesktopApp` in `en-US` and all 10
  other locales.
- `lib/capture-install-options.test.ts` — covers the downloaded/dismissed split.

### Desktop (`templates/clips/desktop/src-tauri`)

- `Cargo.toml` — added `tauri-plugin-deep-link = "2"`.
- `tauri.conf.json` — registered `plugins.deep-link.desktop.schemes: ["clips"]`.
- `capabilities/default.json` — added `deep-link:default`.
- `src/lib.rs`
  - Added a shared `present_popover()` helper; single-instance relaunch handler
    reuses it.
  - Registered the deep-link plugin and an `on_open_url` handler that focuses the
    popover and emits a `clips:deep-link` event; `register_all()` on
    Windows/Linux (macOS registers via Info.plist at build time).

## Verification

- Web typecheck: passing.
- Clips test suite: passing (includes the new storage-split tests).
- Rust/desktop: reviewed but **not compile-verified** in the web dev
  environment (no `cargo`). Run `pnpm --filter clips tauri:build` to compile and
  produce a build that registers `clips://`.

## Rollout note

The native launch only works once users install a desktop build that includes
the `clips://` scheme. Users on the current installed version keep getting the
graceful `/download` fallback until they update.
