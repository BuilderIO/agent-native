# Authentication

Agent-native provides a zero-config authentication system that is invisible in development and automatic in production.

## How It Works

```
Development                    Production                     Custom Auth
─────────────                  ──────────                     ───────────
No auth middleware             Auth middleware auto-mounts     Plug in Auth.js, Clerk, etc.
All requests pass through      Login page for visitors        Same getSession() contract
getSession() → local@localhost One env var to enable           Templates don't change
```

### Development Mode

In development (`NODE_ENV !== "production"`), auth is completely bypassed:

- No login page, no middleware, no cookies
- `getSession()` always returns `{ email: "local@localhost" }`
- `useSession()` hook returns the same dev stub
- Zero friction, zero config

### Production Mode

When you deploy, set one environment variable and auth activates automatically:

```bash
ACCESS_TOKEN=your-secret-token
```

That's it. Every route is now protected. Unauthenticated visitors see a login page. The framework handles cookies, session management, and expiry.

For small teams, use comma-separated tokens:

```bash
ACCESS_TOKENS=alice-token,bob-token,charlie-token
```

### Production Without Auth

If your app is behind infrastructure-level auth (Cloudflare Access, VPN, etc.), explicitly disable framework auth:

```bash
AUTH_DISABLED=true
```

Without either `ACCESS_TOKEN` or `AUTH_DISABLED`, the server **refuses to start in production** to prevent accidental exposure.

## The Auth Contract

All templates code against two interfaces — they never read cookies directly.

### Server: `getSession(event)`

```ts
import { getSession } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  // session: { email, userId?, token? } or null
});
```

### Client: `useSession()`

```ts
import { useSession } from "@agent-native/core";

function MyComponent() {
  const { session, isLoading } = useSession();
  // session.email, session.userId, etc.
}
```

### API Endpoint: `GET /api/auth/session`

Returns the current session as JSON, or `{ error: "Not authenticated" }`.

## How It's Wired

Each template includes a Nitro plugin at `server/plugins/auth.ts`:

```ts
import { defineNitroPlugin, autoMountAuth } from "@agent-native/core";

export default defineNitroPlugin((nitroApp: any) => {
  autoMountAuth(nitroApp.h3App);
});
```

This runs at server startup and configures auth based on the environment automatically.

## Session Storage

Sessions are stored in `data/.sessions.json` (file-backed, consistent with the files-as-database principle). This file is:

- Gitignored in all templates
- Excluded from file sync
- Pruned on startup (expired sessions are removed)
- Default session lifetime: 30 days

## Bring Your Own Auth

For apps that outgrow single-token auth (multi-user, OAuth, roles), the framework provides an upgrade path through the `AuthOptions.getSession` hook:

```ts
import { defineNitroPlugin, autoMountAuth } from "@agent-native/core";

export default defineNitroPlugin((nitroApp: any) => {
  autoMountAuth(nitroApp.h3App, {
    getSession: async (event) => {
      // Your custom auth logic here — Auth.js, Clerk, Lucia, etc.
      // Return { email, userId?, token? } or null
      const session = await myAuthLib.getSession(event);
      return session ? { email: session.user.email } : null;
    },
  });
});
```

The framework doesn't ship Auth.js, Clerk, or any specific auth library. Instead, the `getSession` contract makes any auth system pluggable without changing templates or application code.

### Why Not Ship Auth.js in Core

- No official Nitro/H3 adapter — maintaining a custom bridge would be a permanent burden
- OAuth, account linking, and email verification are overkill for most agent-native apps
- Alternatives (Clerk, Lucia, WorkOS) exist — the framework shouldn't pick winners
- The auth contract makes any of them pluggable

## Configuration Reference

### Environment Variables

| Variable        | Description                                |
| --------------- | ------------------------------------------ |
| `ACCESS_TOKEN`  | Single access token for production auth    |
| `ACCESS_TOKENS` | Comma-separated tokens for team access     |
| `AUTH_DISABLED` | Set to `"true"` to skip auth in production |

### `AuthOptions`

```ts
autoMountAuth(app, {
  maxAge: 60 * 60 * 24 * 30, // Session lifetime in seconds (default: 30 days)
  sessionsPath: "data/.sessions.json", // Path to session store (default)
  getSession: async (event) => {}, // Custom auth (BYOA)
});
```

### Routes

| Route               | Method | Description                        |
| ------------------- | ------ | ---------------------------------- |
| `/api/auth/login`   | POST   | Validate token, set session cookie |
| `/api/auth/logout`  | POST   | Clear session cookie               |
| `/api/auth/session` | GET    | Get current session                |

## Security

- **Cookies**: HttpOnly, Secure (production), SameSite=Lax
- **Session tokens**: Cryptographically random (32 bytes)
- **CSRF**: Baseline protection via SameSite=Lax
- **Session file**: Gitignored, excluded from sync, pruned on startup
