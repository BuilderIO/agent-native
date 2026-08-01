---
"@agent-native/core": patch
---

Give the Cloudflare Worker preset a browser-rendering path, so screenshot and
vector-export actions render instead of throwing from the fail-closed stub.

The generated Worker configuration now declares the `BROWSER` binding, emitted
rather than hand-authored because the template's browser-runtime indirection
resolves that exact name — a hand-maintained copy that drifts from it is an
unbound binding on a deploy whose configuration reads as complete. An app that
already bound the name keeps its own value.

The Design template's single browser-runtime indirection gains a Cloudflare arm
ahead of its existing Node fallback chain: on a Worker it resolves the binding
and drives it through `@cloudflare/playwright`, presented under the same
`{ chromium }` shape the Node arms return so both call sites are unchanged. The
fork is an `optionalDependency` — a new declaration for this template, which
until now resolved every browser package by dynamic import alone — because the
whole point of the indirection is that the package can be absent.

A Cloudflare browser failure is reported as itself: no env, an unbound binding,
a binding that is not a Browser Rendering binding, and a fork that could not be
imported are four distinct messages, each naming what to change. None of them
resolves to a placeholder browser, and the actions' "no Chromium binary in this
hosted deploy" message no longer answers for a platform where the browser is a
binding rather than a binary.
