---
"@agent-native/core": patch
---

Emit the `signup` event once per real account creation, and stop emitting it for user rows that are not signups.

Better Auth runs its `user.create.after` hook on every `user` row insert, and the hook treated all of them as a person signing up. Two production paths create rows through `internalAdapter` outside any endpoint, where Better Auth's context — and therefore the request, the browser, and its `an_aid` / `an_ft` cookies — is `null`: `ensureCanonicalUserForLegacySession` (backfilling a canonical row for someone who signed up months ago) and `ensureGoogleAuthIdentity` (provisioning the canonical row during the Google callback). Both emitted an unattributable `signup` recorded as `referral_source: "direct"`, which is why ~94% of `better-auth` signups carried no `anonymous_id` and one person provisioned across sibling apps counted as a dozen acquisitions.

Google sign-in was also losing its real event: because `ensureGoogleAuthIdentity` writes the canonical row _before_ `createOAuthSession` runs, the `hasBetterAuthUserEmail` probe there concluded the person was an existing user and skipped the one emitter that carries the browser's anonymous id. Callers now pass the `isNewUser` answer they already hold, and the event carries the canonical Better Auth user id rather than the Google profile id, so it still joins to `referrer_user` in the virality panels.

- A row insert with no request behind it emits nothing at all.
- Emitted events carry `signup_origin` (`browser_signup` / `google_oauth` / `sso_jit`) so acquisitions are selectable from sibling-app provisioning.
- `referral_source: "direct"` is no longer fabricated when no browser context was present — "we never saw a visitor" and "a visitor arrived with no campaign" are now different values.
- The internal `x-agent-native-signup-attribution` handoff header is stripped from every inbound request instead of only being overwritten on email signup. It is unsigned and outranks the request cookie, so an inbound copy let any client write the `anonymous_id` and campaign onto someone else's signup row.
- The `webhook` tracking provider now sends `anonymousId`, which it silently dropped.

Signup counts will fall to the real number. The removed rows were duplicate and backfilled events, not lost users.
