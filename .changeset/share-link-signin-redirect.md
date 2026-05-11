---
"@agent-native/core": patch
---

ErrorBoundary: "Go home" now triggers a full page reload (was client-side
`<Link>`), so a signed-out visitor who lands on an error page is taken
through the server auth guard's sign-in flow instead of getting stuck on
a logged-in route with failing API calls. Also softens the 404 message
to a plain "We couldn't find this page." for end users — the previous
copy mentioned Dispatch and "shipping" routes, which only made sense to
developers working on workspace apps.
