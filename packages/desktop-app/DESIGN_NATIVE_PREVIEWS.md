# Native Design previews in the desktop app

Status: Phase A live Interact rendering and the bounded Phase B snapshot
handoff are implemented. This is not yet a general native DOM editing
compositor: semantic Edit still requires the existing inspectable local source
bridge, while native pixels can safely back parent-owned Draw/Comment chrome.

## Decision

Do not replace every Design screen iframe with an Electron `WebContentsView`
as a one-step change.

Use a dual preview backend behind one Design bridge abstraction:

- DOM iframe for inline HTML/Alpine designs and every surface that needs
  arbitrary canvas transforms or DOM editor chrome.
- Native `WebContentsView` for URL-backed authenticated sites that reject
  framing, beginning with a single focused screen in Interact mode.
- A compositor-backed native editing surface (native content view plus a
  transparent native editor-chrome view, or an offscreen texture renderer) is
  required before native previews can be used in Edit, Draw, Comment, or
  transformed overview modes.

The eligibility contract is executable in
`shared/design-preview-placement.ts`. It rejects any native placement that
would change Design's visual or input semantics.

## Why a blanket native view is not production-grade

Electron documents that `WebContentsView` is created, positioned, and sized by
the main process and is not part of the DOM. Positioning it against DOM content
therefore requires explicit main/renderer coordination. Electron `View`
supports rectangular bounds, z-order, visibility, and border radius, but not a
DOM transform matrix or arbitrary clipping. Electron also notes that a rounded
view's cut-out area still captures clicks.

That conflicts with current Design behavior:

1. Overview screens are CSS-transformed by pan/zoom and can be clipped,
   overlapped, or rotated.
2. Edit, Draw, and Comment put DOM hit targets, selection outlines, handles,
   menus, and annotations above the preview.
3. The desktop dev path has three coordinate spaces: shell renderer -> framed
   app webview -> frame's app iframe -> Design preview. Production removes the
   middle frame, so the protocol must handle both paths without guessing.
4. A native child view would otherwise paint above Design panels and swallow
   pointer input that belongs to editor chrome.

This is why a `WebContentsView`-everywhere patch can appear to fix login while
introducing incorrect selection, stale pixels, misplaced views, and clicks
through rounded corners.

## Target architecture

## Implemented Phase A seam

The desktop shell now creates at most one native Design preview per window.
The Design guest reports bounded geometry through a narrow preload API; the
main process supplies the trusted app-webview bounds and independently runs
`resolveDesktopDesignPreviewPlacement()` before showing native content.

- Production Design talks directly to the preload bridge. In framed local
  development, the top-level frame relays only messages from its exact app
  iframe `Window` and configured origin, then offsets child geometry into the
  frame viewport. Nested arbitrary iframes cannot invoke Electron IPC.
- Every app-tab, owner-navigation, host-bounds, screen, URL, mode, visibility,
  or stale-generation change hides or destroys the native child before it can
  paint stale pixels over shell chrome. The DOM iframe remains mounted as the
  seamless fallback and until the native page finishes loading.
- Sessions use
  `persist:design-preview:<sha256(app-id + workspace-id + connection-id)>`.
  Pages in one Design connection therefore share cookies and storage, while
  different designs/connections are isolated. Current URL screens pass their
  persisted `screenMetadata.connectionId`; legacy URL screens without that
  metadata fall back to the URL origin for backward compatibility.
- Remote content must be HTTPS. HTTP is accepted only for loopback local
  editing. Credentials embedded in URLs, popup creation, cross-origin top-level
  navigation, and all permission requests fail closed. Blocked link intent is
  reported back to Design without replacing the editor route.
- The renderer sends a fresh layout heartbeat while eligible. Main accepts
  strictly increasing generations and hides the native view if layout becomes
  stale. A late load cannot resurrect a view after fallback, navigation, owner
  change, or teardown.

Phase A does not attempt OAuth popups, device permissions, arbitrary
cross-origin login redirects, transformed previews, DOM editor overlays, or
multi-screen native composition. Those remain explicit Phase B/C work rather
than partially trusted exceptions.

### Bounded Phase B snapshot handoff

When an eligible authenticated native preview transitions out of Interact,
Desktop keeps its isolated `WebContents` alive and captures one bounded fresh
PNG instead of reloading or copying the page into SQL/source. Capture freezes
CSS motion and running Web Animations temporarily, blocks navigation for the
capture window, and restores both afterward without persisting a mutation.

- The native view stays painted until the Design guest decodes and renders the
  blob-backed image, then acknowledges its version. A two-second fail-closed
  timeout prevents a broken renderer from permanently covering editor UI.
- IPC payloads are limited to PNG, 4096 pixels per edge, 16 megapixels, and
  8 MiB. Only one native view, one snapshot, and one coalesced capture are kept
  per window; hidden handoffs expire after 30 seconds.
- Snapshot identity includes connection, screen, requested URL, viewport,
  generation, and DPR. Navigation, owner, bounds, URL, connection, and native
  Interact changes invalidate it.
- Draw and Comment use the snapshot as the page-pixel layer, with their
  parent-owned overlay chrome at higher stacking levels. Transformed overview
  can reuse that bitmap only for the active screen that previously owned the
  live native view.
- Edit deliberately does **not** put the bitmap above iframe-internal selection
  chrome. When the authenticated local live-edit/source bridge is available,
  the snapshot is only a no-flash handoff layer beneath the real inspectable
  DOM. Without that bridge, Edit fails closed to the existing DOM/error surface
  and does not pretend that screenshot pixels are selectable elements.

Therefore this phase does not provide arbitrary DOM inspection for
`frame-ancestors`/XFO-blocked third-party pages and should not be described as
full native compositor editing. A native editor-chrome sibling or offscreen
DOM/texture backend remains necessary for that claim.

### 1. One bridge, two backends

Design owns a `PreviewSurface` adapter with the same commands and events for
both implementations:

```ts
interface PreviewSurface {
  capabilities: {
    authenticatedTopLevelNavigation: boolean;
    arbitraryTransform: boolean;
    domOverlay: boolean;
  };
  load(url: string): Promise<void>;
  send(command: DesignPreviewCommand): void;
  subscribe(listener: (event: DesignPreviewEvent) => void): () => void;
  setMode(mode: "interact" | "edit" | "draw" | "comment"): void;
  destroy(): void;
}
```

The iframe adapter keeps using `postMessage`. The native adapter sends the
same normalized command/event union through a narrow preload -> main -> owning
Design guest IPC route. Remote page objects and raw Electron APIs never cross
that boundary.

### 2. Main-process manager

Create one `DesktopDesignPreviewManager` per `BrowserWindow`.

- It owns all native preview lifecycles, bounds, visibility, z-order, crash
  recovery, and destruction. Destroy every child `webContents` explicitly when
  its view or window is removed.
- It accepts messages only from the currently registered Design app guest.
  Validate `event.sender.id`, the app id, schema, URL, screen count, and bounds
  before mutating native views.
- Coalesce geometry updates to one update per animation frame and hide a view
  immediately whenever its owner tab, window, or placement becomes stale.
- Re-add an existing child view to move it to the documented topmost z-order;
  never infer z-order from creation time.
- Deny `window.open`, constrain top-level navigation with parsed `URL` origins,
  and surface blocked link intent back to Design instead of navigating away.

### 3. Shared authenticated session

All screens in one explicit Design preview connection use the same persistent
partition:

```txt
persist:design-preview:<sha256(app-id + workspace-id + connection-id)>
```

The partition, not an individual screen URL, owns cookies, cache, storage, and
permission handlers. Logging into one screen therefore makes the same
first-party session available to every other screen in that connection. A
different workspace/connection gets a different partition so credentials do
not leak across projects.

Use `session.fromPartition()` before any view in that partition is created.
Configure both permission request and permission check handlers fail-closed.
Only HTTPS is accepted remotely; HTTP is allowed solely for loopback local
editing. Keep `nodeIntegration: false`, `contextIsolation: true`, `sandbox:
true`, and `webSecurity: true`.

### 4. Geometry handshake

The shell reports the outer app guest rectangle in BrowserWindow content
coordinates. Design reports its preview rectangle and clip rectangle relative
to the app viewport. In framed dev mode, the frame validates the child origin
and adds its app-iframe offset before relaying. The main process composes the
rectangles and runs `resolveDesktopDesignPreviewPlacement()` before calling
`setBounds()`.

Every placement message includes a monotonically increasing layout generation.
The main process ignores older generations and hides views if no fresh layout
arrives after navigation, resize, tab switch, or owner destruction. This avoids
the stale native-surface flashes already seen with hidden Electron guests.

### 5. Editing safety

In non-Interact modes:

- prevent link and form navigation at capture time;
- freeze CSS animations, transitions, smooth scrolling, animated images where
  practical, and the Web Animations API without modifying saved source;
- keep navigation prevention active in the main process as a second boundary;
- preserve the current page/session/scroll state across source updates;
- never reload a native view merely because selection, zoom chrome, or editor
  state changed.

`webContents.insertCSS()` can supply the temporary CSS freeze. The returned key
must be removed when returning to Interact mode or destroying the view. A
dedicated isolated preload can forward safe link/navigation intent, but it must
not expose a general IPC primitive to the remote page.

## Delivery gates

### Phase A - focused Interact mode

- One URL-backed screen, 100% scale, no rotation, no clipping or overlay.
- Shared persistent session proven by logging in once and opening a second
  screen from the same connection.
- Sites with `X-Frame-Options: DENY` and restrictive `frame-ancestors` render.
- Link clicks report intent without losing the Design route.
- Tab switching, sidebar resizing, full screen, maximize/restore, display scale
  changes, and app/window close leave no stale native pixels or live contents.

### Phase B - editing compositor

- Transparent native editor-chrome sibling or offscreen texture backend keeps
  selection, hover, draw, text editing, context menus, and keyboard shortcuts
  above the authenticated page.
- Pointer coordinates round-trip through shell, optional dev frame, Design,
  content scale, and page scroll with <= 1 device-independent-pixel error.
- Editing freezes motion and navigation without mutating persisted app source.

### Phase C - overview and many screens

- Pan/zoom/rotate/clip correctness for at least 25 mixed-size screens.
- Occlusion with left/right panels, popovers, menus, comments, and modal
  dialogs.
- Bounded CPU/GPU/memory under repeated zoom, drag, reload, undo/redo, app
  switching, and sleep/wake; no white/black frame during handoff.
- Offscreen/inactive views are suspended or rendered as cached thumbnails,
  while the shared session remains live.

## Required automated and manual tests

1. Pure placement matrix: focused/overview, 25-400% zoom, rotations,
   partial/full clipping, invalid rectangles, editor modes, occlusion, and
   fractional DIP rounding.
2. IPC security: spoofed sender, unknown screen, stale generation, unsupported
   scheme, cross-workspace partition, oversized bounds/count, destroyed owner,
   and navigation/window-open attempts.
3. Session E2E: two pages on the same origin, subdomain/SameSite cases, OAuth
   popup/callback, logout, and a second isolated Design connection.
4. Compositor E2E on macOS, Windows, and Linux: resize, tab/app switching,
   fullscreen, multiple displays, 1x/2x DPI, sleep/wake, crash/reload, and
   detached DevTools.
5. Design parity: all Figma-like selection, drag, text edit, draw, comment,
   context-menu, keyboard, undo/redo, and panel interactions over the native
   surface.

No native backend should become the default until the relevant phase is green
in both packaged desktop and local framed-dev builds.

## Current Electron references

- [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [View bounds, z-order, visibility, and border-radius behavior](https://www.electronjs.org/docs/latest/api/view)
- [Persistent session partitions](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options)
- [Web embed tradeoffs](https://www.electronjs.org/docs/latest/tutorial/web-embeds/)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)

The repository currently uses Electron 41.2.2. Electron 43.1.0 was the latest
published package when this decision was written; upgrading Electron is a
separate compatibility task, not a prerequisite for the contract above.
