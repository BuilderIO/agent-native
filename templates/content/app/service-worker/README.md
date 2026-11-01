# App-shell service worker

Content's production web app registers `/sw.js`, a service worker that keeps the app's code on the device. A reload
of a page the browser has opened before draws from that copy instead of waiting on the network for the HTML and
the build's JavaScript and CSS.

## What it keeps

- The HTML shell of the app's own routes (`/page/:id`, `/home`, …), one copy per route and browser language list
  (the two lists used last on each route), since the server renders the shell in the language `Accept-Language`
  asks for. Neither the browser's HTTP cache
  nor Netlify's CDN (which varies this HTML by query only) keeps a copy per language, so right after a browser's
  language changes the network can still answer in the old one, and the worker keeps what it was given until the
  next navigation brings the right one. The server renders that HTML for
  anonymous visitors only, with `Cache-Control: public` (the `guard:ssr-cache-shell` check keeps it that way), so
  the copy holds no account data. The worker also refuses any HTML marked `private`, `no-store` or `no-cache`, or
  varying on cookies, and fetches the copy it keeps without cookies. When the server starts answering a route that
  way (SSR caching turned off, say), the worker deletes that route's kept shells, and no download that started
  before that answer can bring one back.
- The build's hashed files under `/assets/`: every file the shell boots (the React Router manifest, the client
  entry, every route module), cached before that build's shell is used, then, once a page has loaded, the rest of
  the current build, lazy chunks included. Chrome answers `/assets/*` straight from this cache without running the
  worker, so a file the worker didn't download itself is never kept. A file that comes back as HTML, or with a
  content type that doesn't fit its extension (a host's catch-all route answering a missing file), is never kept,
  and a build with a boot file that comes back that way never becomes current.
- Files of the current build, the one before it, and the build of every open tab: each tab reports its build when
  it loads and when it's shown again, and keeps that build's files until it closes (or, if the browser can't list
  its open tabs, for a day after its last report). Only the current and previous builds keep shells to answer
  navigations with.

The worker downloads at most two build files at a time, at low priority, behind the app's own requests. Only the
current build downloads the rest of its files: a new build's boot files stop it, and it starts again on the next
page load.
Under `Save-Data` (the navigation's header or `navigator.connection.saveData`) the worker downloads only boot files,
so lazy chunks load from the network as they would without it.

It never keeps `/_agent-native/*` responses (API, auth, collaboration) or anything that isn't a GET. Page data
stays in the app's own IndexedDB cache, which is scoped by signed-in user.

## Deploys

A navigation gets the current build's cached shell at once, and the worker checks the network copy behind it.
When that copy names a new build, the worker asks the server again past the browser's HTTP cache (which can keep
the old build's HTML for its `max-age`), downloads the new build's boot files in the background, then makes it
current: the next navigation runs the new build, and an open tab never switches mid-session. A rollback switches
back the same way.

Changes to which builds are kept run one at a time. A build becomes current only after a last check that its
boot files are all cached, and never on an answer older than the one that made the current build current, so a
slow download can't overtake a newer deploy. Files a download is still storing are left alone, and whatever a
failed download stored that no kept build lists is deleted.

A kept shell answers first only as long as the server's `Cache-Control` lets a browser reuse that HTML (`max-age`
plus `stale-while-revalidate`, today 10 minutes plus 7 days), counted from when the server rendered it (its `Age`,
or its `Date` for a copy the browser's HTTP cache kept), so a returning visitor never boots an older build than
their HTTP cache could. Past that the network goes first, and the kept copy answers only offline. If Cache Storage
fails, the network answers, as it would without the worker, and the worker goes on from what Cache Storage last
stored.

If the page finds its build out of date anyway (route chunk recovery, `__agent-native-chunk-recovery`), the worker stops serving
that build and the navigation goes to the network. Offline, that navigation gets the page's kept shell instead of
the browser's error page; recovery's 10-second cooldown stops a second reload if a file is still missing. Only a
marked navigation to one of the current build's app routes counts: on a public page, an unknown path or a
framework endpoint the marker changes nothing.

## Where it runs

Only production web builds, at the origin root, over HTTPS, outside loopback hosts, as a top-level page on one of
the app's routes. The desktop app, embeds, workspace mounts and public pages (shared `/p/…` links) never register
it.

Its scope is still the whole origin, and it takes over open tabs when it activates, so once installed it also
controls public pages and frames on the origin. Their HTML always comes from the network; their `/assets/*` requests
follow the same rules as the app's, which hand out the same hashed files.

## Turning it off

Build and deploy with `VITE_CONTENT_SERVICE_WORKER=off`. That build ships a `/sw.js` that deletes the worker's
caches and unregisters itself, and its pages remove any registration they find. Browsers fetch `/sw.js` fresh on
navigation (`updateViaCache: "none"`, and `netlify.toml` keeps every CDN from storing it), so open browsers drop
the worker on their next page load. Keep the variable set until the worker should come back.

A deploy that ships no `/sw.js` at all (a rollback to a build from before the worker) also removes it: the worker
asks whether `/sw.js` still exists, at most hourly and only while it's handling a navigation, and removes itself
on a 404, or on HTML where a host's catch-all route renders unknown paths. A page the worker served doesn't
register it again (the browser checks `/sw.js` on every navigation anyway), since in Chrome registering would bring
back a worker that has just removed itself.

## Files

- `shell-worker-core.ts`: the worker's logic, against a small environment so specs drive it without a browser.
- `shell-worker.ts`, `cleanup-worker.ts`: the two worker scripts the build bundles into `/sw.js`.
- `register-shell-worker.ts`: registration from `entry.client.tsx`, and the off switch's page half.
- `vite-plugin.ts`: writes `/sw.js` and `/assets/sw-build-<version>.json` (the build's boot files and routes) after
  the client build.
