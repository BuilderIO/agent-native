---
title: "Agent Web Surfaces"
description: "Make public routes crawlable, readable, citable, and optionally callable by agents."
---

# Agent Web Surfaces

Agent Web surfaces make public Agent-Native routes easy for agents to crawl, read, cite, and call. The goal is not to make every app endpoint public. The goal is to publish a clean public surface for pages that are already public, while keeping private data and tool access behind explicit controls.

The docs site is the reference implementation. Today it ships:

- `/robots.txt` with a crawler policy that allows retrieval but disallows training by default.
- `/sitemap.xml` with absolute canonical URLs and `lastmod` when the source file exposes it.
- `/llms.txt` and `/llms-full.txt` for agent-friendly content discovery.
- Markdown mirrors such as `/docs/getting-started.md`.
- `Accept: text/markdown` responses for public docs pages after a production build.
- JSON-LD for base organization, website, and page metadata.
- An audit CLI (`agent-native audit-agent-web`) that checks all of the above.

Setting `publicMcp: true` additionally exposes opted-in actions as a public MCP endpoint, allowing external agents to call them directly (see [MCP Protocol](/docs/mcp-protocol)).

## Configuration {#config}

Add `agentWeb` under the existing workspace app config (in your app's `package.json` under the `agent-native` key — or equivalently `workspace.agentWeb`, `agentWeb`, or `root.agentWeb`). The public route list is still derived from the app's route access settings; `agentWeb` controls how that public surface is represented to agents.

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin/*"],
      "agentWeb": {
        "discoverable": true,
        "markdownTwins": true,
        "llmsTxt": true,
        "jsonLd": true,
        "publicAgentCard": true,
        "publicMcp": false,
        "crawlerPolicy": "discoverable-no-training",
        "crawlers": {
          "training": "disallow",
          "search": "allow",
          "userTriggered": "allow",
          "codingAgents": "allow",
          "autonomousAgents": "allow"
        }
      }
    }
  }
}
```

For most apps, leave the defaults alone. If an app has any public route, `discoverable` defaults on. The default crawler policy is "discoverable, not trainable": search, user-triggered retrieval, coding agents, and autonomous browsing agents are allowed; training crawlers are disallowed.

## Route source of truth {#route-source}

Agent Web discovery follows the route access model:

- Public apps expose every route except `protectedPaths`.
- Internal apps expose only `publicPaths`.
- Public share and form pages can be readable by agents.
- Submitted private data, authenticated dashboards, and user/org state are never included just because a nearby page is public.

This keeps mixed apps natural. A forms app can expose a public form page and keep submissions private. A content app can expose published posts and keep the editor private. A docs site can expose everything except admin tools.

## Public pages are not public tools {#public-tools}

Public page access and public tool access are separate. A route being public only means agents can read that route as HTML, Markdown, sitemap entries, llms entries, and structured data.

To expose an action through a public agent protocol, the action must opt in:

```ts
export default defineAction({
  description: "Search published docs",
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    isConsequential: false,
    title: "Search published docs",
  },
  run: async (args) => {
    // ...
  },
});
```

`agentWeb.publicMcp` stays `false` by default. When public MCP is enabled, the server should expose only actions with `publicAgent.expose === true`, and should still exclude consequential or write actions unless the action and auth policy explicitly allow them.

## Build-time files {#build-time}

Framework utilities in `@agent-native/core/agent-web` generate the common files from one page list:

```ts
import {
  buildAgentWebStaticFiles,
  normalizeAgentWebConfig,
} from "@agent-native/core/agent-web";

const config = normalizeAgentWebConfig(
  { crawlerPolicy: "discoverable-no-training" },
  { hasPublicRoutes: true },
);

const files = buildAgentWebStaticFiles({
  siteName: "My Agent-Native App",
  siteUrl: "https://example.com",
  description: "Public docs for my app.",
  config,
  pages: [
    {
      path: "/docs",
      title: "Docs",
      description: "Start here.",
      markdown: "# Docs\n\nStart here.\n",
      markdownPath: "/docs/getting-started.md",
      lastmod: new Date(),
    },
  ],
});
```

Vite apps can use `createAgentWebVitePlugin` from `@agent-native/core/vite` to write those files into `public`, `dist`, `dist/client`, `dist/server/public`, or `build/client` during production builds.

## Audit a site {#audit}

Use the CLI audit against a deployed site or a local production server:

```bash
agent-native audit-agent-web --url https://www.agent-native.com
```

The audit checks for:

- SSR-visible HTML.
- Canonical URLs.
- JSON-LD.
- `robots.txt` policy and absolute sitemap URL.
- Absolute sitemap entries.
- `/llms.txt` and `/llms-full.txt`.
- Markdown mirrors.
- `Accept: text/markdown`.
- No accidental 401/403 blocks for common agent retrieval user agents.

The audit exits non-zero if a required public surface is missing.

## What's next

- [**Actions**](/docs/actions) — how to opt actions into the public agent protocol
- [**MCP Protocol**](/docs/mcp-protocol) — the MCP surface that `publicMcp: true` enables
- [**Deployment**](/docs/deployment) — where these static files are written during builds
