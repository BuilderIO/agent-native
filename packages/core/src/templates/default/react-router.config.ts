import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "app",
  ssr: true,
  routeDiscovery: { mode: "initial" },

  // Prerendering writes a route's HTML to a static file at build time, so a CDN
  // cache miss serves that file instead of cold-starting the SSR function
  // (seconds of TTFB). It is off here because every route this app ships with is
  // signed-in and personalized, and a prerendered file is served without the
  // auth middleware ever running — freezing the wrong page for every visitor is
  // far worse than a slow first byte.
  //
  // Turn it on only for paths that are all of: publicly reachable, rendered from
  // build-time content alone (no loader data, query string, cookie, session, or
  // database read), and never answering a redirect — prerender would bake a 301
  // into a 200 HTML page. Keep the list in one shared constant and derive the
  // auth plugin's `publicPaths` from it so the two cannot drift:
  //
  //   import { PRERENDERED_PUBLIC_PAGE_PATHS } from "./shared/prerendered-public-paths";
  //   prerender: { paths: () => [...PRERENDERED_PUBLIC_PAGE_PATHS] },
  //
  // See `.agents/skills/performance/SKILL.md` §9.
} satisfies Config;
