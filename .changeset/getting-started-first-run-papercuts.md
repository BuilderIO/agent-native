---
"@agent-native/core": patch
---

Make two first-run failures explain themselves instead of looking like a broken app.

The full-screen loading shell now reveals an explanatory line after 10 seconds
("a first run compiles dependencies…, otherwise check the terminal"). The reveal
is a pure-CSS `animation-delay`, not a timer, because the states that strand a
user on this screen — hydration never running, a route module 404ing, a cold dev
compile — are exactly the states where none of our JS executes. A featureless
spinner is indistinguishable from a blank page and reads as "the app is broken"
rather than "look at the terminal".

Missing-table database errors now name the likely cause. The driver reports
`no such table: x` from whichever query touched it first, so the stack lands in
an action and reads as a bug there; the real cause is almost always that no
migration created it, which is what a template with no `server/plugins/db.ts`
does. The hint is appended to the driver's original message, so existing error
classifiers that match its substrings are unaffected.
