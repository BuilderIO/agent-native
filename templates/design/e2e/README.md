# Design editor — real-browser E2E

End-to-end tests that drive the **visual editor** in real Chromium with
`@playwright/test`. They exercise the things unit tests can't: selecting,
resizing, moving/reparenting, the layers panel, and the iframe bridge.

## Run

```bash
pnpm e2e          # headless
pnpm e2e:headed   # watch it drive a real browser
pnpm e2e:ui       # Playwright UI mode
```

- `playwright.config.ts` starts its own dev server on **:9333** backed by a
  throwaway SQLite db (`data/e2e.db`) — `APP_NAME=design` +
  `DESIGN_DATABASE_URL=file:...` so a `.env` Postgres URL can never leak in.
- Locally, if a server is already running on :9333 it is **reused**
  (`reuseExistingServer`). The most reliable local loop is to keep a server up
  yourself and run against it:
  ```bash
  APP_NAME=design DESIGN_DATABASE_URL="file:./data/e2e.db" PORT=9333 pnpm dev   # one terminal
  E2E_BASE_URL=http://localhost:9333 pnpm e2e                                   # another
  ```
  `E2E_BASE_URL` makes Playwright skip server management entirely and just use
  yours — handy when the cold Vite optimize is slow under Playwright's spawn.

`e2e/global-setup.ts` signs up a test user (email/password — there is **no dev
auth bypass**), saves the signed session to `e2e/.auth/state.json`, and seeds
one design with a known fixture (`e2e/.auth/seed.json`) via the authenticated
action endpoints. Both `.auth/` files are gitignored.

## Why the editor needs special handling (the hard-won bits)

The design renders inside a `sandbox="allow-scripts"` iframe with **no
`allow-same-origin`**, and a pointer-capturing shield overlay sits on top. So:

| Symptom                                                                 | Wrong approach                         | Right approach                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can't read iframe DOM                                                   | `iframe.contentDocument` → `null`      | `page.frameLocator('iframe').locator(...)` — CDP targets the frame directly                                                                                                                                |
| Clicks "intercepted by `<div data-agent-native-edit-overlay="shield">`" | normal click (actionability fails)     | `.click({ force: true })` — the shield is _meant_ to get the event and drive selection                                                                                                                     |
| Asserting an edit happened                                              | reading iframe state                   | listen for the bridge's parent `postMessage`s: `element-select`, `element-hover`, `visual-style-change`, `visual-structure-change` (see `installBridge`/`waitForBridge`)                                   |
| `page.screenshot()` hangs forever                                       | `page.screenshot()`                    | `cdpScreenshot()` — CDP `Page.captureScreenshot`, no stability wait (the page never idles; the agent-chat panel polls)                                                                                     |
| Node ids change between runs                                            | hardcoding `data-agent-native-node-id` | select by **text/role**, then read the stamped id back from the `element-select` payload                                                                                                                   |
| Drag move/resize                                                        | HTML5 `dragTo` on the canvas           | `page.mouse.move/down/up` with intermediate steps at `boundingBox()` coords (the canvas uses raw pointer events). The **layers panel** is in the parent doc and _does_ use HTML5 DnD → `locator.dragTo()`. |

`helpers.ts` wraps all of this: `gotoEditor`, `selectByText`, `dragCanvasByText`,
`installBridge`/`waitForBridge`, `cdpScreenshot`, `readSeedDesignId`.

## Driving your REAL, logged-in Chrome (chrome-devtools-mcp)

Playwright (above) is best for deterministic CI against a local throwaway DB.
To exercise the **deployed app with your actual Google session** — no test
user, no seeding — drive a real Chrome over CDP:

```bash
# 1. Launch Chrome (144+) with remote debugging. Use a separate profile dir so
#    you can sign in normally without touching your main profile.
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-e2e" &
# 2. Sign in to the deployed Design app in that window.
```

Then attach the agent's **`chrome-devtools-mcp`** built-in (the `/qa` skill
toggles it; it runs `npx chrome-devtools-mcp@latest --autoConnect`) and drive it
with `navigate_page` / `take_snapshot` / `evaluate_script` / `click`. The exact
same editor techniques apply — `evaluate_script` can install the bridge listener
and read frame content; clicks go through the shield. This path uses your live
auth and data, so it's ideal for manual/exploratory verification and smoke-
testing prod, while the Playwright suite stays the deterministic regression net.
