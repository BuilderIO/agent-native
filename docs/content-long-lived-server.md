# Content on a long-lived Node server

Content deploys to Netlify Functions, where each request runs in its own
execution environment. A page load sends dozens of API requests at once, so
right after a deploy several of them start fresh environments and wait seconds
for one. A long-lived server answers all of them from instances that are
already running. This page is how to build and run Content that way, for a
pilot on a host with a minimum instance count (such as Cloud Run). Netlify
stays the production host until a pilot shows the change is worth it.

## Build and run

Nitro's `node-server` preset (also the default, `node`) builds a server that
listens on `PORT`:

```bash
NITRO_PRESET=node-server pnpm --filter content build
node templates/content/.output/server/index.mjs
```

`.output/` runs without the repository: the build copies the packages Nitro
leaves external into `.output/server/node_modules`. The container image does
the same build from the repository root:

```bash
docker build -f templates/content/Dockerfile \
  --build-arg AGENT_NATIVE_BUILD_SHA="$(git rev-parse HEAD)" \
  -t content-node-server .
```

## Environment

| Variable                                           | Value                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                     | The pooled Postgres URL. Migrations stay a release step: run `pnpm --filter content migrate:production` against the direct URL before the new image takes traffic. |
| `AGENT_NATIVE_RELEASE_MIGRATIONS`                  | `1`, so requests never probe or run migrations.                                                                                                                    |
| `AGENT_NATIVE_DB_POOL_MAX`                         | Connections per instance (default 20 off serverless). Instances × this must fit the database's pooler.                                                             |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_URL` | As on Netlify; `BETTER_AUTH_URL` and `APP_URL` are the public origin the browser uses.                                                                             |
| `AGENT_NATIVE_DISABLE_RECURRING_JOBS`              | `1` when another deployment already runs recurring jobs against the same database, so they don't run twice.                                                        |
| `COOKIE_DOMAIN`, `CORS_ALLOWED_ORIGINS`            | Only when the API is served from a different origin than the pages.                                                                                                |

## What changes off Netlify

- **Live updates use SSE.** On Netlify, `/_agent-native/events` answers `204`
  and the client polls `/_agent-native/poll`. On a long-lived server the stream
  stays open and the client polls far less. Events reach only the streams on
  the instance that handled the write, so with more than one instance a change
  can take until the next fallback poll to reach a client on another instance.
  Run one instance, or pass `disableSSE: true` to `createCoreRoutesPlugin` in
  `templates/content/server/plugins/core-routes.ts` so clients poll (not tried here), until
  events cross instances.
- **Nothing compresses responses.** Netlify's CDN compresses them; Nitro's
  server doesn't. Put a compressing proxy or CDN in front.
- **Shutdown doesn't exit.** On `SIGTERM` the server stops accepting requests,
  but the database pool and timers keep the process alive until the host kills
  it (Cloud Run waits 10 seconds). An open SSE stream also holds the graceful
  close to its 5-second limit.
- **Netlify proxy rewrites time out at 26 seconds**, so a Netlify site that
  proxies to this server would cut SSE streams and long agent responses.
  Serve the pages and API from the server's own origin instead.
