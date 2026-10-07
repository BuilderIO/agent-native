---
name: authentication
description: >-
  How to wire this app's login experience through the framework's
  createAuthPlugin — branded loginHtml, public paths, and signup/logout UI.
  Read before creating or editing server/plugins/auth.ts, or before adding
  gated routes / a public marketing page.
scope: dev
metadata:
  internal: true
---

# Authentication

## Rule

If a user requests authentication or login or other similar terms, you should setup
authentication in their app using this skill.

`server/plugins/auth.ts` exports `createAuthPlugin(options)` from
`@agent-native/core/server` — that plugin is the app's auth. Do not hand-roll
session cookies, a parallel login route, or a custom auth backend; configure
the existing plugin instead.

## Choose the landing route before wiring auth

Before writing `loginHtml` or the sign-in journey, inspect `app/routes`, the
app's navigation, and any existing `app.homePath` in
`server/plugins/config.ts`. Preserve a valid existing `homePath`; otherwise
pick the app's actual primary authenticated route (`/`, `/dashboard`,
`/tasks`, ...) and persist it there — never assume `/home` unless that route
really exists. `loginHtml` and the journey script below both need this value:
a hardcoded `/` only works for apps whose real landing page is root.

## Branded login page

Pass `loginHtml: string` — a full HTML document that replaces the built-in
login page and its framework chrome entirely, so it can carry this app's own
layout, fonts, colors, and copy. Write it to match this app's actual look and
feel (its palette, type, and voice) — do not ship the generic framework login
page, and do not reuse another app's `loginHtml` verbatim without replacing
its copy and styling first.

The login HTML must call the framework's own auth endpoints, so behavior
matches the built-in page:

- `POST /_agent-native/auth/register { email, password, callbackURL? }` →
  `{ ok: true }` or `{ error }`. **`{ ok: true }` only means the account was
  created — register does NOT set a session cookie, so the visitor is still
  signed out at this point.**
- `POST /_agent-native/auth/login { email, password }` → sets the session
  cookie and returns `{ ok: true }` or `{ error }`. This is the only
  endpoint that establishes a session.
- `GET /_agent-native/google/auth-url?return=<path>` → `{ url }` to send the
  browser to for Google sign-in (only relevant when Google OAuth is
  configured)

**Sign-up must chain register → login before treating the user as signed
in.** A custom `loginHtml` that posts to `/register` and redirects on that
response's `{ ok: true }` alone creates the account but leaves the visitor
logged out — they land back on the app, still unauthenticated, and have to
log in separately right after signing up. The framework's own built-in login
page (not the custom `loginHtml` you write) already does this chaining
internally, which is why this bug only shows up once an app supplies its own
`loginHtml`. Every sign-up handler must call login immediately after a
successful register, with the same email/password, and only redirect once
*that* call also returns `{ ok: true }`:

```js
function submitSignup(email, password) {
  return postJson("/_agent-native/auth/register", email, password).then(
    function (data) {
      if (!(data && data.ok)) throw new Error(data && data.error);
      // Register succeeded but did not sign the visitor in — log in now.
      return postJson("/_agent-native/auth/login", email, password);
    },
  );
}
```

On success there is no redirect to follow — reload the current URL (e.g.
`location.reload()`) and it now passes the auth guard.

**This shortcut only works at the root path.** For any other gated route
(e.g. `/toppings`), the client `<RequireSession>` gate does not serve
`loginHtml` in place at that URL — it navigates the browser to
`/sign-in?c=<opaque-continuation>` first, so `location.reload()` there just
re-shows the login form forever instead of returning the visitor to
`/toppings`. To resume the original page, decode that continuation with the
framework's own helper instead of hand-rolling redirect logic:

```html
<script>${signInJourneyInlineScript()}</script>
<!-- import { signInJourneyInlineScript } from "@agent-native/core/shared" -->
<script>
  // Second arg is the app home path — use the app's configured `app.homePath`
  // from server/plugins/config.ts (e.g. "/dashboard"), not a hardcoded "/".
  var journey = __anCreateSignInJourney("", "/dashboard");
  var resumeHref = journey.journeyForLocation(window.location).resumeHref;
  // On page load: if already authenticated, window.location.replace(resumeHref)
  // On login/signup success: window.location.replace(resumeHref) instead of reload()
</script>
```

`resumeHref` decodes the `c` continuation back to the originally-requested
path, falling back to that configured `homePath` when there isn't one —
hardcoding `/` here silently sends visitors to the wrong page on any app
whose real landing route isn't root. Embed `signInJourneyInlineScript()` in
every custom `loginHtml` that guards more than just `/`.

The login page must include:

- A **sign-in** form (email/password) posting to `/_agent-native/auth/login`.
- A **sign-up** control — a visible "Sign up" / "Create account" affordance
  that posts to `/_agent-native/auth/register`. Never ship a login-only page
  with no way to register.

## Logging out

Once a user is signed in, the app's authenticated UI must include a **logout**
control — do not leave users with no way to sign out. Use the framework's
`signOut()` helper from `@agent-native/core/client` rather than posting to
`/_agent-native/auth/logout` directly; it revokes the server session and only
then navigates, avoiding a stale authenticated screen that renders against a
dead cookie:

```ts
import { signOut } from "@agent-native/core/client";

<button onClick={() => signOut()}>Log out</button>;
```

## Separating a public marketing page from the private app

When an app needs a public landing surface in front of a gated authenticated
app, keep the two on different routes rather than gating everything or exposing
everything. The blank starter ships `app/routes/_index.tsx` as a placeholder
canvas at `/`; a common split is:

- **Public marketing page** at `/` — listed in `workspaceAppPublicPaths` (and
  `PUBLIC_PATHS` in `app/root.tsx`, see below) so signed-out visitors can reach
  it.
- **Private app** behind auth at a separate route (e.g. `/dashboard`), used as
  `app.homePath`.

For the public page, prefer the framework's ready-made shell
`MarketingHome` from `@agent-native/toolkit/marketing` instead of hand-rolling
a hero. It renders a branded landing shell with a hero, value props, and CTA
buttons that can deep-link into sign-in and the app:

```tsx
import { MarketingHome } from "@agent-native/toolkit/marketing";
import { appPath } from "@agent-native/core/client/api-path";
import { APP_TITLE } from "@/lib/app-config";

export default function MarketingHomeRoute() {
  return (
    <MarketingHome
      appName={APP_TITLE}
      tagline="One-line value proposition."
      description="Supporting product description."
      valueProps={["First benefit", "Second benefit", "Third benefit"]}
      primaryActionHref={appPath("/dashboard")} // the app's real homePath
      secondaryActionHref={appPath("/sign-in")}
    />
  );
}
```

Point `primaryActionHref` at the app's actual authenticated landing route (the
same value chosen for `app.homePath`), not a hardcoded `/home`. Pass
`variant="auth"` with an `auth` node to compose the login form beside the
marketing copy on a single public page. Only reach for `MarketingHome` when the
app actually wants a public marketing surface — a purely private app needs no
public landing page at all.

## Public paths

`workspaceAppPublicPaths: string[]` exempts page-route prefixes from the
private-app auth gate, e.g. `["/"]` so a logged-out visitor hitting the
marketing root gets the SPA (which renders the public landing page) instead of
being redirected to sign-in. Every route not listed here — and every
action/API — stays gated and requires a session. Set this explicitly for any
route a signed-out visitor should be able to reach; use
`workspaceAppProtectedPaths` for the inverse (an otherwise-public audience
with specific pages, e.g. an admin screen, that must still require a session).

**This only configures the server.** There is a SEPARATE client-side gate in
`app/root.tsx`: `<AppProviders queryClient={...}>` defaults its `isPublicPath`
prop to `false`, which wraps the *entire* app in `<ClientOnly>` +
`<RequireSession>` — every route, including ones already listed in
`workspaceAppPublicPaths`. Setting `workspaceAppPublicPaths` alone does
**not** make a page public; the two must be kept in sync by hand:

```tsx
// app/root.tsx — must match workspaceAppPublicPaths in server/plugins/auth.ts
const PUBLIC_PATHS = ["/", "/menu", "/order"];

export default function Root() {
  const location = useLocation();
  const isPublicPath = PUBLIC_PATHS.includes(location.pathname);
  return (
    <AppProviders queryClient={queryClient} isPublicPath={isPublicPath}>
      {/* ... */}
    </AppProviders>
  );
}
```

Forgetting this makes every route require sign-in even when the server
config says otherwise — the symptom is public marketing pages redirecting to
login for no apparent reason. When adding or changing
`workspaceAppPublicPaths`, always update this array in `app/root.tsx` too.

**Setting `isPublicPath={true}` streams real SSR markup for that route
instead of a `<ClientOnly>` shell** (see `AppProviders`'s own doc comment).
Most generated `root.tsx` files already mount router-dependent app-shell
services next to `<Outlet />` — e.g. a `DbSyncSetup`-style component calling
`useNavigationState` / `useLocation`, or anything else needing Router
context. Those services were only ever exercised inside the `<ClientOnly>`
branch before; once a route becomes public, they render during SSR too,
where that context may not be established, and the whole page 500s with
`Error: useLocation() may be used only in the context of a <Router>
component`, repeated several times in the server log. Wrap any such service
in `<ClientOnly>` explicitly so it keeps deferring to the client regardless
of `isPublicPath`:

```tsx
import { ClientOnly } from "@agent-native/core/client/ui";

<AppProviders queryClient={queryClient} isPublicPath={isPublicPath}>
  <ClientOnly>
    <DbSyncSetup />
  </ClientOnly>
  <AppLayout>
    <Outlet />
  </AppLayout>
</AppProviders>;
```

Do this once when first adding any public path, not per-route — the app
shell services live above the routed `<Outlet />` regardless of which page
is loading.

## Example

```ts
import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  loginHtml: `<!doctype html>
<html>
  <head>
    <title>Sign in — Acme</title>
    <style>/* match this app's palette, type, and voice */</style>
  </head>
  <body>
    <!-- sign-in form -> POST /_agent-native/auth/login -->
    <!-- sign-up form/toggle -> POST /_agent-native/auth/register,
         THEN POST /_agent-native/auth/login with the same credentials —
         register alone does not create a session. -->
    <script>
      // Sign-in: on { ok: true } from /login, location.reload()
      // Sign-up: on { ok: true } from /register, immediately call /login;
      //          only reload once THAT also returns { ok: true }
    </script>
  </body>
</html>`,
});
```
