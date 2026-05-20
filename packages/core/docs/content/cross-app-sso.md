---
title: "Cross-App SSO"
description: "Sign in once across every hosted agent-native app via identity federation with Dispatch as the identity authority — opt-in per app, reversible with a single env var."
---

# Cross-App SSO

Each hosted app at `*.agent-native.com` runs its own deployment with its **own separate user store**. `mail.agent-native.com` and `calendar.agent-native.com` do not share a database, a session table, or a cookie domain. So "sign in once, use every app" cannot be a shared cookie — it has to be **identity federation**, with [Dispatch](/docs/dispatch) acting as the identity authority for the workspace.

This is the same trust primitive [A2A](/docs/a2a-protocol) and [External Agents](/docs/external-agents) already use — an `A2A_SECRET`-signed JWT verified at the request boundary — applied to the human sign-in path instead of agent-to-agent calls.

## What & why {#what-why}

Per-app user stores mean there is no single place a browser cookie could live that every app trusts. The federation model instead names one app — **Dispatch** — as the identity authority. Any other app can delegate "who is this person?" to Dispatch, get back a short-lived signed assertion of the user's verified email, and then **link that to its own local account by email**.

The linking rule is deliberately narrow and additive:

- **Existing same-email user → linked.** The local account is matched by verified email and reused as-is. It is **never modified, renamed, or deleted** — the federation layer only ever reads it and mints a session for it.
- **New email → created.** A fresh local account is created for that verified email, then a normal local session is minted.

This makes the rollout safe even though it logs people out. **Logout is expected.** When an app turns this on, existing sessions end and users re-authenticate through Dispatch. But they always log back into the **same email-matched account, with all their data intact**, because identity rows are only ever _added to_ — never destroyed, renamed, or repointed. There is no migration, no table rename, no destructive write anywhere in this path. (See the auth invariants in [Authentication](/docs/authentication) and [Security & Data Scoping](/docs/security).)

## How it works {#how-it-works}

The flow is a standard authorize → signed-token → callback redirect, with email as the only thing that crosses the trust boundary.

1. **App → Dispatch (authorize).** The app sends the user to the identity authority:

   ```
   GET https://dispatch.agent-native.com/_agent-native/identity/authorize
       ?app=<requesting-app>
       &redirect_uri=<app-callback-url>
       &state=<csrf-state>
   ```

2. **Dispatch authenticates the human.** If the user already has a Dispatch session, this is transparent. If not, Dispatch shows its own normal login (email/password, Google, etc. — see [Authentication](/docs/authentication)). Dispatch is just a regular agent-native app here; it is not running a special auth mode.

3. **Dispatch → App (signed identity token).** Dispatch validates `redirect_uri` against a **strict allowlist** (`*.agent-native.com` plus localhost — nothing else) and 302-redirects back to the app's `redirect_uri` carrying a short-lived **`A2A_SECRET`-signed identity JWT**. The token's claims are intentionally minimal:

   | Claim        | Meaning                                                  |
   | ------------ | -------------------------------------------------------- |
   | `sub`        | Stable user id at the identity authority                 |
   | `email`      | The user's **verified** email — the only join key        |
   | `name`       | Display name (non-authoritative, for UI only)            |
   | `org_domain` | Workspace/org domain, when present                       |
   | `scope`      | Always `"identity"` — this token authorizes sign-in only |
   | `exp`        | **≤ 5 minutes** from issue                               |

4. **App verifies and JIT-links by email.** The app verifies the token signature with its own `A2A_SECRET`, checks `scope: "identity"` and `exp`, then performs **just-in-time linking strictly by verified email**:
   - If a local user with that email exists → reuse it unchanged.
   - If not → create a local user for that email.

5. **App mints a normal local session.** From here on the user has an ordinary local session in that app's own store — every existing access check, org scoping, and action guard works exactly as before. The federation only happened at the front door.

### Opting in {#opt-in}

An app participates **only** when this environment variable is set on its deployment:

```bash
AGENT_NATIVE_IDENTITY_HUB_URL=https://dispatch.agent-native.com
```

- **Set** → the app shows a **"Sign in with Agent-Native"** option that runs the flow above. Direct local login (email/password, Google) still works alongside it.
- **Unset (default)** → **zero behavior change.** The app authenticates exactly as it did before; the federation code path is dormant. There is no schema change and nothing to migrate, so flipping the variable on or off is fully reversible at any time.

## Security {#security}

The whole model rests on a few deliberately small guarantees:

- **Short-lived signed token.** The identity assertion is an `A2A_SECRET`-signed JWT with a **≤ 5-minute** expiry and `scope: "identity"`. It authorizes a single sign-in and cannot be replayed for long or repurposed for API/A2A access. Verification runs at the request boundary before any session is minted — same boundary discipline as [A2A auth](/docs/a2a-protocol#auth-policy).
- **Strict `redirect_uri` allowlist.** Dispatch only ever redirects to `*.agent-native.com` or localhost. Arbitrary, scheme-relative (`//host`), and cross-origin redirect targets are rejected, so the authority can't be turned into an open-redirect or token-exfiltration oracle.
- **Email-only join from a verified token.** The _only_ thing that crosses the trust boundary is the verified email in a signed token. The app does not accept a user id, role, org membership, or any privileged state from the wire — it derives everything locally from the matched account.
- **Additive-only identity writes.** Linking either reuses an existing same-email account untouched or inserts a new one. No update, rename, repoint, or delete of identity rows ever happens on this path — consistent with the framework's "no breaking database changes" rule.
- **Off by default.** With `AGENT_NATIVE_IDENTITY_HUB_URL` unset the entire feature is inert. Enabling or disabling it is one env var on one deploy, with no data side effects.

## Canary rollout runbook {#canary-rollout}

Cutover and rollback are **a single environment variable per app deployment**. Roll out one app at a time, verify, then expand. Do not set the variable on every app at once.

**1. Deploy the code — no behavior change.**
Ship the release to every app with `AGENT_NATIVE_IDENTITY_HUB_URL` **unset everywhere**. Because the feature is off by default, this deploy is a no-op for users: every app keeps authenticating exactly as before. Confirm normal logins still work on a couple of apps.

**2. Enable the canary on ONE app (mail) only.**
Set, on the **mail** deployment only:

```bash
AGENT_NATIVE_IDENTITY_HUB_URL=https://dispatch.agent-native.com
```

Leave every other app's environment unset. Redeploy/restart mail so it picks up the variable.

**3. Verify the canary (checklist).**
On mail, walk the full loop:

- Log **out** of mail.
- The login screen now shows **"Sign in with Agent-Native"**. Click it.
- You are taken to **Dispatch** and complete its login (or pass straight through if already signed in there).
- You are redirected **back to mail, logged in** — and it is the **same pre-existing account** (same email) you had before, not a new one.
- **Mail data is intact** — your existing mailboxes, drafts, settings, and org scoping are all exactly as they were.
- **Existing direct logins still work** — email/password and Google sign-in on mail continue to function for users who don't use the SSO button.

If any check fails, go straight to step 5 (rollback) — it is instant and data-safe.

**4. Expand app-by-app.**
Once mail is verified, repeat steps 2–3 for the next app, then the next — setting `AGENT_NATIVE_IDENTITY_HUB_URL` on one deployment at a time and running the same checklist after each. Never batch-enable.

**5. Rollback = unset the env var on that app's deploy.**
To revert any app, **remove `AGENT_NATIVE_IDENTITY_HUB_URL` from that app's environment and redeploy/restart it.** The app immediately returns to its prior auth behavior. There is **no data change to undo** — identity rows were only ever added, and unsetting the variable simply makes the federation path dormant again. Each app's cutover and rollback are independent and reversible.

> The rollout logs users out as each app is enabled (they re-auth via Dispatch), but they always log back into the **same email-matched account with data intact**, because identity rows are never destroyed or renamed — only added.

## Related {#related}

- [Authentication](/docs/authentication) — local auth modes, sessions, orgs, the `A2A_SECRET` env var.
- [A2A Protocol](/docs/a2a-protocol) — the signed-JWT, verify-at-the-boundary trust model this reuses.
- [External Agents](/docs/external-agents) — the same `A2A_SECRET`-signed identity pattern applied to agent connections and deep links.
- [Dispatch](/docs/dispatch) — the workspace identity authority and routing hub.
- [Security & Data Scoping](/docs/security) — additive-only data writes and per-account scoping.
