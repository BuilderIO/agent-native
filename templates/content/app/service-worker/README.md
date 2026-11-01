# App-shell service worker

Content's production web app registers `/sw.js`, a service worker that keeps the app's code on the device. A reload
of a page the browser has opened before draws from that copy instead of waiting on the network for the HTML and
the build's JavaScript and CSS.

## What it keeps

- The HTML shell of the app's own routes (`/page/:id`, `/home`, …), one copy per route. The server renders that
  HTML for anonymous visitors only, with `Cache-Control: public` (the `guard:ssr-cache-shell` check keeps it that
  way), so the copy holds no account data. The worker also refuses any HTML marked `private`, `no-store` or
  `no-cache`, or varying on cookies, and fetches the copy it keeps without cookies.
- The build's hashed files under `/assets/`: every file the shell boots (the React Router manifest, the client
  entry, every route module), cached before that build's shell is used, plus any hashed file the app loads later.
- Files of the two newest builds, so a tab still running the older one can load its route modules after a deploy.

It never keeps `/_agent-native/*` responses (API, auth, collaboration) or anything that isn't a GET. Page data
stays in the app's own IndexedDB cache, which is scoped by signed-in user.

## Deploys

A navigation gets the current build's cached shell at once, and the worker checks the network copy behind it.
When that copy names a new build, the worker asks the server again past the browser's HTTP cache (which can keep
the old build's HTML for its `max-age`), downloads the new build's boot files in the background, then makes it
current: the next navigation runs the new build, and an open tab never switches mid-session. A rollback switches
back the same way.

A kept shell answers first only as long as the server's `Cache-Control` lets a browser reuse that HTML (`max-age`
plus `stale-while-revalidate`, today 10 minutes plus 7 days), so a returning visitor never boots an older build
than their HTTP cache could. Past that the network goes first, and the kept copy answers only offline.

If the page finds
its build out of date anyway (route chunk recovery, `__agent-native-chunk-recovery`), the worker stops serving
that build and the navigation goes to the network. Offline, that navigation gets the page's kept shell instead of
the browser's error page; recovery's 10-second cooldown stops a second reload if a file is still missing.

## Where it runs

Only production web builds, at the origin root, over HTTPS, outside loopback hosts, as a top-level page on one of
the app's routes. The desktop app, embeds, workspace mounts and public pages (shared `/p/…` links) never register
it.

## Turning it off

Build and deploy with `VITE_CONTENT_SERVICE_WORKER=off`. That build ships a `/sw.js` that deletes the worker's
caches and unregisters itself, and its pages remove any registration they find. Browsers fetch `/sw.js` fresh on
navigation (`updateViaCache: "none"`, and `netlify.toml` keeps every CDN from storing it), so open browsers drop
the worker on their next page load. Keep the variable set until the worker should come back.

A deploy that ships no `/sw.js` at all (a rollback to a build from before the worker) also removes it: the worker
asks at most hourly whether `/sw.js` still exists and removes itself on a 404. A page the worker served doesn't
register it again (the browser checks `/sw.js` on every navigation anyway), since in Chrome registering would bring
back a worker that has just removed itself.

## Files

- `shell-worker-core.ts`: the worker's logic, against a small environment so specs drive it without a browser.
- `shell-worker.ts`, `cleanup-worker.ts`: the two worker scripts the build bundles into `/sw.js`.
- `register-shell-worker.ts`: registration from `entry.client.tsx`, and the off switch's page half.
- `vite-plugin.ts`: writes `/sw.js` and `/assets/sw-build-<version>.json` (the build's boot files and routes) after
  the client build.
