/**
 * Page routes whose HTML is decided entirely at build time — no loader, no
 * request, no query string, no session, no database — so React Router can
 * prerender them to static files and a CDN cache miss never cold-starts the
 * SSR function.
 *
 * A prerendered file is served straight from the CDN, which means the auth
 * plugin's middleware never runs for it. `publicPaths` in
 * `server/plugins/auth.ts` spreads this same constant so a path can only become
 * prerenderable by first being public; the two lists cannot drift into an
 * accidental auth bypass.
 *
 * Before adding a path, check all three:
 * - its loader can never `throw redirect()` (prerender freezes a 301 as a 200
 *   HTML page, so `/`, which redirects to `/library`, stays on the function);
 * - it renders nothing derived from the URL's query string (`/bug-report` and
 *   `/bug-report/done` prefill from search params, so they stay dynamic);
 * - it reads no per-viewer data on the server (`/share/:id`, `/r/:id`,
 *   `/embed/:id` are public but database-backed).
 */
export const PRERENDERED_PUBLIC_PAGE_PATHS = ["/download"] as const;
