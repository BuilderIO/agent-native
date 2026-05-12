---
name: server-plugins
description: >-
  Framework server plugins and the `/_agent-native/` route namespace. Use when
  adding a custom server plugin, deciding whether to create an `/api/` route vs
  an action, or debugging auto-mounted framework routes.
---

# Server Plugins & Framework Routes

## Default Plugins (auto-mount)

Five default plugins auto-mount when your app doesn't have a custom version in `server/plugins/`:

| Plugin        | Default behavior                                  | Customize when                              |
| ------------- | ------------------------------------------------- | ------------------------------------------- |
| `agent-chat`  | Agent chat endpoints                              | Custom `mentionProviders` or `systemPrompt` |
| `auth`        | Auth middleware                                   | Custom `publicPaths` or Google OAuth config |
| `core-routes` | `/_agent-native/poll`, `/_agent-native/ping`, etc | Custom `envKeys` or `sseRoute`              |
| `resources`   | Resource CRUD                                     | Rarely                                      |
| `terminal`    | Terminal emulator                                 | Rarely                                      |

**Only create plugin files for plugins you need to customize.** Let defaults auto-mount.

## Framework Route Namespace: `/_agent-native/`

All framework-level routes live under `/_agent-native/` to avoid collisions with template-specific `/api/*` routes.

### Hard rule

- **ALL framework routes go under `/_agent-native/`.**
- Templates own `/api/*` for their domain routes.
- Never put framework routes under `/api/`.
- Never put template routes under `/_agent-native/` — that namespace is reserved.

### Auto-mounted framework routes

| Route                                                         | Purpose                                  |
| ------------------------------------------------------------- | ---------------------------------------- |
| `GET /_agent-native/poll`                                     | Polling endpoint for DB change detection |
| `GET /_agent-native/events`                                   | SSE endpoint for real-time sync          |
| `GET /_agent-native/ping`                                     | Health check                             |
| `GET/PUT/DELETE /_agent-native/application-state/:key`        | Application state CRUD                   |
| `GET/PUT/DELETE /_agent-native/application-state/compose/:id` | Compose draft CRUD                       |
| `POST /_agent-native/agent-chat`                              | Agent chat SSE endpoint                  |
| `GET /_agent-native/agent-chat/mentions`                      | Mention search for @-tagging             |
| `GET /_agent-native/env-status`                               | Env key configuration status             |
| `POST /_agent-native/env-vars`                                | Save env vars                            |
| `/_agent-native/auth/*`                                       | Authentication (login, session, logout)  |
| `/_agent-native/google/*`                                     | Google OAuth (callback, auth-url, etc.)  |
| `/_agent-native/resources/*`                                  | Resource CRUD                            |
| `/_agent-native/actions/:name`                                | Auto-mounted action endpoints            |
| `/_agent-native/available-clis`                               | Available CLI tools                      |
| `/_agent-native/agent-terminal-info`                          | Terminal connection info                 |
| `/_agent-native/collab/*`                                     | Real-time collaboration (see `real-time-collab`) |
| `/_agent-native/a2a`                                          | A2A JSON-RPC endpoint (see `a2a-protocol`) |

## Actions-First Approach

For standard CRUD and data operations, use `defineAction` in `actions/` — the framework auto-mounts them as HTTP endpoints at `/_agent-native/actions/:name`. Only create custom `/api/*` routes for things actions can't do:

- File uploads with multipart form data
- Streaming responses
- Webhooks from external services
- OAuth callbacks

The Nitro Vite plugin handles both `/api/` and `/_agent-native/` prefixes via file-based routing in `server/routes/`.

## Related Skills

- `actions` — Prefer actions over custom `/api/` routes
- `authentication` — Auth middleware and session handling
- `portability` — Use H3 (not Express) for all routes
