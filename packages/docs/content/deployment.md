---
title: "Deployment"
description: "Deploy agent-native apps to any platform with Nitro presets — Node.js, Vercel, Netlify, Cloudflare, AWS, and more."
---

# Deployment

Agent-native apps use [Nitro](https://nitro.build) under the hood, which means you can deploy to any platform with zero config changes — just set a preset.

## How It Works {#how-it-works}

When you run `agent-native build`, Nitro builds both the client SPA and the server API into `.output/`:

```text
.output/
  public/          # Built SPA (static assets)
  server/
    index.mjs      # Server entry point
    chunks/         # Server code chunks
```

The output is self-contained — copy `.output/` to any environment and run it.

## Setting the Preset {#setting-the-preset}

By default, Nitro builds for Node.js. To target a different platform, set the preset in your `vite.config.ts`:

```ts
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  nitro: {
    preset: "vercel",
  },
});
```

Or use the `NITRO_PRESET` environment variable at build time:

```bash
NITRO_PRESET=netlify agent-native build
```

## Node.js (Default) {#nodejs}

The default preset. Build and run:

```bash
agent-native build
node .output/server/index.mjs
```

Set `PORT` to configure the listen port (default: `3000`).

### Docker {#docker}

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/.output .output
COPY --from=build /app/data data
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

## Vercel {#vercel}

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "vercel" },
});
```

Deploy via the Vercel CLI or git push:

```bash
vercel deploy
```

## Netlify {#netlify}

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "netlify" },
});
```

Deploy via the Netlify CLI or git push:

```bash
netlify deploy --prod
```

## Cloudflare Pages {#cloudflare-pages}

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "cloudflare_pages" },
});
```

## AWS Lambda {#aws-lambda}

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "aws_lambda" },
});
```

## Deno Deploy {#deno-deploy}

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "deno_deploy" },
});
```

## Environment Variables {#environment-variables}

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (Node.js only) |
| `NITRO_PRESET` | Override build preset at build time |
| `ACCESS_TOKEN` | Enable auth gating for production mode |
| `ANTHROPIC_API_KEY` | API key for embedded production agent |
| `FILE_SYNC_ENABLED` | Enable file sync for multi-instance |

## File Sync in Production {#file-sync}

By default, agent-native apps store state in local files. For multi-instance deployments (e.g., serverless or load-balanced), enable file sync to keep instances in sync:

```bash
FILE_SYNC_ENABLED=true
```

See [File Sync](/docs/file-sync) for adapter configuration (Firestore, Supabase, Convex).
