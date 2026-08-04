---
"@agent-native/core": patch
---

Stop stranding users on the loading spinner when the session endpoint is
unreadable. `useSession` retried a failed `/_agent-native/auth/session` every
second forever while holding `isLoading` true, so a transient 5xx, network
failure, or timeout produced a spinner that never resolved and carried no error
anywhere. It now retries a bounded number of times with backoff and then reports
a distinct `status: "unavailable"` alongside the existing `session`/`isLoading`
fields.

`RequireSession` keys off that status: unreadable is no longer collapsed into
signed-out (which would bounce a signed-in user to the sign-in page over a blip)
nor into loading (which stranded them). It renders a notice with Try again and
Reload actions instead.

The `DefaultSpinner` stall hint is also environment-aware now. It previously
told every visitor — including on hosted deployments — to "check the terminal
running the dev server", which is meaningless outside local development.
