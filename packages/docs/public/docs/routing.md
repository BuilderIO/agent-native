# Routing

Agent-native apps use **React Router v7 framework mode** with file-based routing. Pages are auto-discovered from `app/routes/` via `flatRoutes()`.

## Architecture: SSR Shell + Client Rendering

Even though SSR is enabled, **virtually every route renders only an SSR shell** (loading spinner, optional meta tags). All real data fetching and rendering happens on the client via React Query hooks.

```
Server renders:  <html> + <head> + <body> + layout + loading spinner
Client hydrates: fetches data from /api/*, renders actual content
```

This gives you:

- Fast initial paint (SSR shell)
- SEO basics (title, meta tags)
- Full client interactivity (all data via React Query + API routes)
- The **option** to SSR any page when justified (just add a server `loader`)

## Key Files

```
react-router.config.ts    # Framework config (ssr: true, appDirectory)
app/
  routes.ts               # Route discovery — flatRoutes()
  root.tsx                # HTML shell + global providers
  entry.client.tsx        # Client hydration entry
  routes/                 # File-based page routes (auto-discovered)
    _index.tsx            # /
    settings.tsx          # /settings
    $id.tsx               # /:id (dynamic param)
server/
  routes/
    api/                  # API routes (Nitro, unchanged)
    [...page].get.ts      # SSR catch-all (delegates to React Router)
```

## Adding a Page

Create a file in `app/routes/`. The filename determines the URL path:

```
app/routes/
  _index.tsx              → /
  about.tsx               → /about
  settings.tsx            → /settings
  inbox.tsx               → /inbox
  inbox.$threadId.tsx     → /inbox/:threadId
  book.$slug.tsx          → /book/:slug
  deck.$id.present.tsx    → /deck/:id/present
```

### Naming Rules (flatRoutes)

| Pattern                | URL                 | Example         |
| ---------------------- | ------------------- | --------------- |
| `_index.tsx`           | `/`                 | Home page       |
| `about.tsx`            | `/about`            | Static segment  |
| `$id.tsx`              | `/:id`              | Dynamic param   |
| `$view.$threadId.tsx`  | `/:view/:threadId`  | Multiple params |
| `deck.$id.present.tsx` | `/deck/:id/present` | Mixed segments  |
| `$.tsx`                | `/*`                | Catch-all/splat |

## Route Module Format

### Default Pattern: SSR Shell + Client Rendering (95% of routes)

This is the standard for virtually every route. No server data fetching:

```tsx
// app/routes/settings.tsx
import Settings from "@/pages/Settings";

export function meta() {
  return [{ title: "Settings — My App" }];
}

// SSR renders this while JS loads
export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

// Client renders this after hydration.
// Data fetching happens inside via React Query hooks.
export default function SettingsRoute() {
  return <Settings />;
}
```

What happens:

1. **Server** renders `<HydrateFallback>` → user sees loading spinner instantly
2. **Client** hydrates → mounts the real component → React Query hooks fetch from `/api/*`
3. **Result:** Fast shell, all real content loaded client-side

### Exception Pattern: Server-Rendered Route (5% of routes)

Only use when a page genuinely needs server-side data for SEO or og tags:

```tsx
// app/routes/book.$slug.tsx — public page needing og tags
import type { Route } from "./+types/book.$slug";

export async function loader({ params }: Route.LoaderArgs) {
  const booking = await getBookingPage(params.slug);
  return { booking };
}

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: `Book with ${data.booking.name}` },
    { property: "og:title", content: `Book with ${data.booking.name}` },
  ];
}

export default function BookingPage({ loaderData }: Route.ComponentProps) {
  return <BookingForm booking={loaderData.booking} />;
}
```

### When to Use Which Pattern

| Pattern                  | When to use                            | Server does                           | Client does                  |
| ------------------------ | -------------------------------------- | ------------------------------------- | ---------------------------- |
| **SSR shell (default)**  | App pages, dashboards, logged-in views | Renders loading spinner + static meta | Fetches data via React Query |
| **Server loader (rare)** | Public pages needing SEO/og tags       | Fetches data, renders full HTML       | Hydrates                     |

**Rule of thumb:** If the page is behind auth or doesn't need search engine indexing, use the default SSR shell pattern.

## Route Module Exports

| Export              | Purpose                                               |
| ------------------- | ----------------------------------------------------- |
| `default`           | The page component (required)                         |
| `meta()`            | Page title, meta tags, og tags                        |
| `HydrateFallback()` | Loading UI shown during SSR before hydration          |
| `loader()`          | Server-side data fetching (rare — only for SEO pages) |
| `clientLoader()`    | Client-side data fetching before render               |
| `action()`          | Server-side form handling                             |
| `ErrorBoundary`     | Route-level error UI                                  |

## Root Module (`app/root.tsx`)

The root module replaces `index.html`. It contains the HTML shell and global providers:

```tsx
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import "./global.css";

// HTML shell — wraps root component, error boundary, and hydrate fallback
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// App providers + layout
export default function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
```

## Vite Configuration

Enable React Router framework mode in `vite.config.ts`:

```ts
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  reactRouter: true,
});
```

## React Router + Nitro Coexistence

Both React Router and Nitro run in the same Vite config:

| Concern     | React Router               | Nitro                               |
| ----------- | -------------------------- | ----------------------------------- |
| Page routes | `app/routes/`              | N/A                                 |
| API routes  | N/A                        | `server/routes/api/`                |
| SSR         | HTML shell + hydration     | Catch-all delegates to React Router |
| Build       | Client bundles + SSR entry | API routes + plugins                |

## Build Commands

```bash
pnpm dev        # Vite dev server (both plugins)
pnpm build      # react-router build (client + SSR + Nitro)
pnpm start      # node .output/server/index.mjs
pnpm typecheck  # react-router typegen && tsc --noEmit
```

## Type-Safe Route Params

React Router generates types in `.react-router/types/`. Import them in route modules:

```tsx
import type { Route } from "./+types/settings";

export default function Settings({ params }: Route.ComponentProps) {
  // params is typed based on the filename
}
```

Run `pnpm typecheck` to generate types (runs `react-router typegen` first).

## Deploy Anywhere

The SSR catch-all uses web-standard `Request`/`Response` — no Node.js dependency. Works on Cloudflare Workers, Deno, Vercel Edge, and any runtime that supports web standards. Set the Nitro preset in `vite.config.ts`:

```ts
export default defineConfig({
  reactRouter: true,
  nitro: { preset: "cloudflare_pages" },
});
```
