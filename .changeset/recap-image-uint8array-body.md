---
"@agent-native/core": patch
---

PR Visual Recap: restore the inline screenshot in the sticky PR comment. The
recap's PNG upload to `POST /_agent-native/recap-image` was silently failing, so
`recap shot` returned an empty `imageUrl` and the comment fell back to a
link-only body.

Root cause: h3 v2's `readRawBody(event, false)` resolves a bare `Uint8Array`,
not a Node `Buffer`. The route then called Buffer-only methods on it — the PNG
magic-byte check (`Buffer#equals`) _threw_ (`.equals` doesn't exist on a
`Uint8Array`), surfacing as a 500 so the CLI saw `!res.ok`; and even past that,
the store's `png.toString("base64")` would have silently mis-encoded the bytes
(a bare `Uint8Array` ignores the encoding argument). The upload route now
normalizes the body to a `Buffer` once before the magic-byte check and storage,
so both the raw `image/png` and JSON `{ pngBase64 }` paths persist the exact
bytes uploaded.

`recap shot`'s image-upload helper now also logs the HTTP status / response
snippet to stderr on failure (stdout still carries only the machine-readable
JSON the workflow parses), so a future upload failure is debuggable from the CI
log instead of vanishing into a null `imageUrl`. The route's unit test mock now
mirrors h3 v2 by handing the handler a real `Uint8Array`, which would have
caught the original regression.
