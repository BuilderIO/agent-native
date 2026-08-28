# @agent-native/core

## 0.176.1

### Patch Changes

- 6621544: Emit `$ai_http_status` on `$ai_generation` events. A model call that streamed to completion reports 200; the call a run died in reports the provider status the engine named. A failure that carried no status omits the field rather than defaulting it, so a transport drop is never reported as a healthy call or an invented rejection.
- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/recap-cli@0.5.20
  - @agent-native/toolkit@0.17.6

## 0.176.0

### Minor Changes

- f445b44: Make the read-only source/search convergence budget configurable as `agent.sourceSweepToolCallThreshold` (env `AGENT_SOURCE_SWEEP_TOOL_CALL_THRESHOLD`), and raise its default from 12 to 24 tool calls per turn. Research-shaped apps that legitimately inspect many records were hitting the guard mid-task; a deployment can now tune the budget instead of living with a hardcoded constant.
- f445b44: Add `agent.builtInEngines` so a deployment can choose which built-in agent engines are registered. Unset registers every built-in, as before; setting it (in `defineAppConfig()` or via `AGENT_BUILT_IN_ENGINES`) registers only the named ones, so the rest never appear in the model picker and never resolve by name. An unknown name is a configuration error rather than a silently ignored entry.

### Patch Changes

- 3d10cb0: Use Agent-Native branding in Drizzle migration docs and comments
- 2ee0e37: Preserve a trailing slash in advertised agent-web page URLs. `normalizePagePath` stripped it from every page path, so a site whose canonical URLs carry a trailing slash had every sitemap entry, `llms.txt` link, and JSON-LD `url` pointing at a redirect instead of the page. Bare page paths are unchanged, and Markdown twin paths still drop the route's trailing slash (`/about/` → `/about.md`). JSON-LD breadcrumb items now follow the page's own URL shape.

  Add an optional `localizeHref` to `BlockRenderContext`. Block fields such as a card `href` go straight to the router without passing through `renderMarkdown`, so a host that canonicalizes its URLs had no way to reach them.

- e37c195: Expose Builder gateway credential availability to server consumers.
- a29c7ef: Expose MCP connection setup in searchable standard Settings, with the canonical
  `/mcp` URL and host-specific guidance shared with the connect page.
- 55b7b6f: Ask for a user's role during shared first-run onboarding and persist the preference for personalization.
- 5203369: Publish restored composer drafts to host affordances.
- ca7360e: Clarify the email sign-in action and keep magic-link onboarding as the default entry view.
- 04b27f9: Use custom app names and optional logos in social OG images while preserving Agent-Native branding for first-party templates.
- 46e4ada: Refuse to save failed provider and web responses as durable workspace exports.
- 841c741: Fix two Figma auto-layout rules the REST importer could not express in CSS.

  Figma allows a negative `itemSpacing`, which overlaps auto-layout children. CSS
  rejects a negative `gap` outright, so the declaration was dropped and silently
  fell back to 0. On the Positivus landing page the contact block overlaps its
  children by -367px; losing that overflowed the row, and because CSS flex items
  shrink by default while Figma never shrinks a FIXED or HUG child, the overflow
  was redistributed and both children came out the wrong width (1240px rendered
  as 825px, 692px as 415px) with the illustration thrown outside its card.

  A negative `itemSpacing` is now reproduced as a negative margin on every child
  after the first, and children whose main-axis sizing is not FILL are pinned
  with `flex-shrink: 0`. Measured against Figma's own geometry for those nodes,
  every box now matches to within 0.1px.

- 841c741: Fix a set of Figma import defects that silently dropped or reshaped content,
  found by measuring 26 real designs against Figma's own render of each node.

  Across that corpus the import diff falls to 3.1% overall, 0.78% with text boxes
  excluded and 0.44% excluding image fills as well — what remains is Chromium and
  Figma hinting glyphs and scaling bitmaps differently, not the conversion. The
  export hop costs under 2.4% on every design. Per node, 23 of the 26 designs have
  nothing off by more than 1.5px, and every offender in the other three is one
  glyph: a hugging box holding a `%`, which Google Fonts' Inter draws wider than
  the Inter Figma bundles.

  A child set to FILL along an axis its auto-layout parent HUGS now keeps the
  size Figma resolved for it. Figma treats that pair by falling back to the
  child's own size, but `flex-grow: 1; flex-basis: 0%` in an auto-sized flex
  container resolves to zero — so the child disappeared and every later sibling
  slid up by its height. A 343x240 photo vanished from a real landing page this
  way.

  An auto-layout frame that HUGS an axis but has no children now keeps the size
  Figma resolved for it. Figma does not collapse an empty hug frame, so it still
  reports real dimensions; mapping that to `width: auto` collapsed it to nothing,
  which deleted a 685x456 image placeholder from a real hero section and let its
  FILL sibling take the whole row, so the heading stopped wrapping too.

  Mirrored nodes are no longer rendered as half turns. Figma's `rotation` field
  is a decomposition that cannot tell a flip from a 180-degree rotation — both
  report pi — so a horizontally mirrored group picked up a vertical flip it does
  not have, and everything inside it landed on the wrong side. The transform now
  comes from `relativeTransform`'s own 2x2 block as a CSS `matrix()`, which
  carries mirroring and skew as well as rotation.

  Three auto-layout rules now match Figma's own resolution rather than the raw
  field values. A row aligned SPACE_BETWEEN no longer also emits `itemSpacing` as
  a CSS gap — Figma ignores that field in this mode but still reports it, and CSS
  distributes space on top of a gap rather than instead of it. A negative
  `itemSpacing` is clamped so the children still fill their container, which is
  where Figma stops an overlap — the same rule the `.fig` walker already used,
  rather than a second one, and applied on a FILL axis as well as a FIXED one
  since a FILL axis takes its parent's definite size. And a rotated auto-layout
  child now occupies its rotated footprint: a CSS transform does not change
  layout size, so a vertical rule stored as a wide line turned 90 degrees was
  taking its full pre-rotation width out of the row.

  Three more sizing rules now follow Figma. A HUG container holding a cross-axis
  FILL child uses the size Figma resolved: a FILL child does not feed Figma's
  hug, while CSS still feeds its max-content into the container's shrink-to-fit
  width, so a card column came out 76px too wide and moved every sibling. A FILL
  child is allowed to shrink below its own content (`min-width: 0`), which is
  what Figma's FILL does. And a zero-thickness LINE is placed from its own size
  rather than the already-rotated bounding box — requiring both dimensions to be
  positive pushed every rotated rule onto the fallback and squared its rotation.

  Break characters Figma does not lay out as breaks no longer become lines.
  Figma's stored text can carry them: a real footer holds "Get started for
  free.\rAdd your whole team as your needs grow." and Figma draws it as ONE
  flowing paragraph, wrapping at the width, while a heading holding "Customise
  it\rto your needs" renders "Customise it to / your needs". Both formats say so
  and neither walker was reading it — REST `lineTypes` and kiwi `textData.lines`
  hold one entry per line Figma actually laid out. Measured across every
  break-bearing text node in the corpus that count is never wrong, while counting
  break characters overstates it on 8 of 20 REST nodes and 17 of 18 kiwi ones.
  Mapping one such CR to a newline made a footer a line taller and, because its
  column is vertically centred, moved all 61 nodes in it.

  Trailing whitespace goes for the same reason: Figma neither draws it nor lets
  it widen a hugging box, while `pre-wrap` does both. Of the 943 hugging text
  nodes in the corpus the only three wider than Figma's own box are the three
  whose text ends in a space — the other 940 average 0.02px of error.

  Angular (conic) gradients now sweep the way Figma sweeps them. Figma computes
  the sweep in the node's normalized space — the box treated as a unit square,
  then stretched — while CSS `conic-gradient()` sweeps at a true uniform angular
  rate in real pixels; the two agree only on the axes, so a non-square tile
  landed its mid-sweep colours visibly early. Drawing the gradient into a square
  and scaling that square to the box reproduces Figma's definition exactly.

  Zero-thickness vector geometry renders again. The SVG spec says a viewBox with
  a zero width or height DISABLES rendering of the element, so a stroked path
  whose own box is 20x0 — a horizontal rule, or the arrow inside a "Learn more"
  button — disappeared silently. A collapsed axis now takes the stroke's own
  width, with the geometry centred on it.

  Figma's image CROP is now honoured. `scaleMode: STRETCH` with an
  `imageTransform` is Figma's Crop mode: the matrix picks a sub-rectangle of the
  image and stretches that to fill the box. The transform was being discarded and
  the whole image drawn instead, which reads as the artwork zoomed out — every
  illustration on a real services page came out visibly smaller than Figma draws
  it, and it was the largest non-text difference left on that page (4.04% ->
  3.52%). A rotated or skewed crop still takes the raster fallback, which is
  exact where a stretch would be wrong.

  A hugging TEXT box now takes Figma's rounded width as a minimum. Figma rounds
  every hugging text box to a whole pixel and lays its siblings out against that;
  hugging to our own fractional width makes each label a fraction narrower, and
  in a row of them the fractions add up — a nav came out 5px short across six
  items, moving every one of them. As a minimum rather than a fixed width:
  pinning the width forces the text to wrap wherever our advances run a hair
  wider than Figma's, which is a different layout entirely.

  The height is a minimum only where the text can wrap. Figma lays a hugging box
  out at `round(lines * lineHeight)` — 206 of the 207 hug-both nodes in the
  corpus with a fractional line height — and it rounds DOWN as often as up, so a
  minimum could never reach it. Text hugging BOTH axes cannot wrap, so its line
  count is fixed by the break characters and always matches Figma's; there the
  rounded height is taken outright. Two Space Grotesk headings at 38.28px line
  height hugged to 38.28 each where Figma laid out 38, and the 0.56px each pushed
  their whole column down.

  Diamond gradients are now drawn as the four-pointed shape Figma draws, instead
  of being approximated by an ellipse. The falloff is an L1 distance, which is
  linear inside each quadrant, so four quadrant-tiled linear gradients reproduce
  it exactly rather than approximately.

  An image fallback's overflowing ink no longer takes layout space. The `<img>`
  is sized from render bounds so an OUTSIDE stroke or shadow is drawn at its
  natural size instead of squished into the smaller geometric box, but Figma
  stacks siblings against the geometric box and paints the ink outside it. A
  horizontal LINE is the extreme case — its box is zero-height and the stroke is
  entirely overflow, so every rule on a page pushed everything below it down a
  pixel.

  `downscaleImageToFit` is new in `ingestion`: it re-encodes an image to fit a
  byte budget, keeping the aspect ratio, for callers that must inline one. The
  Figma SVG export used it to stop dropping a page's 11.5MB hero shot, which had
  been leaving a hole in the exported file — over a budget is a reason to send
  fewer pixels, not to send nothing.

  Icon-font glyphs no longer import as `.notdef` boxes. A Private Use Area
  codepoint means nothing outside the font that assigned it, and fonts reach an
  imported screen by family name from Google Fonts, which serves none of these
  icon fonts — so Chromium drew a hollow box beside all 16 nav items of a real
  admin dashboard, where Figma draws an icon. Such a text node now takes the
  rendered-PNG fallback the walker already uses for anything it cannot express
  (0.97% -> 0.83% on that design). The `.fig` walker has no render to fall back
  on, so it drops the glyph and records the reason against the node instead.

- 841c741: Match Figma's nearest-neighbour sampling when a Figma image fill is magnified.

  Figma upscales an image fill with nearest-neighbour sampling; a browser upscales
  with bilinear smoothing. Measured across a checkerboard edge on a 16x16 fill
  blown up to 180x90, Figma steps from `rgb(119,73,132)` to `rgb(227,78,52)` in
  ONE pixel while the import ramped across twelve, so every low-resolution fill —
  a pattern, an icon, pixel art, a placeholder — imported blurred.

  `mapFigmaNodeToHtml` now takes `imageFillSizes` (imageRef -> the image's own
  pixel size) and asks for `image-rendering: pixelated` only when the box is
  meaningfully larger than the image. Only when magnified: `pixelated` is nearest
  in both directions and a photo scaled down that way aliases badly. Without a
  size the fill still renders, just smoothed.

  The Figma importer supplies it for free from the bytes it already downloads to
  mirror into storage. The `fills-effects` fidelity case went 14.33% -> 12.07%,
  and the scanline across that edge now matches Figma's within 1/255 per channel.

- 841c741: `fingerprintMedia` no longer imports `node:crypto`. It is re-exported from the
  `ingestion` barrel, so that one import made the whole barrel — the Figma
  converters included — fail to load in a browser. It now uses `@noble/hashes`,
  verified to produce the same SHA-256 digest.
- 841c741: Figma REST import fidelity: four measured corrections found by pixel-diffing
  the mapper's output against Figma's own renders.
  - Rotated nodes tilted the wrong way. `relativeTransform`'s 2x2 block is
    already CSS's own rotation matrix in the same y-down space, so the CSS angle
    is `rotation`, not `-rotation`; negating it doubled the error.
  - Children of a rotated node were positioned and sized from
    `absoluteBoundingBox`, which is measured in already-rotated absolute space
    and inflated to the rotated AABB. Geometry now comes from
    `relativeTransform` + `size` (the node's true pre-rotation box in its
    parent's own frame) whenever Figma returns them.
  - Linear gradients used the wrong angle on any non-square box. Figma evaluates
    the gradient in normalized space, so the CSS angle follows the iso-line
    normal `(du/w, dv/h)`, not the scaled handle vector `(du*w, dv*h)`.
  - Per-paint `opacity` on an IMAGE fill was dropped, because CSS background
    layers have no per-layer opacity. Such a paint (and anything Figma stacks
    above it) now renders as an absolutely-positioned overlay div.

  Also: layer/background blur radius is scaled by a fitted 0.45x instead of 1:1,
  and `textAutoResize: TRUNCATE` now renders its ellipsis instead of clipping
  silently.

- 841c741: Figma REST import now reconstructs real vector geometry. Vectors and boolean
  operations that carry `fillGeometry`/`strokeGeometry` are emitted as inline
  `<svg><path>` markup with their own solid and gradient paints, and reported as
  `exact` fidelity instead of `image-fallback`. Nodes without geometry keep the
  rendered-PNG fallback.
- 7379c91: Export the fitted Figma blur-radius constant so the REST and `.fig` import
  walkers share one value, and stop the fidelity report from describing a text
  layer's drop shadow as a `text-shadow` when it is emitted as a `box-shadow`.
- 0705e7f: fix Builder OAuth callbacks for apps hosted on Builder Cloud origins
- 9f31e60: fix password actions for framework sessions without a Better Auth session
- 5f9ca21: Keep completed chat responses static when a new run starts and keep stopped-response actions available.
- 0d69102: Fix Google Drive Docs push authentication to use native channel tokens.
- 7abab10: Create or reuse a verified Builder account during first-run onboarding.
- 6e59cdd: Keep Builder editing detection active after SPA navigation removes preview URL markers.
- 313909c: Keep managed Drizzle app migrations separate from framework release migrations in generated and hosted projects.
- 56f7bab: Wait for lazy MCP initialization before app-visible MCP actions read the shared manager.
- Release all public npm packages with a patch version bump.
- b8bc6bf: Show a readable error page when a workspace OAuth connection cannot start, instead of replacing the page with a raw JSON body
- 5c66e51: Keep password authentication available when deployed apps do not configure an email provider, and document email delivery as optional but recommended.
- 292a1ac: Preserve exact visible prompt text when hidden agent context is attached.
- 387de2d: Stop telling readers their own provider key was rejected when it was not theirs

  A 401 proves the credential a request carried was refused. It does not prove
  whose credential it was, and the reader is often someone with no saved key to
  fix — the rejected credential can be a workspace or deployment one they cannot
  see. The copy named "the saved provider key" as the cause and sent everyone to
  Settings, which is why one shared credential cost two days of chasing key
  configuration.

  The message now says only what the 401 proves, and the rejected-credential card
  offers a retry alongside the setup flow. That retry used to be withheld because
  it would "replay the same rejected credential and loop"; that stopped being true
  once a 401 began fingerprinting the credential and skipping it for a backing-off
  window, so the next attempt reaches for a different one or fails closed as
  missing credentials. Previously this rendered a setup panel for a connection
  already marked good, with no action available at all.

- 4776e61: Reduce CI lint warnings with safer type narrowing, callback binding, and explicit async intent.
- d2b314b: Keep uploaded files and pasted text visible in chat history without importing new-deck references.
- a3d0e47: Expose atomic user-scoped settings mutation alongside the existing read and write helpers.
- 2dc4b25: Fix magic-link startup and Builder credit signup handoff.
- d5ddd8c: Use connected Google profile names and avatars across shared identity surfaces.
- 4f7f661: Export scope-aware Builder upload authorization checks from `@agent-native/core/server`.
- 510eb32: Keep Slides agent generation context and chat history reliable across attachments, follow-ups, and queued sends.
- 7d89861: Smooth out the skeleton loading animation. Tailwind's stock `animate-pulse`
  swings opacity 1 → 0.5 and eases hard into both ends, and skeletons that mount
  at different moments never line up — at that amplitude a screen of placeholders
  strobes. The shared stylesheet now defines `--animate-pulse` as a calmer
  1 → 0.72 breathe, honours `prefers-reduced-motion` globally, and the two
  hand-rolled skeleton keyframes reuse it.
- 0a0956d: Keep intentionally stopped chat runs from reappearing as missing final responses.
- 709f807: Track Agent-Native auth, onboarding, activation, and sharing funnel events.
- e714047: Keep chat response streams available during JSON checks and reject unexpected successful JSON responses explicitly.
- Updated dependencies [ac1ecfc]
- Updated dependencies [4776e61]
- Updated dependencies
- Updated dependencies [5a12f71]
- Updated dependencies [d2b314b]
- Updated dependencies [5c96078]
  - @agent-native/toolkit@0.17.5
  - @agent-native/recap-cli@0.5.19

## 0.175.5

### Patch Changes

- 330eedf: restore markdown list markers and open durable chat streams while workers finish setup
- c4f89b2: Handle coded Builder gateway internal errors consistently across streamed and HTTP responses.
- 37d360e: Standardize Agent-Native branding in the migration runner documentation.
- 3b19335: Use custom app names and optional logos in transactional emails while preserving Agent-Native branding for first-party templates.
- Release all public npm packages with a patch version bump.
- 24348cb: Prevent auth and password-reset fields from auto-focusing on initial load, avoiding an unexpected mobile keyboard.
- bda7ef3: Improve shared-resource notification emails with sender context, a resource-name block, and a focused call to action.
- Updated dependencies
  - @agent-native/recap-cli@0.5.18
  - @agent-native/toolkit@0.17.4

## 0.175.4

### Patch Changes

- 20be465: Keep ordinary cross-app todo requests in chat and make oversized provider tool names safe for A2A handoffs.
- 9426034: Stop a rejected provider credential from re-breaking the first prompt on a fixed cadence

  A 401 pins the rejected credential so the next lane serves everyone after it, but
  two things kept unpinning it and making the next person's first prompt pay to
  rediscover the same rejection:
  - `ai-sdk-engine` cleared the auth-failure marker after every stream, error or
    not, so one unrelated failure (a 500, an overload) re-admitted a credential a
    401 had just pinned. Clearing asserts the credential works, so only a turn
    that actually completed does it now.
  - Both auth-failure markers released on a flat 15-minute TTL. The marker is
    fingerprinted on the credential value, so a rotated credential never matched
    the old marker anyway — the TTL only ever re-tested a credential that was
    still wrong. Repeat failures on the same fingerprint now back off
    exponentially from that base up to 24h, while a first, genuinely transient
    401 still releases on the original TTL.

- Release all public npm packages with a patch version bump.
- db91905: Allow hosted deployments to resolve their Notion OAuth client credentials for signed-in users.
- 5ef18e1: Let agents inspect successful public image responses from web-request as vision context.
- 557e694: Polish the agent recovery card action spacing.
- 318819b: Give the Dispatch workspace embed handshake a cold-boot connect budget so opening an app whose server is still starting no longer fails as unreachable. `McpClientManager` now accepts a `connectTimeoutMs` option, and the embed session mint spends up to 90s per attempt within a 95s total budget instead of the 5s interactive default, matching the dev gateway's own readiness wait.
- Updated dependencies [db91905]
- Updated dependencies
  - @agent-native/toolkit@0.17.3
  - @agent-native/recap-cli@0.5.17

## 0.175.3

### Patch Changes

- c30393d: Rework Chat's docs (Overview, Your First Feature, Developer Guide) into the same focused format used by the Calendar docs rework: a "Try it out now" card linking to the live chat.agent-native.com app, a What ships Comparison with explicit accent colors, and a Developer Guide quick start plus action inventory and customizing section. Also updates the ar-SA, de-DE, es-ES, fr-FR, hi-IN, ja-JP, ko-KR, pt-BR, zh-CN, and zh-TW locale translations of template-chat.mdx and template-chat-first-edits.mdx to match. template-chat-developers.mdx still has no locale mirrors at all — that gap is pre-existing and already tracked in the i18n coverage baseline.

## 0.175.2

### Patch Changes

- 96d0181: Keep a same-origin Referer on validated embed responses so an embedded Dispatch can open workspace apps. Embed responses previously used `Referrer-Policy: no-referrer`, which stripped the Referer from every same-origin request the page made for the life of the document, so `create-workspace-app-embed-session` rejected Dispatch itself with "Workspace app sessions must be requested by Dispatch." Cross-origin referrers stay fully suppressed.
- 462f53c: Preserve Builder OAuth state when Builder omits it from the callback query.
- Release all public npm packages with a patch version bump.
- 84ab540: Fix mouse-wheel zoom running at trackpad-pinch sensitivity in `usePinchZoom`.

  A single wheel notch saturated the hook's ±50px delta clamp and landed on
  `exp(0.5)`, so every detent multiplied zoom by ~1.65× regardless of how far the
  wheel actually turned. Wheel and pinch now run through separate curves — a
  notch is a Figma-sized 1.1× step, finger separation keeps the exponential — and
  the device is latched per gesture rather than guessed per event, because macOS
  ramps an accelerated wheel up from pinch-sized deltas.

  Adds `@agent-native/core/client/zoom-gesture` exporting the shared
  classification and curves (`resolveZoomGestureDevice`, `zoomFactorForWheelDelta`,
  `clampZoomFactor`, `accumulateZoomFactor`) so canvases stop re-deriving them.

  `preventDefault` on wheel and touch-pinch is now guarded by `event.cancelable`,
  which stops the browser Intervention warning Chrome logs per event during a
  fling.

  Line- and page-mode wheel deltas are converted to pixels before the curve is
  applied. The curve is calibrated in pixels, so a Firefox line-mode notch
  (`deltaY: 3`) was being read as three pixels of travel and moved zoom by well
  under a percent. Classification still reads the raw delta and its real mode —
  normalising first would push a line tick into the trackpad band.

- Updated dependencies [65a3b88]
- Updated dependencies
  - @agent-native/toolkit@0.17.2
  - @agent-native/recap-cli@0.5.16

## 0.175.1

### Patch Changes

- 5a045bf: Fix file uploads for Builder connections made through OAuth. New connections
  store only an OAuth grant, but the upload provider and the storage capability
  gates still looked for a legacy `bpk-` private key, so uploads failed for every
  newly connected user.

  Builder OAuth now also requests `builder:assets:write`, the scope its
  `/api/v1/upload/*` endpoints enforce, and the upload provider sends the OAuth
  token when the request's owner has a grant — falling back to a private key only
  when there is no grant at all.

  Already-connected users must authorize Builder once more to pick up the new
  scope.

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/recap-cli@0.5.15
  - @agent-native/toolkit@0.17.1

## 0.175.0

### Minor Changes

- da836e2: Use the hardened Run QuickJS evaluator for production sandboxed code execution.
- cf473dc: Allow mention providers to show custom text or images with optional background
  colors, or to omit leading media, while preserving the existing icon fallback.
- 6c71a21: Add opt-in WebMCP producer and browser-session consumer support.

### Patch Changes

- 73ff8c5: Allow apps to configure approval requirements for individual MCP tools and require a fresh approval on every call when persistent approval is disabled.
- Release all public npm packages with a patch version bump.
- de5ba2d: Keep shared managed MCP OAuth clients from being overridden by stale personal secrets.
- Updated dependencies
- Updated dependencies [cf473dc]
  - @agent-native/recap-cli@0.5.14
  - @agent-native/toolkit@0.17.0

## 0.174.2

### Patch Changes

- bb282b1: Removed the FAQ docs page and folded its content into What Is Agent-Native and the docs pages each answer actually belonged to (deployment, environment variables, writing agent instructions, templates, key concepts, syncing template changes).
- a9aa623: Reset Google sign-in state when an Electron OAuth popup closes and keep Nitro dev startup errors behind the recovery page until the server is ready.
- Release all public npm packages with a patch version bump.
- 615c5d5: Skip `git init` when `create` scaffolds into a directory that is already inside a git repository, instead of only when the target directory itself is one. Discovery is delegated to git, so symlinked paths, filesystem boundaries, and `GIT_CEILING_DIRECTORIES` behave exactly as they do everywhere else.
- Updated dependencies
  - @agent-native/recap-cli@0.5.13
  - @agent-native/toolkit@0.16.16

## 0.174.1

### Patch Changes

- 5e57bc6: fix fresh chats to use a configured provider instead of an unavailable deployment default
- 7d90274: Preserve shared OAuth flow cookies across redirects.
- 7d5cce0: Use the configured Google OAuth client for official Google Workspace MCP servers.
- a63c4b3: Support Google Workspace MCP OAuth clients that use Google's fixed OAuth endpoints instead of MCP discovery.
- Release all public npm packages with a patch version bump.
- a026821: keep provider-auth recovery visible while an agent run is still active
- Updated dependencies
  - @agent-native/recap-cli@0.5.12
  - @agent-native/toolkit@0.16.15

## 0.174.0

### Minor Changes

- b4c3864: Collapse the core-routes `mcpConnect*` options into one `mcp` object, and fix the MCP server name on multi-label hosts.

  `createCoreRoutesPlugin({ mcp: { connect, serverName } })` replaces the four flat keys `disableMcpConnect`, `mcpConnectServerName`, `mcpConnectAppId`, and `mcpConnectAppName` — the same shape `AgentChatMcpOptions` already uses for the protocol mount. All four stay accepted for one minor; setting both forms to disagreeing values throws at plugin init rather than booting with a connect surface nobody chose.

  The two identity keys are deprecated outright rather than carried over: `app.id` and `app.name` are declared config fields, so a per-surface option for them is a third spelling of one thing. Unset, they now resolve from config — the same value the runtime config report already read.

  An explicit `serverName` is returned verbatim, prefix and all — it pins an id clients already hold in their config, which is why Plan publishes the bare `plan` rather than the derived `agent-native-plan`.

  Fixes the server name on hosts with more than one leading label. `serverName` fell back to the first hostname label, and every beta deployment is `beta.<app>.agent-native.com`, so all of them advertised themselves as `agent-native-beta`. Clients key their MCP config by that name, so connecting a second beta app replaced the first. Identity now resolves from `app.id` / `app.template` / `app.slug` before the hostname, which covers every first-party template with no configuration.

- b4c3864: Resolve the app's name, slug, and description once, through app config.

  `server/app-name.ts` is removed. `getAppName()`, `getAppSlug()`, and `getAppDescription()` become `getAppConfig().app.name` / `.slug` / `.description`, and the first-party-template lookup they performed now runs over the resolved config, keyed on `app.packageName` (`npm_package_name`). It fills only what is still unset, so `APP_NAME` or a `defineAppConfig()` value always wins.

  **`getAppConfig()` no longer touches the filesystem.** `getAppName()` read package.json from `process.cwd()` on every resolution path; the repo already treats that as a development-only fallback (`server/cookie-namespace.ts` uses one solely in its non-production branch). A deployment where `npm_package_name` does not reach the runtime should set `app.name` in `server/plugins/config.ts` or `APP_NAME`.

  This removes a second resolver for a declared field: `getAppName()` read `process.env.APP_NAME` directly while `app.name` already declared that alias, so the two disagreed. `core-routes-plugin.ts` resolved the same app name both ways, thirty lines apart — the runtime config report got `undefined` for every first-party template while the MCP connect page got "Mail". Both now read one value.

  `app.slug` and `app.description` are new fields with no env alias: the slug selects the per-app transactional email sender on agent-native.com, so a name the first-party template table already contains is its only source. `app.packageName` and `app.template` are deliberately still env-only — both are read as app-id fallbacks when matching stored workspace connection grants, and filling them from package.json would repoint those lookups.

  A package.json that exists but cannot be read or parsed now throws and names the file, instead of being silently indistinguishable from having none — which previously branded the app "Agent-Native" and sent from the generic mailbox with nothing in the log.

- b4c3864: Deprecate `createAgentChatPlugin({ model })` and `({ durableBackgroundRuns })` in favour of the declared `agent.*` config surface.

  `agent.model` (`AGENT_MODEL`) was declared but no agent-chat path read it — every model resolution site read the plugin option directly, so the field was inert. It is now the layer beneath the option, resolved through one helper instead of eight raw reads.

  Fixes two delegated-run gates (A2A and MCP) that tested `durableBackgroundRuns === true` on the raw option instead of calling `isAgentChatDurableBackgroundEnabled`. On Netlify, where durable background is default-on, a mount that did not pass the option was capping delegated turns at the 40s foreground chunk budget while running inside the 13-minute background function.

- b4c3864: Move observability settings out of the settings table and into `defineAppConfig()`.

  `observability` is now a declared config domain. The `observability-config` settings row is no longer read: nothing in core ever wrote it, so its only "UI" was a documented `putSetting(...)` snippet an app author pasted into their own code — which makes it deployment configuration, not a runtime preference. Deployments that wrote that row must move those values into `defineAppConfig({ observability: { … } })`; every field also has a deployment environment variable alias.

  This also takes a database round-trip off the agent hot path. `getObservabilityConfig()` read the settings row on every instrumented run inside a bare `catch {}`, so a database outage was indistinguishable from "never configured" and silently served defaults.

  `defineAppConfig()` now returns a Nitro plugin, so its canonical home is `server/plugins/config.ts` with `export default defineAppConfig({ … })` — the same shape as every other framework plugin. The config layer is still applied at module load, before any plugin reads it. Existing callers that ignore the return value are unaffected.

  **Removed:** `ObservabilityConfig.exporters` and `ObservabilityExporterConfig`. Nothing ever read them — `observability/tracing.ts` states that core deliberately registers no OpenTelemetry provider or exporter — so the documented OTLP export never sent anything, and the docs recommended putting a backend bearer token into the settings table to configure it. Export now happens by registering a `TracerProvider` in the app, which keeps the credential in the app's own wiring and the vault.

  **Removed:** `DEFAULT_OBSERVABILITY_CONFIG`. The schema's declared defaults are the single source now.

### Patch Changes

- d9e978f: Expose model-produced tool inputs to eval scorers so argument-level agent behavior can be verified.
- 536e193: Compile oversized PostHog transcript bounding against ES2022 by walking the last user message instead of using `Array.findLast`.
- Release all public npm packages with a patch version bump.
- f22b29b: Validate OpenRouter keys before saving them and preserve actionable provider setup errors.
- eae6742: Stop SQL-replayed provider authentication failures from self-continuing.
- Updated dependencies
  - @agent-native/recap-cli@0.5.11
  - @agent-native/toolkit@0.16.14

## 0.173.1

### Patch Changes

- 1417ba5: Give UI and agents the parts of a `fail()` failure they were missing.

  Action errors now carry `actionMessage`, the text the action wrote with no
  `Action <name> failed:` framing, plus an `actionErrorMessage()` helper exported
  from `@agent-native/core/client/hooks`. Templates render `error.message`
  directly, so a refusal surfaced as "Action update-brand-kit failed: That name
  is taken." The helper returns `undefined` when nothing authored a message (a
  network drop, a proxy's HTML error page, a bare status line), so a UI cannot
  mistake transport noise for copy.

  Tool results now include the `errorCode` an action chose, as
  `Error running get-meeting: No such meeting (errorCode: not_found)`, on both
  the in-app agent loop and MCP. The model can branch on the code without parsing
  prose. `fail()`'s default `action_failed` is omitted, since it says only "it
  failed", which the word "Error" already said.

- 191f4d3: Keep the Google account chooser when connecting a managed workspace connection and preselect the signed-in identity.
- Release all public npm packages with a patch version bump.
- a4b36e0: Stop billing cached prompt tokens twice, and normalize what `inputTokens` means
  across every engine.

  Providers disagree: OpenAI's `prompt_tokens` includes cached tokens, Anthropic's
  `input_tokens` excludes them. The `usage` event never said which it carried, so
  both conventions reached `calculateCost`, which charged `inputTokens` at the
  full input rate and then added `cacheReadTokens` / `cacheWriteTokens` on top.
  On a long cached conversation the cache is nearly the whole prompt, so a turn
  that cost $0.0054 was reported as $0.0478 — and every `token_usage` row for an
  OpenAI-family model was inflated the same way.
  - The `usage` event now documents one convention: `inputTokens` is the whole
    prompt and INCLUDES both cache counts, which are a slice of it rather than an
    addition. This matches the AI SDK's own `inputTokens.total` / `noCache` /
    `cacheRead` / `cacheWrite` normalization, and the Builder gateway.
  - `anthropic-engine` was the only ENGINE reporting the exclusive form. It now
    adds the cache counts back, which also fixes its prompt size: a fully cached
    turn used to report ~3 input tokens instead of the real 42,438.
  - `calculateCost` treats the three counts as a partition and prices each token
    exactly once. Callers with no prompt caching pass zeroes and are unaffected.

  The recap CLI carried all three conventions at once and now shares this one:
  `parseClaudeUsage` adds Anthropic's cache counts back into the prompt,
  `parseCodexUsage` no longer strips OpenAI's cached tokens out of it (it did that
  to compensate for the old pricing formula, so keeping both would have swung the
  error the other way), and `parseOpenAiCompatibleUsage` was already correct.

- a4b36e0: Correct the GPT-5.6 pricing rates, which matched no published tier.

  The `sol` / `terra` / `luna` entries carried input and output rates that appear
  in neither column of OpenAI's table (luna was $1.00/$6.00 per MTok against a
  real $0.20/$1.20), and set `cacheWrite: 0` on the belief that OpenAI does not
  bill cache writes — it does, at above the full input rate. All three now track
  the published short-context rates:

  |       | input | cached | cache write | output |
  | ----- | ----- | ------ | ----------- | ------ |
  | sol   | $4.00 | $0.40  | $5.00       | $20.00 |
  | terra | $2.00 | $0.20  | $2.50       | $12.00 |
  | luna  | $0.20 | $0.02  | $0.25       | $1.20  |

  Short context on purpose: each model has a long-context tier at roughly 2x, and
  a usage row does not preserve the request's context size, so the tier cannot be
  recovered at pricing time.

  Together with the cached-token double-billing fix, a real 11-call run drops from
  a reported $0.8524 to $0.0358 — 24x. Pricing that run's cache writes at the
  input rate instead reproduces PostHog's independently derived $0.0328 to the
  cent, which is what confirms the rates.

- a4b36e0: Fix tool calls rendering without their output in PostHog LLM analytics.

  Engine messages shipped verbatim as `$ai_input`, in a shape PostHog does not
  read: `tool-call` / `tool-result` parts with camelCase ids, and tool results
  carried inside a `user` message because `EngineMessage` has no `tool` role.
  PostHog dumps raw JSON for shapes it does not recognize, so a tool call rendered
  as an escaped blob with its result nowhere in sight. Messages now normalize to
  the OpenAI/Anthropic conventions PostHog reads, and attachment bodies become a
  marker naming the media type and size instead of inlining base64.
  - `tool_calls[].id` now carries the id the model issued rather than our span id,
    so a call and its result actually pair. Span id remains the fallback for
    emitters that report no call id.
  - The byte-ceiling rescue in `boundAiContent` keeps "the last user message",
    which in engine shape was the last tool result — so the user's question was
    dropped from every oversized generation. Normalizing first fixes it.
  - A tool span with `captureToolResults` off now carries an explicit "withheld"
    marker in `$ai_output_state` instead of omitting it, matching what the error
    path already did. An absent output state reads as a tool that returned
    nothing, and the tool did answer.

- 7265794: Prevent background chat recovery from reporting completed runs as lost.
- 1417ba5: Make `fail()` reach the caller, and stop retrying deterministic action failures.

  `fail()` threw a bare `Error`, which the action HTTP route cannot distinguish
  from a driver or upstream blowup. Every refusal written for a person became a
  500 `"Internal server error"` with the real message dropped and an
  error-tracking report filed. It now raises an `ActionContractError` with a
  default 400, so the message, `errorCode`, and `details` survive the transport,
  and it accepts an explicit `statusCode` for causes like 404 or 409. `fail()`
  now lives beside that error in `action.ts` and is exported from
  `@agent-native/core/action` as well as the package root.

  `defaultActionQueryRetry` retried by exclusion, so every status nobody had
  added to its deny list was retried three times. A `useActionQuery()` read
  refused with 400, 404, or 409 cost four executions, and a 500 cost four
  duplicate error reports. It now retries by exception: `429`, `502`, `503`, and
  `504`, plus one retry for status-less network failures. A 500 is an action's
  own unhandled throw, so it is treated as deterministic and surfaces on the
  first response.

- Updated dependencies
- Updated dependencies [a4b36e0]
  - @agent-native/recap-cli@0.5.10
  - @agent-native/toolkit@0.16.13

## 0.173.0

### Minor Changes

- 460080b: Give chat readers control over how much model reasoning is shown, and make
  reasoning collapsible everywhere it appears.

  Reasoning inside the "Worked for…" summary used to render as flat prose with no
  disclosure of its own, so opening that summary dumped the full chain of thought
  between the tool calls with no way to fold it back. It now keeps its own
  "Thought for Xs" row, collapsible exactly like the tool calls it sits between,
  and renders its markdown instead of showing `**source characters**` — OpenAI
  reasoning summaries arrive pre-formatted.

  A new browser-local preference picks between three modes, reachable from the
  chat panel's ⋮ menu:
  - **Expanded** — the previous behaviour: the live cell opens itself.
  - **Collapsed** — the new default. The label and its timing stay visible, the
    text is one click away, and a live turn no longer pushes the answer out of
    the viewport.
  - **Hidden** — no reasoning cells at all.

  Hosts can pin the mode with the `thinkingDisplay` prop on `AgentSidebar`,
  `AgentPanel`, `AgentChatSurface`, and `AssistantChat`; when pinned, the in-chat
  control is not offered rather than left as a dead menu item. The preference is
  presentation only — it never changes what the engine requests or what is
  persisted, so switching back reveals the same text on the same turns.

### Patch Changes

- Release all public npm packages with a patch version bump.
- 460080b: Send `$ai_generation` and `$ai_span` to PostHog stamped at the moment the operation ended, which is the convention it reads them by: its timeline derives an operation's start as `timestamp - $ai_latency`, so stamping the start drew every bar one full latency too early — model calls overlapped each other by a growing margin, a call's tool spans appeared underneath the _next_ call, and a 35s run rendered as 31.2s. The shift is applied inside the PostHog provider, so the shared event keeps the operation's start for Mixpanel, Amplitude, webhooks, and Agent-Native Analytics, which read the timestamp verbatim. Events with no `$ai_latency` — a trace, an exception — are unshifted.
- Updated dependencies
  - @agent-native/recap-cli@0.5.9
  - @agent-native/toolkit@0.16.12

## 0.172.10

### Patch Changes

- 200e63b: Make the harness-session generation migration idempotent on SQLite.

## 0.172.9

### Patch Changes

- 36c79f9: Use the authenticated workspace app registry for hosted Dispatch app lists so inaccessible apps do not get an Open app action.

## 0.172.8

### Patch Changes

- e248449: Emit the `signup` event once per real account creation, and stop emitting it for user rows that are not signups.

  Better Auth runs its `user.create.after` hook on every `user` row insert, and the hook treated all of them as a person signing up. Two production paths create rows through `internalAdapter` outside any endpoint, where Better Auth's context — and therefore the request, the browser, and its `an_aid` / `an_ft` cookies — is `null`: `ensureCanonicalUserForLegacySession` (backfilling a canonical row for someone who signed up months ago) and `ensureGoogleAuthIdentity` (provisioning the canonical row during the Google callback). Both emitted an unattributable `signup` recorded as `referral_source: "direct"`, which is why ~94% of `better-auth` signups carried no `anonymous_id` and one person provisioned across sibling apps counted as a dozen acquisitions.

  Google sign-in was also losing its real event: because `ensureGoogleAuthIdentity` writes the canonical row _before_ `createOAuthSession` runs, the `hasBetterAuthUserEmail` probe there concluded the person was an existing user and skipped the one emitter that carries the browser's anonymous id. Callers now pass the `isNewUser` answer they already hold, and the event carries the canonical Better Auth user id rather than the Google profile id, so it still joins to `referrer_user` in the virality panels.
  - A row insert with no request behind it emits nothing at all.
  - Emitted events carry `signup_origin` (`browser_signup` / `google_oauth` / `sso_jit`) so acquisitions are selectable from sibling-app provisioning.
  - `referral_source: "direct"` is no longer fabricated when no browser context was present — "we never saw a visitor" and "a visitor arrived with no campaign" are now different values.
  - The internal `x-agent-native-signup-attribution` handoff header is stripped from every inbound request instead of only being overwritten on email signup. It is unsigned and outranks the request cookie, so an inbound copy let any client write the `anonymous_id` and campaign onto someone else's signup row.
  - The `webhook` tracking provider now sends `anonymousId`, which it silently dropped.

  Signup counts will fall to the real number. The removed rows were duplicate and backfilled events, not lost users.

## 0.172.7

### Patch Changes

- be8c373: Fix Analytics chat composer drafts to prefer the stable tab identity over a late-arriving thread identity, preventing typed text from disappearing when the draft scope changes.

## 0.172.6

### Patch Changes

- 415a6d8: Transform virtual runtime modules before serving them to embed sessions. The
  dev middleware loaded `/@id/__x00__virtual:*` modules through
  `pluginContainer.load`, which returns plugin source with bare specifiers
  intact, so react-router's `inject-hmr-runtime` reached the browser still
  importing `virtual:react-router/hmr-runtime`. Any page loaded on an origin
  that had an `an_embed_session` cookie failed to hydrate and hung on a spinner.
- 3fa1b09: Allow organization members to queue Run now for Factory-domain jobs they can already load, without widening Mail or CRM automation edit rights.
- 6f0392b: Prevent unconfigured LLM engine tests from reporting a false pass.

## 0.172.5

### Patch Changes

- 5a6204c: Rework Calendar's docs into the new per-app format (Overview, Features, Talk to the Agent, Multi-App Workspace, Developer Guide), add a Comparison per-side accent color and a Cards calendar icon, and translate all five Calendar doc pages into every supported locale.

## 0.172.4

### Patch Changes

- 680268e: Send PostHog AI feedback in the shape its LLM analytics feedback view actually reads. A thumbs vote now answers the survey's first question with PostHog's choice index (`1` up, `2` down) instead of the string `"thumbs_up"`, and the free text after a thumbs-down answers the follow-up question (`$survey_response_1`) rather than overwriting the rating. A vote and the text it opens share one submission id per rated message, so PostHog joins them into a single response, and the vote stays marked incomplete until the follow-up arrives. `POSTHOG_AI_FEEDBACK_SURVEY_ID` is the whole configuration; `POSTHOG_AI_FEEDBACK_SURVEY_QUESTION_ID` is no longer read.
- 680268e: Fix PostHog LLM analytics showing the assistant's reply as part of the prompt. The agent loop appends its own turns to the message array it is handed, and the trace read that array after the run, so `$ai_input` / `$ai_input_state` carried the run's final transcript instead of its request — PostHog rendered the same assistant message in both Input and Output. The request is now snapshotted before the loop can grow it.
- 680268e: Stop sending the app's tool definitions to PostHog. `$ai_tools` shipped the whole catalogue — for a large app, dozens of tools with full descriptions — on every generation, and it is identical on every call. The calls that actually happened are already named in `$ai_output_choices` and carry their own spans.
- 680268e: Report failures at the layer that failed, and never as a bare flag. `$ai_is_error` could travel without any `$ai_error` — every failed tool span did exactly that with the default `captureToolResults: false`, so PostHog showed "error" and nothing else. All three emitters now fall back to a stated reason, add PostHog's `$ai_error_type`, and say when a tool's error text was withheld rather than never reported. The levels mean distinct things: a generation is failed only when the model call itself failed (a provider error or a stream dropped mid-call), a span when the tool crashed or returned an error, and the trace for everything else — step budgets, timeouts, no-progress cut-offs. A tool that stopped the run no longer marks the model call that preceded it as failed, and a run's terminal outcome rides only the layer that actually failed.
- 680268e: Send each PostHog event's own time at the payload root instead of inside `properties`, where PostHog treated it as an ordinary custom property and stamped the event with its ingestion time. An agent run emits its trace, generation, and every tool span in one burst when the run ends, so a five-minute run rendered as a 100ms waterfall with its steps in flush order rather than the order they ran.
- 680268e: Emit one `$ai_generation` per model round-trip instead of one per run, and parent each tool span under the generation that requested it. A multi-step agent run rendered in PostHog as a single generation spanning the whole run — a 15-call, 5-minute run drew one 5-minute "model call" — because the run's aggregate usage was reported as if it were one request. Each generation now carries its own prompt, answer, tools, latency, tokens and cost, and `$ai_request_count` counts that call rather than the run, so per-request pricing is right. Run totals (`llm_calls`, `tool_calls`, `successful_tools`, `failed_tools`, `time_to_first_token_ms`, `latency_source`) moved to `$ai_trace`. An engine that never brackets its calls with `model_stream` still falls back to a single aggregate generation. The trace no longer carries `$ai_input_state` / `$ai_output_state`: with every round-trip carrying its own prompt and answer, those repeated the first call's prompt and the last call's answer on a second event. A generation is also no longer marked failed when the run failed after the model answered — a tool that aborted the run, a step budget, or a cut-off now shows on the tool span and the trace, not on a model call that succeeded.
- 680268e: Three fixes to per-round-trip generations. A tool the run's death interrupts is now associated with the call that requested it — the association is recorded when the tool starts, since an interrupted tool never reaches the completion path and used to hang under the trace root, missing from its generation's counts. A model call the provider failed is marked failed even though its stream bracket closes on the way out, so a provider error is no longer reported as a healthy call and a retry no longer leaves the failed attempt green. And a call that reported its tokens keeps them when a later call throws: usage was gated on the loop's aggregate return value, which never arrives on a throw, so every call that had succeeded lost its tokens and cost.
- 680268e: Report `$ai_stop_reason` on each generation, and stop discarding an oversized trace payload wholesale. The engine already knew why every model call ended (`end_turn`, `tool_use`, `max_tokens`, …) and never passed it on, so a truncated answer was indistinguishable from a finished one; the `model_stream` close event now carries it. Content over the 128KB ceiling used to be replaced entirely by a placeholder — a 244KB conversation left nothing at all in the trace. An oversized message list now keeps the last user message behind a marker naming how much was dropped — what was asked is what a trace is opened for, and it stays small. `input_truncated` / `output_truncated` still mark anything cut, so a partial payload can never read as a complete one.

## 0.172.3

### Patch Changes

- 0fedac0: Prebundle `diff-match-patch` so the collab text-to-Yjs path loads in the browser.

  `diff-match-patch@1.0.5` ships one CJS file with no ESM entry. It is reached from
  `collab/text-to-yjs.ts`, which in monorepo dev mode is a source-aliased core
  module excluded from dep prebundling, so Vite never scanned the import and served
  the dependency verbatim — its trailing `module.exports` lines threw in the
  browser. It now has a default `optimizeDeps.include` entry like the other CJS
  dependencies core reaches from client code.

## 0.172.2

### Patch Changes

- f208c0e: Stop later tool calls in the same assistant message from running while an action
  waits for human approval.

  The approval gate told the model "the turn is paused" and set
  `requestedActionStop`, but that flag is only read after the tool loop finishes.
  The flag that actually suppresses the remaining calls is `turnYieldedToUser`,
  which the approval path never set — so on `[write(needs approval),
delete(no approval)]` in one message, the human saw an approval card for the
  first while the second had already executed. The approval branch now yields the
  turn like any other action that hands control to the user, and the message shown
  for a suppressed call names the approval case as well as the ends-turn case.

  A gated call is also no longer eligible for parallel batching. `flushParallelBatch`
  dispatches a batch through `Promise.all`, so a gated call and its siblings all
  start before the gate is reached and the suppression lands too late to stop a
  sibling that already ran. Any action declaring `needsApproval` or `endsTurn` is
  now serialized, which is what makes the suppression meaningful for the calls
  after it.

## 0.172.1

### Patch Changes

- bad078e: Expose developer resources, explicit when-to-use guidance, and complete Markdown cache headers in generated agent-web surfaces.

## 0.172.0

### Minor Changes

- 5da9484: Add durable action-level approval preferences and recoverable harness checkpoints.

### Patch Changes

- bd7384b: Scope sidebar toggle events to the matching app chat surface.
- 4fa0d0c: Harden the shell command policy and the untrusted-text prompt boundaries.
  - `classifyCodeAgentCommandPermission` now matches its blocked and
    approval-required rules against the quote-stripped form of the command as well
    as the raw text. The shell removes quoting before the command word exists, so
    `git 'checkout' main`, `gi''t checkout main`, `drizzle-kit "push"` and
    `rm -'r'f /` previously ran as unclassified writes. A command using `$'…'`
    escaping, which this pass cannot decode, now asks for approval instead of
    falling through.
  - `runCodingCommand` settles on `exit` with a short grace for `close` instead of
    waiting on `close` alone, and spawns detached so a timeout signals the whole
    process group. A command that backgrounds anything (`npm run dev &`) left a
    grandchild holding the output pipe and the call never returned — past its
    timeout too, whose `SIGTERM` went to an `sh -c` wrapper that had already
    exited. When output is cut short this way the result says so rather than
    reading as a clean finish.
  - Automation trigger payloads are capped, wrapped in `<event_payload>` tags with
    an explicit untrusted-data instruction, and no longer sit ahead of the
    automation's own body — the same defense `condition-evaluator.ts` already
    applied before this data reached a tool-less classifier, now applied on the
    path that reaches an agent with the full tool surface.
  - Prompt `<resource>` blocks escape both halves of the fence in the body, so
    shared `AGENTS.md`/`LEARNINGS.md` content cannot forge a block header and pass
    itself off as framework instructions.

## 0.171.3

### Patch Changes

- 2292fac: Allow shared loading spinners to provide localized accessible labels.

## 0.171.2

### Patch Changes

- 3afcb54: Add pin, reorder, and reload actions to workspace app rail context menus.

## 0.171.1

### Patch Changes

- c56a23e: Preserve explicitly safe stopped-action error codes and details across browser action transport.

## 0.171.0

### Minor Changes

- f60345d: Add `auth.requireEmailVerification` to the app config schema, aliased to
  `AUTH_REQUIRE_EMAIL_VERIFICATION`, so a deployment can state its password-signup
  verification policy instead of inheriting the environment-derived one.
  `AUTH_SKIP_EMAIL_VERIFICATION` stays a local/QA-only convenience that hosted
  deployments ignore; a declared value outranks it. Setting the field to `false`
  accepts an unverified address as a login credential and therefore also lifts the
  hosted no-email-provider signup lock, which exists to prevent exactly that;
  setting it to `true` where no email provider is configured disables password
  signup rather than stranding accounts on a verification that cannot be delivered.

### Patch Changes

- f60345d: Stop the dev server from warning that the `agent-native-config` plugin set both `rollupOptions` and `rolldownOptions`. Vite 8 exposes `rollupOptions` as a getter alias of `rolldownOptions`, and spreading the incoming `build` / `optimizeDeps` sections copied that alias back out alongside our own `rolldownOptions`.

## 0.170.0

### Minor Changes

- 185cd15: Add managed, service-specific Google OAuth connections with personal or workspace sharing.
- ac1b0df: Let a deployment refuse framework default plugins and narrow which integration
  platforms mount, without writing a stub plugin file.

  `plugins.disabled` (env `AGENT_NATIVE_DISABLED_PLUGINS`) names default plugin
  slots the framework should not auto-mount — the same list that shows up as
  `[agent-native] Auto-mounting N default plugin(s)` under `DEBUG`. It is honored
  by the runtime bootstrap and by the generated edge worker entry, so a slot is
  withheld on every host. An app that ships its own `server/plugins/<slot>.ts` is
  unaffected.

  `integrations.platforms` (env `AGENT_NATIVE_INTEGRATION_PLATFORMS`) is an
  allow-list of platforms for the integrations plugin, matched against each
  adapter's `platform` id. Unset mounts every adapter, as before; a name no
  adapter provides throws at plugin init rather than silently mounting a set
  nobody asked for.

  Both switches withhold registration rather than reject at request time: a
  refused slot never runs its plugin, so its routes are absent from the
  middleware chain and its background jobs and pollers never start. The
  allow-list now also gates the routes mounted under a platform's literal name —
  `/slack/interactions`, `/slack/manifest`, and the two Slack OAuth endpoints
  previously stayed mounted whatever the adapter set was. They are gated only
  when `integrations.platforms` is declared, so a deployment that does not set it
  keeps today's behavior.

  A misconfigured value in either switch is reported, not absorbed. An unknown
  slot name in `plugins.disabled` fails at `getH3App()` rather than inside the
  best-effort auto-mount catch, and the allow-list mismatch throws a typed
  `AppConfigurationError` that the auto-mount catch rethrows — otherwise a typo
  left the deployment reporting success with whole route trees missing.

### Patch Changes

- 0dc3cdd: Add `mcpTool` and `important` to `defineAction`, so an action declares its external-agent exposure and its first-request tool slot beside itself instead of in a plugin-level name list. `mcpTool` defaults to `agentTool`, so hiding an action from the agent hides it from outside agents too; declaring it overrides that inheritance in both directions. `mcpTool: false` hides an action from every MCP tier and the direct A2A surface (including the `--full-catalog` opt-in) while the in-app agent keeps calling it, `mcpTool: true` is the action-owned form of `mcp.connectorCatalog` membership, and `agentTool: false` with `mcpTool: true` makes an action MCP-only — external agents get it, the app's own agent does not. `deferLoading: false` keeps an action in the agent's first tool list and narrows the derived default to the actions that opted out of deferral, the action-owned form of `initialToolNames`; `deferLoading: true` pushes one behind `tool-search`. Both name lists keep working, so an app can migrate one action at a time.
- c595519: Fix the chat-first workspace apps rail's active app having no visible selection indicator in both the collapsed and expanded rail layouts.
- af1b3bb: Stop a transient boot failure from permanently breaking sign-in. `getBetterAuth()` cached its init promise before that promise settled, so one failed
  initialization — a busy SQLite file, a momentary pool error — was replayed as a rejection to every later caller for the life of the process, and the only
  recovery was a restart. The failed attempt is now cleared so the next request re-initializes.

  Also in the local-SQLite boot path: Better Auth opens the database through the shared `prepareLocalSqliteUrl()` / `sqliteFilenameFromUrl()` pair instead of
  trimming the `file:` prefix by hand, so on serverless runtimes it lands on the same writable file as the app; and the `journal_mode = WAL` pragma is retried
  on `SQLITE_BUSY` the way its documented sibling in `db/client.ts` already is.

  Separately, the injected beta environment switcher opened its stylesheet with a bare `color-scheme: dark;` declaration. A declaration at stylesheet top level
  is not a parse error that ends at its semicolon — the next qualified rule's prelude absorbs it, so `.environment-switcher` was dropped entirely and the badge
  lost `position: fixed`, rendering in normal flow at the bottom-left of the page instead of pinned to the viewport corner.

- c595519: Fix `get-auth-methods` returning a 401 for callers the framework authenticated without a Better Auth session cookie (e.g. AUTH_DISABLED dev sessions), which made the Account settings password row always show the no-password state.
- 163d02c: Center the beta badge hide control and balance its surrounding spacing.
- 1253471: Route new-user magic-link callbacks before the generic handler so signup links with nested query parameters do not receive a 405.
- 9735e4d: Add localized fallback labels for the desktop agent picker mode options.
- c595519: Fix the Builder connection-status route's OAuth-custody branch silently reporting a failed key-pair lookup the same way as confirmed-absent keys, by resolving the detailed credential lookup and surfacing a distinct `keyLookupFailed` flag.
- da0e7b8: Builder OAuth now relies on the shared credential lifecycle for refresh single-flight and reconnect state instead of duplicating them in `settings` rows. The `builder-oauth-refresh:*` lease and `builder-oauth-reconnect:*` flag are gone; a failed refresh latches `reconnect_required` on the credential itself. Adds `markOAuthReconnectRequired` (and the `markMcpOAuthReconnectRequired` MCP wrapper) so a server-side 401/403 rejection can force reconnect through the credential rather than a side channel.

  Builder OAuth is scoped to the caller's organization: every member of an org shares one Builder connection and token, resolved from the authenticated user's own org membership. Every user belongs to an org, so there is no per-user fallback — a missing org is a broken invariant that fails loudly rather than silently creating a personal connection. Previously every user shared one `account_id`, so under the `(provider, account_id)` primary key only the first person to connect could hold a grant and everyone else was refused.

  Because the grant is shared, connecting (which overwrites it) and disconnecting (which revokes it for everyone) require org owner/admin authority.

- 6c2e431: Show a terminal raw-source error when a persisted registry block cannot hydrate instead of leaving it indefinitely loading.
- baedb60: Fetch the headless browser at launch instead of embedding it in every serverless function. `@agent-native/creative-context` now depends on `@sparticuz/chromium-min` (46KB) rather than `@sparticuz/chromium` (66.4MB), and passes a version-pinned pack URL to `executablePath()`. The hosted Builder Browser path is unchanged and still preferred; this only affects the local-launch fallback, which now downloads the pack once per container. Set `AGENT_NATIVE_CHROMIUM_PACK_URL` to serve the pack from your own mirror. Measured on slides: server function 126.0MB → 59.6MB, total upload 243.8MB → 111.0MB.
- c595519: Fix the shared `code` and `code-tabs` block specs so inserting one from a slash menu seeds real content instead of an empty `__raw` string — previously the freshly inserted block got permanently stuck on "Loading code block…" (or a terminal load error) because neither spec had an `empty()` factory.
- aba438a: docs: correct the Clips Rewind documentation. Rewind is Clips' own local rolling recording, not a rewind.ai integration, and the pre-roll section is renamed to the product's "Add what happened before" and nested under Rewind.
- baedb60: Stop shipping `better-sqlite3` in serverless function bundles. It is a local-development driver: every consumer is gated on a `file:` or schemeless `DATABASE_URL`, and a serverless function holding a file-backed SQLite database is already broken, since the filesystem is ephemeral and each container gets its own copy. Denying the package turns that misconfiguration into a loud failure instead of a silently empty database. The denylist applies to the netlify, vercel and aws-lambda presets only, so local development is unaffected. ~1.9MB per emitted function dir.
- c595519: Fix the dev-server speculation-rules endpoint 404ing on the browser's real `Sec-Fetch-Dest: speculationrules` auto-fetch, logging a console error on every page load in `pnpm dev`.
- 43c4adb: Allow transactional email definitions to re-register after a development hot reload while still rejecting conflicting catalog metadata for the same id. Add atomic, app-owned snapshot registration so conflicting or deleted catalog entries cannot leave partial or stale definitions behind while owned metadata changes refresh safely.
- c595519: Fix EnvironmentBadge causing a React hydration mismatch on public SSR pages by deferring its content to a post-mount effect instead of branching on `typeof window` during render.
- 8f6fd63: Shorten production lane opt-out to eight hours, add a per-page badge hide control, and support `?force=true` for a browser-session production override.
- cdd69e8: Stop background polling and event streams in app surfaces an embedding host has hidden. An Electron `<webview>` guest keeps reporting `document.visibilityState === "visible"` while its element is `display: none`, so every visibility-based pause in the client was inert inside the desktop shell and each backgrounded app tab kept polling at its foreground cadence and holding its event stream open. Hosts can now declare visibility explicitly with `buildSurfaceVisibilityScript`, and `useDbSync` treats a host-hidden surface as paused regardless of `pauseWhenHidden`.
- 1390bed: Use production agent URLs for stale localhost peer manifests on every hosted runtime, including beta Netlify functions.
- 49a2ab5: Honor explicit sidebar-open deep links and ignore stale loopback remote agents in hosted runtimes.
- c759425: Restore the loud failure when an unresolved `getDb()` query chain is embedded as a raw value instead of being awaited. drizzle duck-types SQL entities by reading `getSQL`/`shouldOmitSQLParens` synchronously, so the lazy cold-start proxy answering that probe with another proxy produced `RangeError: Maximum call stack size exceeded` deep inside drizzle instead of naming the misuse. The guard was lost as collateral in a wholesale revert of `packages/core/src/db`.
- 8be5618: Cut seconds off chat list reads and serverless cold starts.
  - `listThreads`/`searchThreads` no longer filter on `thread_data`. Matching that
    blob detoasted the entire message history for every scanned row before `LIMIT`
    applied; measured on production beta, the same 20-row response went 2207ms →
    222ms with the predicate removed. Schema migration 3 backfills
    `source_platform` for the legacy integration rows the predicate used to catch.
  - Added expression indexes for the access-scoping predicates that wrap columns in
    `LOWER()` — `chat_threads`, `chat_thread_shares`, and `token_usage`. A plain
    btree cannot serve a function-wrapped comparison, so these lists were scanning
    whole shared tables.
  - Moved `clientAbortReason` into a leaf module so the agent chat server plugin no
    longer pulls the agent run loop into its static import graph. That graph costs
    ~1.2s to evaluate and every cold serverless start paid it, including requests
    that only render a page.

- 7a87f76: Build the `LOWER(...)` expression indexes without `CONCURRENTLY`.

  The release schema step runs over the pooled Neon endpoint, and a
  transaction-pooled connection cannot carry `CREATE INDEX CONCURRENTLY` to
  completion. The statement returned without creating the index, the verifying
  probe then failed the whole release, and every docs production deploy was
  blocked. Plain `CREATE INDEX` is the form that actually lands here.

- ee03f3c: Fix PostHog LLM analytics events so trace, span, and generation metrics match PostHog's schema and aggregation.
  - `$ai_time_to_first_token` is now sent in seconds. It was being handed the millisecond value verbatim, inflating every time-to-first-token in LLM analytics 1000x.
  - The `$ai_trace` event no longer carries `$ai_latency`, `$ai_input_tokens`, `$ai_output_tokens`, or `$ai_total_cost_usd`. PostHog derives all four from a trace's children, and summed the trace's own `$ai_latency` alongside them — reporting roughly twice the real run duration. The run totals now ride along as `duration_ms`, `input_tokens`, `output_tokens`, and `cost_usd` for backends that do no such aggregation.
  - The generation's `$ai_latency` is measured model time rather than the whole run, so tool duration is no longer counted both in the generation and in its sibling tool spans. It is read from the `model_stream` start/end brackets the agent loop already emits once per LLM round-trip, which close before any tool of that turn starts. Engines that do not bracket their model calls fall back to backing tool time out of the run duration — counting overlapping tools once, and leaving in the time of tools that `captureLlmSpans` or the per-run span cap keeps out of PostHog, since no sibling span would carry it. The new `latency_source` property records which of the two produced a given `$ai_latency`.
  - A tool `$ai_span` is timestamped at the tool's start rather than its completion. PostHog draws a span forward from its event timestamp by `$ai_latency`, so a completion-stamped span rendered the tool beginning where it ended and running past the end of its own trace.
  - `$ai_request_count` reports the run's real LLM round-trip count instead of a hardcoded `1`, which undercharged multi-step runs on request-priced models.
  - `$ai_trace` now carries `$ai_input_state` / `$ai_output_state` when `capturePrompts` is on. PostHog reads a trace's input and output only from that event, so the trace detail view was empty.
  - Successful tool calls now record their result on the span under `captureToolResults`, so a healthy tool span reports an output instead of looking like a tool that returned nothing.
  - AI events are stamped with when they happened rather than when the run flushed. `track()` accepts an `occurredAt`, so a trace tree keeps a real timeline instead of collapsing into one instant.
  - `$ai_stream` is set, which is what makes `$ai_time_to_first_token` meaningful.
  - Custom properties no longer use an `$ai_` prefix (`$ai_input_truncated` → `input_truncated`, `$ai_spans_dropped` → `spans_dropped`). That namespace is PostHog's schema and a name it does not define today it may define tomorrow.

- 6078255: Stop shipping unreachable browser and SSR modules in scheduled-sweep function clones, and deny-list puppeteer. `pruneBrowserRuntimeFromNonAgentClone` drops `@sparticuz/chromium` and `playwright-core` from a clone whose entry rewrites the pathname to a route that cannot reach an agent turn — it throws rather than guessing when the entry names an agent-capable path, because the browser is loaded through a non-literal dynamic import that no static walk can prove dead. Analytics' six cron sweep clones each shed 87.5MB. Separately, `puppeteer`, `puppeteer-core` and `chromium-bidi` join the serverless package denylist: Nitro traced them from officeparser's PDF-output branch, which nothing in this repo reaches.
- 6e647cb: Stop shipping the SSR page/asset module island inside the background and integration-recovery function clones. Those entries overwrite `url.pathname` unconditionally before delegating to `main.mjs`, so they can never route to the page or asset handlers they inherited — yet Netlify zips and uploads every function separately, so the island was paid for on every deploy. The pruner walks the clone's real import graph (including backtick dynamic imports) and refuses to prune at all when a relative dynamic import cannot be resolved statically. Measured on calendar: total upload 42.2MB → 35.8MB.
- 9f4efc1: Prevent the environment badge from changing the server-rendered tree before hydration completes.
- 9895d21: Keep Builder design-system hydration in progress until the provider confirms completion, including explicit status metadata from docs responses.
- cc4d122: Hide managed Google OAuth integrations and onboarding until the shared client credentials are available.
- d14cffb: Revert keep-warm concurrency. Measured on production and it changed nothing:
  before 8/10 requests cold, after 9/10 and 8/10, and 6/6 cold at 25s spacing.
  Netlify does not hold these containers long enough for warming to matter — a
  container is reused at a 2s gap and already cold again by 8s — so no cron
  cadence or concurrency can help. Restores one warm request per minute rather
  than paying 3x the scheduled invocations and health-probe round trips for no
  effect.
- cbc95d4: Avoid loading full workspace resource content during metadata list reads.
- 628b822: Remove the in-loop no-progress watchdogs, which were failing healthy runs far more often than they caught wedged ones.

  Two 90s bounds ran for the whole model stream — one on silence between engine frames (`MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS`), one on a tool input whose byte count stopped growing (`ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS`) — plus a zero-byte tool-input restart tripwire. Each inferred a dead stream from the absence of a particular event, and that inference cannot be made on the Anthropic transport: the SDK drops the provider's `ping` keepalives before any consumer sees them (`core/streaming.js`: `if (sse.event === 'ping') continue;`, with no opt-out), so a model composing a large tool argument is indistinguishable from a wedged socket.

  That is normal operation, not an edge case. Only a tool declared for eager input streaming emits anything at all while its arguments are generated, so a long file write or a long structured result is a content-silent window whose length is set by the size of the argument. In one production deployment, 2 of 27 one-shot analyst runs completed; the guards added for reliability were the thing taking it away.
  - `ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS` and its deadline are gone, including the `earliestStartedAt` fallback that anchored the bound to a start time it never advanced past, and the `Math.min` that let it override a demonstrably live stream.
  - `MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS` and its deadline are gone.
  - The zero-byte restart tripwire is gone (`ACTION_PREPARATION_ZERO_BYTE_RESTART_LIMIT`, `noteZeroByteToolInputStart`, `resetZeroByteToolInputRestart`).
  - The two run-lifecycle invariants asserting an ordering between those bounds and the run-manager backstop are gone with them.

  One in-loop bound survives: the pre-first-frame cap on the clamped hosted foreground runtime, where the ~57s platform wall arrives before the engine's own 120s abort could. The first real frame releases it, so long first tokens, long thinking, long tool inputs and long outputs are all past it by construction; off that runtime there is no in-loop deadline at all.

  Real failures keep the bounds that key off evidence rather than absence: the engine's `FIRST_STREAM_EVENT_TIMEOUT_MS` for a stream that opens and never speaks, the run-manager backstop outside the stream, the per-tool execution timeout, the chunk/run budget, and the stale reaper. The trade is explicit: an in-stream wedge after the first frame is now caught by the run budget rather than at 90s, because no clock in the loop could tell it apart from a model writing a large tool call.

  Separately, `runAgentLoop` now takes the caller's real chunk budget instead of re-deriving one. It asked `resolveRunSoftTimeoutMs` for the generic background ceiling (13 min) even when the caller was a background automation, whose budget is its own hard abort minus headroom (10 min − 20s). The per-tool ceiling came out above the run budget, so every per-tool timeout on that path was dead code and the chunk boundary won instead — the exact inversion `RUN_TOOL_TIMEOUT_HEADROOM_MS` exists to prevent, reintroduced by guessing at a number the caller already had.

  Also records liveness forensics when a stale reaper flips a run to `errored`. `stale_run` is the largest terminal outcome on the one-shot automation path and the row said nothing about why — `error_detail` is a fixed sentence for every reap, so a correct reap and a false one were indistinguishable afterwards. The reap now records which of the three stale windows applied, whether the row was redispatchable, time since heartbeat and since progress, whether the in-flight grace was in play, and — the discriminator — how far the heartbeat ran AHEAD of the last real progress. A worker that died takes its heartbeat with it and scores ~0 there; a worker still alive while the agent loop stopped producing scores in the thousands of seconds. Those are opposite bugs that look identical in `agent_runs` today. Diagnostics only: nothing reads it to make a decision, it cannot change whether a row is reaped, and it shares the single `diag_stage` write with the existing recovery outcome rather than overwriting it.

  Also gives the direct-provider engines the total-request deadline they never had, and the resumed rounds the budget they actually have. `createFirstEventAbortController` is now two-stage: the first real frame releases the 120s first-event bound and arms a 14-minute `STREAM_TOTAL_TIMEOUT_MS` on the whole call, mirroring what builder-engine already applies to its own gateway requests. That matters for the runtimes with no outer budget — local dev and self-hosted resolve the soft timeout to `0`, so the deleted watchdog was the only thing standing between them and a socket that wedges after the first frame. It is a total-request bound, not a no-progress bound, so it cannot fire on healthy content-silent generation. The AI SDK path now also reports a deadline abort as an error rather than letting it fall through as a clean `end_turn`, which is a truncated turn reported as a complete one. Alongside it, `runAgentLoopWithResume` hands each round its own `roundTimeoutMs` rather than the whole invocation's, and the main chat handler passes the chunk budget it already resolved into the loop instead of leaving it to re-derive a generic ceiling — the same inversion as the automation case, two call sites over.

  A cancelled request is also no longer classifiable as a timeout. `fireTimeout` recorded its message before checking whether the composed controller had already been aborted, and the parent-abort path left the deadline armed — so a timer firing while the provider settled after a user Stop or a run-budget abort set `didTimeout()`, which is exactly what the engines read to decide a failure was the transport's fault and retryable. The ordering was pre-existing, but harmless while the first frame cleared the timer outright; a deadline that now runs for the whole stream made the window the whole stream. A timeout is recorded only when this controller wins the abort race, parent cancellation clears the deadline, and a frame that lands after a Stop cannot re-arm one.

- 41aa6e2: Let a manual automation run target a resource path, including the generic `run-automation-now` action and manage-automations `run-now` tool, so automations nested under `jobs/` (such as per-factory jobs) can be run immediately instead of failing with "A valid automation name is required." Preserve application-owned frontmatter when automation status is written back after a run, and dispatch local runs back to the inbound request host when present.
- efbde51: Cut and ratchet serverless function payload size.
  - Replace `better-sqlite3` with a throwing stub in serverless function bundles.
    Every consumer is gated on a `file:` or schemeless `DATABASE_URL`, and a
    function holding a file-backed SQLite database is already broken — the
    filesystem is ephemeral and each container gets its own copy. The stub drops
    the 1.9MB native binding from every emitted function and turns that
    misconfiguration into a loud, specific error instead of a silently empty
    database. Only the netlify, vercel and aws-lambda presets are affected; local
    development against a `file:` URL is unchanged.
  - Run an app's `scripts/prune-serverless-functions.ts`, when it exists, as part
    of `agent-native build` rather than leaving it to be chained afterwards. The
    build's function size report and budget previously measured a directory that
    app-owned pruning then changed, reporting sizes up to 19MB above what
    actually shipped.
  - Drop the orphaned dependency closure when the serverless browser runtime is
    pruned from a clone that can never run an agent turn. Deleting the two known
    directories left packages behind that existed only because
    `@sparticuz/chromium-min` or `playwright-core` needed them; the prune now
    walks the closure and removes what nothing still-present depends on.

- c595519: Fix `SettingsTabsPage` merging tabs into duplicate, non-adjacent settings nav sections (with duplicate React keys) whenever a different group's tabs sat between two tabs sharing the same group id.
- af1b3bb: Derive the chat model selection localStorage key through one exported helper, `chatModelSelectionStorageKey`. `useChatModels` takes the raw key while `MultiTabAssistantChat` takes only the namespace suffix, so a hero composer that passed the same string to both wrote to a different key than the chat beside it and never saw its model picks.
- af1b3bb: Show a retryable error in the share popover when the shares read fails, instead of leaving the panel in a permanent loading skeleton.
- 6e647cb: Cut serverless function payloads across every app. `@xterm/*` is now stubbed out of the SSR graph by default (it is only reachable through a `React.lazy` boundary the server can never take), and `formatExtensionHtml` loads `prettier/standalone` plus the four plugins the HTML printer actually reaches instead of prettier's main entry, which `import()`s all 13 parsers and inlines ~3.5MB of flow/typescript/yaml parsers. Measured: calendar 46.7MB → 21.1MB, docs 51MB → 26MB.
- baedb60: Trim dead weight from every serverless function: skip the six Bare-runtime-only packages the browser tree declares but Node can never load, delete playwright-core's trace viewer / HTML reporter / codegen recorder / CLI (`lib/vite`, `lib/tools`, `bin`, `cli.js`), and strip `.d.ts` files from bundled `node_modules` — no runtime resolver reads the `types` condition. Measured on slides: playwright-core 13MB → 7MB, total upload 268.7MB → 247.6MB.
- Updated dependencies [6c2e431]
- Updated dependencies [af1b3bb]
- Updated dependencies [c595519]
- Updated dependencies [9735e4d]
- Updated dependencies [15b86eb]
  - @agent-native/toolkit@0.16.11

## 0.169.1

### Patch Changes

- 4de4af3: Point missing-provider recovery errors to Settings > Agent > AI providers.
- 4de4af3: Keep Dispatch workspace-app URLs shareable by seeding embedded apps from deep links and reflecting child route changes in the Dispatch URL.
- 4de4af3: Stop shipping the 9.3MB libsql native driver to deployments that never load it. `copyInstalledLibsqlNativePackages` ran unconditionally for netlify/vercel/aws-lambda, unlike its Chromium sibling which is gated on a real consumer probe. It is now gated the same way, on whether the emitted bundle actually imports the bare `libsql` addon — the only gate that cannot be wrong, since `getDialect()` reads `DATABASE_URL` at runtime and build-time dialect is unknowable. The one importer in the server graph was the `db-check-scoping` maintenance script, which now uses the existing `createSqliteScriptClient` (dynamic `better-sqlite3` / `@libsql/client/web`) instead of the static node entry. Measured on the docs app: server function 55.9MB → 46.6MB.
- Release all public npm packages with a patch version bump.
- 4de4af3: Keep chat turns queued through transient server-run handoffs and delay missing-final warnings until the run state settles.
- 4de4af3: Show the Connect AI setup for desktop chat relay failures and keep other recovery actions compact.
- Updated dependencies
  - @agent-native/recap-cli@0.5.8
  - @agent-native/toolkit@0.16.10

## 0.169.0

### Minor Changes

- c90e034: Make background agent runs recoverable, observable, and tunable.

  A scheduled or queued automation runs the agent loop in-process, with no HTTP
  body to re-POST and no server-driven continuation behind it. The run manager's
  no-progress backstop nevertheless checkpointed for a continuation nobody was
  going to run: it aborted the run's top-level controller, which is the same
  signal the in-invocation recovery loop is gated on, so a healthy run that went
  quiet for 150s between a completed tool and the next token was recorded as a
  terminal `no_progress` failure.
  - A checkpoint on a run that opts into `recoverChunkBoundaries` now ends the
    CHUNK, not the turn. `runAgentLoopDirectWithSoftTimeout` accepts the
    `RunChunkControl` `startRun` hands its `runFn` and continues, using the
    continuation budget that was already there. A user Stop, a hard timeout, and
    the cross-isolate abort check still end the turn immediately.
  - The background automation runner is instrumented with `instrumentAgentLoop`,
    so scheduled runs produce `$ai_trace` / `$ai_span` events and local trace-store
    rows under their real owner instead of nothing. `instrumentAgentLoop` gained a
    `spanName` option and now forwards `metadata` to PostHog, so an automation is
    identifiable there.
  - Boundaries are recorded: a `run_boundary_reached` diagnostic naming the
    segment that went silent, an `agent_run_boundary` analytics event dimensioned
    by reason and by whether a continuation followed, and a `captureError` for a
    checkpoint that terminates a run.
  - `automation_runs` gained an `error_code` column, written from the code the
    failure taxonomy already computed. That code, and the run's duration, now ride
    the existing `automation.run.finished` event — which already fires from every
    path that records a terminal outcome (the runner, the scheduler's dispatch
    failures, remote execution), and is therefore the terminal hook an application
    needs.
  - The run-lifecycle bounds live in one place each, beside the ordering
    relationships that constrain them, and those relationships are asserted. Two
    are configuration — `agent.backgroundRunHardTimeoutMs` and
    `agent.backgroundNoProgressTimeoutMs` — because those are facts about the host
    and the deployment; the rest stay constants, because a number with two homes
    needs a test to keep them in step and that test is the tell that it should
    have had one home. The background no-progress default is clamped to the chunk
    it guards, so lowering the global soft timeout cannot leave it unreachable.
  - On a run that recovers boundaries in-invocation the run manager no longer arms
    its own soft-timeout timer: the agent-loop wrapper already races that same
    wall with a cumulative per-round budget, so a second timer fired exactly when
    the wrapper had nothing left to continue with. One wall, one clock.
  - Trace finalization can no longer alter the run it observes. Assembly ran
    unguarded inside a `finally`, where a throw replaces the block's result — so a
    malformed payload could report a completed run as failed. That check
    catches the pair that shipped violated: the automation runner took a 13-minute
    chunk budget under its own 10-minute hard abort, so its recoverable boundary
    was dead code. The runner now derives that budget from its own hard abort.

- c90e034: Give the continuation-chain guard and stale-run recovery one turn-run budget.

  The ceiling on run rows for a logical turn was written three times: the chain
  bound `MAX_BACKGROUND_RUN_CONTINUATIONS` (20), an inline
  `turnRunCount > MAX_BACKGROUND_RUN_CONTINUATIONS + 5` in `production-agent.ts`,
  and a hand-maintained literal `25` in `run-store.ts` whose own comment asked the
  next editor to keep it in sync, because importing back would have been circular.

  The cycle is gone now that the base value is configuration and `app-config`
  imports no agent code, so both sites read `resolveTurnRunLedgerBudget()` with
  the slack named `TURN_RUN_LEDGER_SLACK` and its reason recorded: the two bounds
  count different things — handoffs a chunk decided to make versus every run row
  the turn produced, including sweep redispatches and recoveries — which is why
  the ledger must sit strictly above the chain bound. A spec pins the
  relationship.

  Both call sites compared `turnRunCount > budget` while the current run's row was
  already inserted and counted, and the successor's row is inserted after the
  check — so at equality they permitted one row past the documented ceiling. They
  now call a `turnRunLedgerExhausted()` predicate, so the two cannot disagree
  about the boundary again.

  Also removes `DEFAULT_BACKGROUND_RUN_SOFT_TIMEOUT_MS`, an exported alias for
  `BACKGROUND_SOFT_TIMEOUT_CEILING_MS` with no source caller; use the ceiling (or
  `resolveBackgroundSoftTimeoutCeilingMs()`) directly.

  No behaviour change: every resolved value is what it was.

### Patch Changes

- c90e034: Enforce the client-above-server follow budgets against resolved configuration.

  The browser's per-turn follow budgets must stay above the server's own ceilings,
  because the client fires on a clock and cannot tell looping from working while
  the server can. They shipped inverted once — 10 min / 6 runs against a 13-minute
  legal chunk — and killed healthy turns the server was still streaming, which was
  the top non-auth cause of "the chat just stopped".

  That relationship was pinned in `agent-chat-adapter.spec.ts` against the
  server's module constants. Making those constants configurable moved the real
  values out from under the test without moving the test: a deployment could raise
  `maxTurnWallClockMs`, `maxBackgroundRunContinuations`, or
  `backgroundSoftTimeoutCeilingMs` past what the shipped client can follow, and
  every check still passed.

  The client budgets now live in `app-config/run-lifecycle-invariants.ts` (which
  has no runtime imports, so the browser bundle is unaffected) and
  `assertRunLifecycleInvariants` asserts all three relationships against the
  resolved configuration. The spec keeps pinning the defaults — one fails fast on
  a bad default, the other on a bad deploy.

  Comparing the configured numbers alone also hid a real inversion in the shipped
  values, so the check now uses the EFFECTIVE server limits: the turn ceiling is
  tested at chunk boundaries, so a turn passing it one chunk short still gets a
  whole further chunk (90min + 13min against a client following 95min), and the
  durable ledger allows the chain bound plus the recovery slack in run rows
  (20 + 5 = 25 against a client following 24). Both were inverted. The client
  follow budgets move to 110 minutes and 30 runs so the shipped defaults are
  consistent; killing a turn that is not progressing is still covered by the 210s
  idle timeout and the repeated-terminal-reason detector, neither of which is a
  clock on the whole turn.

- c90e034: Close two acceptance-criteria gaps from the background-run hardening.

  A hard-aborted run reached PostHog carrying "Agent run was aborted" —
  byte-identical to what a user pressing Stop produces, because the abort is what
  the loop observes and `$ai_error` derives its code from the terminal outcome.

  Fixed at that source rather than per-caller: the agent-loop wrapper now reports
  a server-owned abort reason as a `failed` outcome carrying that reason as its
  code, which is what its own no-timeout path has always done. The code therefore
  reaches `$ai_error` through the existing construction, for every entry point
  rather than just automations. The reason set is an allowlist, not "anything that
  isn't `user`", because the abort route accepts a client-supplied reason string
  and an inverted test would relabel a genuine Stop.

  `backgroundSoftTimeoutCeilingMs` is not merely a bound — it IS the clamp
  `resolveRunSoftTimeoutMs` reduces every background soft timeout to. Making it
  configurable therefore left the one number that keeps a chunk inside the host's
  background-function wall unbounded, so a deployment could raise it past that
  wall and turn every long background turn back into the silent platform kill the
  ceiling exists to prevent. The invariant check now asserts it against
  `BACKGROUND_FUNCTION_WALL_MS` minus the headroom a chunk needs to checkpoint;
  the shipped 13-minute value sits exactly on that margin.

- c90e034: Stop reporting every unlabelled agent run as `foreground`.

  `emitRunTerminalTrackingEvent` defaulted `dispatch_mode` to `"foreground"` when
  a caller passed none — and the interactive chat handler is the only caller that
  passes one. Five others (background automations, agent teams, webhook handlers,
  harness runs, the docs poller) passed nothing, so the default was wrong every
  single time it applied.

  Measured consequence: on one deployment, scheduled and manually-dispatched
  automation runs were failing with `no_progress` at 6 of 7 while interactive chat
  sat at 2 of 190 — and both were labelled `foreground`, so the failing path was
  indistinguishable from the healthy one in the only view where anyone would have
  looked.

  `dispatch_mode` is now absent when the caller did not supply one, so "not
  recorded" and "was foreground" stop being the same value; the background
  automation runner passes the `"background"` it already writes onto its own run
  row; and the durable background worker, which reaches the interactive handler's
  `startRun` call site, reports `"background"` instead of inheriting the
  foreground label from a flag that only describes self-chaining. Passing it cannot disturb the runner's self-claim: `insertRun` is
  `ON CONFLICT DO NOTHING`, so `startRun`'s insert is a no-op for a claimed row.

## 0.168.13

### Patch Changes

- f2f60b9: Move the environment badge to the bottom-left, show a truthful dev badge during configured local development, raise Dispatch controls above it, and give default notifications enough clearance to avoid overlap.

## 0.168.12

### Patch Changes

- 51b31ed: Format localized core documentation after the release sync.

## 0.168.11

### Patch Changes

- dc0978d: Fix action request context to use the forwarded workspace gateway origin instead of the internal dev proxy host.

## 0.168.10

### Patch Changes

- d9b6279: Fix desktop Google sign-in against a local dev server. `X-Agent-Native-Desktop-Verifier` is now in the shared CORS allow-header list used by every preflight short-circuit (the Tauri dev renderer origin `http://localhost:1420` is answered by the dev server, which never reached the auth CORS handler that already allowed the header), and a localhost origin receives `Access-Control-Allow-Credentials` when `NODE_ENV === "development"` so the desktop app's credentialed calls work locally. Production credential rules are unchanged.

## 0.168.9

### Patch Changes

- e5e6934: Automatically replace a missing saved chat thread with a fresh chat in multi-tab hosts.
- e5e6934: Cache 404 and 410 SSR shells with the same public CDN policy as 200 shells. They previously carried `no-cache`, so every dead link, stale bookmark, renamed slug and crawler miss re-invoked the render function — the same URL cost a full cold render on every request. Netlify runs one request per container, so those invocations drew from the account-wide concurrency pool other sites share. 5xx stays uncacheable, and 401/403 are deliberately excluded.
- e5e6934: Add a Google sign-in credential self-check at `/_agent-native/health/google`.

  The callback returns an identical error page for a wrong client secret and a
  stale authorization code, so a broken credential is invisible from outside
  while `/_agent-native/health` keeps reporting `ok:true`. The new route asks
  Google directly and reports `valid`, `invalid`, `unconfigured`, or `unknown` —
  a transport failure is never reported as valid — plus whether the deploy
  carries two credential pairs naming different Google clients.

- e5e6934: Keep desktop app chat immediately available while app tabs load, and allow hosts to start fresh chat threads without restoring history on mount.
- dd80d09: Keep the full workspace credential workflow reachable from the redesigned integrations catalog.
- 127606d: Sync localized overview documentation with the current English guides.
- e5e6934: Refresh integration and Dispatch app surfaces with connected-first layouts and two-column cards.
- e5e6934: Read org-scoped settings with a prefix-scoped query instead of loading the whole settings table. `listOrgSettings` pulled and JSON-parsed every organization's rows into the caller to keep one org's, putting the entire deployment's settings table on the critical path of any org-scoped list read. `listSettingsByPrefix` is now exported from `@agent-native/core/settings` so apps can do the same for their own scoped reads.

## 0.168.8

### Patch Changes

- 81fa180: Show immediate tooltips for apps and navigation controls in the collapsed chat-first rail.

## 0.168.7

### Patch Changes

- a1d24db: Automatically replace a missing saved chat thread with a fresh chat in multi-tab hosts.
- a1d24db: Cache 404 and 410 SSR shells with the same public CDN policy as 200 shells. They previously carried `no-cache`, so every dead link, stale bookmark, renamed slug and crawler miss re-invoked the render function — the same URL cost a full cold render on every request. Netlify runs one request per container, so those invocations drew from the account-wide concurrency pool other sites share. 5xx stays uncacheable, and 401/403 are deliberately excluded.
- a1d24db: Add a Google sign-in credential self-check at `/_agent-native/health/google`.

  The callback returns an identical error page for a wrong client secret and a
  stale authorization code, so a broken credential is invisible from outside
  while `/_agent-native/health` keeps reporting `ok:true`. The new route asks
  Google directly and reports `valid`, `invalid`, `unconfigured`, or `unknown` —
  a transport failure is never reported as valid — plus whether the deploy
  carries two credential pairs naming different Google clients.

- a1d24db: Read org-scoped settings with a prefix-scoped query instead of loading the whole settings table. `listOrgSettings` pulled and JSON-parsed every organization's rows into the caller to keep one org's, putting the entire deployment's settings table on the critical path of any org-scoped list read. `listSettingsByPrefix` is now exported from `@agent-native/core/settings` so apps can do the same for their own scoped reads.

## 0.168.6

### Patch Changes

- 186d913: Allow encrypted public-upload fallback blobs to delete their backing Builder or S3 assets, and fail closed when an explicitly selected private blob provider is unavailable.

## 0.168.5

### Patch Changes

- 60aaea8: Keep app surfaces mounted when a host temporarily disables the chat sidebar.

## 0.168.4

### Patch Changes

- 4e1ce88: Automatically replace a missing saved chat thread with a fresh chat in multi-tab hosts.
- 4e1ce88: Add a Google sign-in credential self-check at `/_agent-native/health/google`.

  The callback returns an identical error page for a wrong client secret and a
  stale authorization code, so a broken credential is invisible from outside
  while `/_agent-native/health` keeps reporting `ok:true`. The new route asks
  Google directly and reports `valid`, `invalid`, `unconfigured`, or `unknown` —
  a transport failure is never reported as valid — plus whether the deploy
  carries two credential pairs naming different Google clients.

- 4e1ce88: Read org-scoped settings with a prefix-scoped query instead of loading the whole settings table. `listOrgSettings` pulled and JSON-parsed every organization's rows into the caller to keep one org's, putting the entire deployment's settings table on the critical path of any org-scoped list read. `listSettingsByPrefix` is now exported from `@agent-native/core/settings` so apps can do the same for their own scoped reads.

## 0.168.3

### Patch Changes

- 97e8cea: Read org-scoped settings with a prefix-scoped query instead of loading the whole settings table. `listOrgSettings` pulled and JSON-parsed every organization's rows into the caller to keep one org's, putting the entire deployment's settings table on the critical path of any org-scoped list read. `listSettingsByPrefix` is now exported from `@agent-native/core/settings` so apps can do the same for their own scoped reads.

## 0.168.2

### Patch Changes

- 8617890: Generate the canonical public stale-while-revalidate headers for Netlify static build artifacts and guard prerendered apps against the platform default cache policy.

## 0.168.1

### Patch Changes

- 07e0de3: Show the personal or workspace scope choice before connecting an integration in an organization, including a clear owner/admin requirement for members.
- 68265a5: Forward hosted provider setup callbacks through `AgentSidebar` so Electron chat can show its native AI connection action after sign-in, and allow the native integrations surface to route OAuth through the authenticated app webview.

## 0.168.0

### Minor Changes

- 6203d5d: Add an About Agent-Native command surface for inspecting deployed framework package versions and diagnostics.

## 0.167.5

### Patch Changes

- d3210d7: Make documented `AGENT_NATIVE_CONFIG_*` environment aliases override typed and JSON public configuration defaults.

## 0.167.4

### Patch Changes

- 8b73951: Isolate workspace app chat history and keep short chat-tab titles clear of the close target.

## 0.167.3

### Patch Changes

- 1aafc1d: Keep authenticated Electron app sessions on their configured production lane instead of applying the browser-only employee beta redirect.
- 40baf42: Preserve browser attribution through Better Auth email signup user creation.
- 1aafc1d: Avoid treating the desktop broker identity as proof that an app's own session is authenticated.

## 0.167.2

### Patch Changes

- 95d9d70: Bound public-site monitor requests and clarify unified-diff framing in visual recap authoring prompts.
- 7f22204: Warn on the Agent Automations page when schedule-triggered automations can never fire — recurring jobs disabled at build time, no durable scheduler on the hosting target, or local development — via a new `get-scheduled-trigger-status` action. The build embeds its recurring-jobs decision into the server bundle so the warning reflects whether a scheduled trigger was actually emitted, and a failed status check is reported as unverified rather than healthy.
- Updated dependencies [95d9d70]
  - @agent-native/recap-cli@0.5.7

## 0.167.1

### Patch Changes

- ca9ee7e: Merge same-day changelog categories without duplicating headings.

## 0.167.0

### Minor Changes

- 3a7a8f0: support deterministic environment aliases and JSON fragments for public Agent-Native config

## 0.166.1

### Patch Changes

- 8fd035c: Keep authenticated Electron app sessions on their configured production lane instead of applying the browser-only employee beta redirect.
- Updated dependencies [10de7b9]
  - @agent-native/recap-cli@0.5.6
  - @agent-native/toolkit@0.16.9

## 0.166.0

### Minor Changes

- c50b009: Allow request action resolvers to preserve the default tool-loading surface.

## 0.165.5

### Patch Changes

- 8d56ed2: Let the Builder gateway engine run on an OAuth-only connection. The pre-run
  credential gate required a `BUILDER_PRIVATE_KEY`/`BUILDER_PUBLIC_KEY` pair, so
  a user connected through Builder OAuth alone had every turn rejected with "No
  LLM provider is connected" while the connect card reported them connected.

## 0.165.4

### Patch Changes

- 841f072: Expand changelog history windows to 100 releases while preserving folder-backed history.

## 0.165.3

### Patch Changes

- b6ca1a7: Warn when `GOOGLE_SIGN_IN_CLIENT_ID` and `GOOGLE_CLIENT_ID` name different Google clients. Sign-in silently preferred the sign-in pair, so repairing `GOOGLE_CLIENT_SECRET` on a deploy that also set `GOOGLE_SIGN_IN_CLIENT_SECRET` changed nothing while appearing correct.
- b6ca1a7: Harden MCP OAuth reconnects for mounted apps, legacy settings, and concurrent updates.
- b6ca1a7: Ensure prebuilt Netlify workspace deployments include the hosted feedback URL.

## 0.165.2

### Patch Changes

- b130f4e: Keep app changelogs compact while preserving folder-backed history in the in-app What's new surface.
- ac3acfa: Improve provider failure recovery and remove the retired Videos template from Dispatch app creation.

## 0.165.1

### Patch Changes

- 43ef3a8: Fix reconnecting existing OAuth-backed MCP servers in place.

## 0.165.0

### Minor Changes

- b39f22c: Stop regex lookaround from 400ing the whole model turn, and give three
  always-on core kits a `frameworkTools` switch.
  - `stripUnsupportedSchemaKeywords` now drops a `pattern` containing lookaround
    (`(?=`, `(?!`, `(?<=`, `(?<!`). Anthropic rejects it with "regex lookaround is
    not supported" and rejects the entire request, so one such tool takes every
    other tool in the payload down with it — visible as an error in chat, and as
    nothing at all in a background run. `z.string().email()` compiles to two
    negative lookaheads and appears in ~35 action schemas, so this is answered at
    the boundary every tool passes through, alongside the existing typeless-schema
    and unsupported-`format` rewrites. The action's own zod schema still validates
    the value, so nothing that was enforced is loosened.
  - `emailCatalog`, `workspaceUserGroups`, and `orgServiceTokens` are new
    `frameworkTools` groups covering twelve actions that previously had no switch.
    All three default to on, so the available surface is unchanged — but they are
    now tagged, which takes them out of every app's default first-request tool
    list and leaves them reachable through `tool-search`.
  - `mcp.catalog: "app"` alongside `mcp.connectorCatalog` now throws at plugin
    init. `catalog: "app"` short-circuits the connector tier, so the two together
    served the app's full registry while the allow-list sat in the config looking
    authoritative.

### Patch Changes

- 483f03d: Stop the run-level no-progress backstop from killing runs while the model is
  still generating. Two watchdogs guarded the same silence on different clocks:
  the agent loop's `lastModelStreamProgressAt` bumps on every engine frame, while
  the run manager's backstop only sees events the loop forwards. Extended thinking
  produces the first without the second, so the 150s bound sat inside the working
  distribution — runs whose worst gap crossed it were checkpointed as
  `auto_continue { reason: "no_progress" }` and recorded as errors while still
  streaming, some missing by a single second, and background automations discarded
  results the agent went on to finish minutes later.

  The agent loop now brackets each engine call with a `model_stream` start/end
  pair, and the run manager counts it exactly like `tool_start`/`tool_done`: an
  engine call in flight suspends the backstop, bounded by the loop's own 90s
  model-stream watchdog the same way a tool call is bounded by its own timeout.
  Keepalives still do not count as progress, so a wedged transport with no engine
  call in flight trips the backstop as before.

  Background automation failures now also report through `captureError`. Both
  callers — the recurring-jobs scheduler and the trigger dispatcher — recorded the
  failure onto the automation's own metadata and logged it, and neither reported
  it, so a cut-off automation was visible only in a resource field and stdout.

  A cut-off run now reports a terminal state instead of none. `runAgentLoop`
  returns early at an `auto_continue` checkpoint and never reaches its outcome
  classification, so a truncated run shipped `terminal_state` and `error_message`
  as null and the reason was recoverable only from `agent_run_events`. Unplanned
  boundaries (`no_progress`, `stream_ended`, `gateway_timeout`, …) now surface as a
  retryable failure carrying the reason as the terminal code, while the planned
  `run_timeout` chunk boundary — which a hosted foreground run hits roughly every
  40s by design — records its reason without counting as an error.

- Updated dependencies [60b7e74]
  - @agent-native/toolkit@0.16.8

## 0.164.26

### Patch Changes

- d5ceae9: Preserve the beta environment opt-out when custom authentication pages are served.

## 0.164.25

### Patch Changes

- 562194a: Stop sending `temperature` on model requests that carry Claude thinking. Effort
  defaults to High on every reasoning-capable Claude model, so internal callers
  that asked only for `temperature: 0` — the Observational Memory compactor, eval
  judges, sentiment inference — always got a 400 ("`temperature` may only be set
  to 1 when thinking is enabled or in adaptive mode"). The Anthropic, AI SDK, and
  Builder gateway engines now drop the sampling parameters when thinking is on or
  when the model family removed them, and Observational Memory compaction runs at
  low effort so thinking cannot consume its whole output budget.

## 0.164.24

### Patch Changes

- 14a3f87: Preserve the beta environment opt-out when custom authentication pages are served.
- 14a3f87: Keep BYOA sign-in and liveness routes available while unrelated serverless bootstrap work is waiting on the database.

## 0.164.23

### Patch Changes

- b811566: Preserve the beta environment opt-out when custom authentication pages are served.

## 0.164.22

### Patch Changes

- 7bb5be0: Reject host-native better-sqlite3 binaries in Netlify server bundles before publication.
- 7bb5be0: Persist beta-to-production opt-outs from the cached sign-in shell for 24 hours.

## 0.164.21

### Patch Changes

- 68f299c: Clarify deployment targets and document Agent-Native app configuration.

## 0.164.20

### Patch Changes

- bfe4163: Report Telegram webhook registration failures instead of treating rejected `setWebhook` responses as successful setup.

## 0.164.19

### Patch Changes

- 5f4031b: Restore ownerless legacy app visibility while preserving explicit private defaults for new apps.

## 0.164.18

### Patch Changes

- b34de4c: Report Telegram webhook registration failures instead of treating rejected `setWebhook` responses as successful setup.

## 0.164.17

### Patch Changes

- d492462: Support TipTap mark rule helpers in generated SSR stubs.

## 0.164.16

### Patch Changes

- 7d72340: Keep desktop Google exchanges alive through longer passkey ceremonies while retaining one-time verifier binding.

## 0.164.15

### Patch Changes

- 3f1cf50: Send signed-out users directly to the shared sign-in journey after logout so private app data queries cannot flash before the session gate redirects.

## 0.164.14

### Patch Changes

- 667a1c1: Deliver authenticated Desktop task tools to local code-agent MCP clients.
- 667a1c1: Add a development-only configuration control for isolated Desktop authentication acceptance runs.

## 0.164.13

### Patch Changes

- 62373a8: Fix Google sign-in callbacks in browsers by keeping the OAuth binding cookie available across the provider redirect.

## 0.164.12

### Patch Changes

- 379f7ca: Simplify deployment documentation with dedicated app and workspace paths, a deployment target overview, and a clearer advanced reference.

## 0.164.11

### Patch Changes

- ae91302: Make shared user-share writes conflict-aware when a resource enforces normalized principal uniqueness.

## 0.164.10

### Patch Changes

- 6a18780: Keep the beta environment switcher visible to signed-out visitors, including the standalone auth page.
- e439054: Support reusable Code Agent worktrees and reliable local chat forking across Desktop sessions.
- 5ececad: Surface sync-version allocator reseed failures while preserving the existing retry and clock-fallback behavior.

## 0.164.9

### Patch Changes

- b1c420b: Block agent prompts until an LLM provider is connected and provide an inline Connect AI recovery flow with a clear retry action.
- 8690e40: Make automation details inspectable in Dispatch, including the prompt, trigger configuration, capabilities, and past runs.
- e542242: Create every framework-owned table at release time, so a hosted deploy comes up with a complete database.

  Most framework tables are defined by their owning store's `ensureTable()`, not by a migration list — `settings`, `application_state`, `app_secrets` and `resources` among them. On a long-lived server the first request creates whatever is missing. On production serverless it cannot: `schemaEnsureDisabled()` reports every table present so a cold start skips ~390 probes, which is correct for latency and means nothing on the request path can create a table. Only 15 of ~75 framework tables had a migration list, so the other 60 had no path to creation at all on a hosted deploy. Sites published successfully and then failed every request with `relation "public.settings" does not exist`.

  `runFrameworkReleaseMigrations` now runs those stores' own ensure paths first, from an explicit list in `server/release-schema.ts`, and `schemaEnsureDisabled()` no longer applies to a caller holding migration duty — the release step was subject to its own skip, because the Netlify build environment also sets `NETLIFY=true`.

  The list loads each store with a dynamic import, so re-exporting `runFrameworkReleaseMigrations` from `server/index.ts` does not pull 60 store modules into every server boot to serve a path that runs once.

  A new `guard:release-schema-complete` fails the build when a module creates tables and is not in that list, so a new store cannot repeat this. It recognises both `ensureTableExists` and stores that execute DDL held in a named constant, which is how `extensions/slots` created its tables without the first version of the guard seeing it. The migration-duty check moved to `db/migration-runtime.ts` to keep it off `db/client.js`, which stores mock.

  Already-published sites need one redeploy to pick up the missing tables.

## 0.164.8

### Patch Changes

- 939f6d2: Keep the core CLI agent-tool imports formatter-clean for package builds.

## 0.164.7

### Patch Changes

- 06cea8f: Keep the desktop chat composer blank while the identity gate is handling an unauthenticated saved thread.

## 0.164.6

### Patch Changes

- 8e51925: Fix Electron chat feedback around app visibility, local development tools, and run recovery.

## 0.164.5

### Patch Changes

- fc85cb2: Bind desktop Google OAuth exchanges to a high-entropy verifier so a known flow ID alone cannot retrieve a session token.

  Previously `/_agent-native/auth/desktop-exchange` returned a live session token to any caller that named the flow ID, and the flow ID came straight from the query string. An attacker could pick an ID, send someone to `/_agent-native/google/auth-url?desktop=1&flow_id=<known>&redirect=1`, then poll the exchange after that person signed in and receive their session token. The verifier now travels in an `X-Agent-Native-Desktop-Verifier` request header — which a link navigation cannot set — only its hash is stored, and the exchange read fails closed when the verifier is missing or does not match.

  **Desktop clients must be upgraded.** The old `GET ?desktop=1&flow_id=…` bootstrap is rejected, because that request shape is exactly what made the exchange stealable; there is no backward-compatible variant that keeps the fix. An older independently deployed desktop client will fail Google sign-in with `Invalid desktop exchange challenge.` until it ships the header-based bootstrap.

- fc85cb2: Stop treating an unreadable code-agent schedules file as an empty schedule list. A transient read error, a corrupt file, or a partially-written `schedules.json` collapsed to `[]`, and because every create/update/delete rewrites the whole file, the next mutation silently deleted every stored schedule. Only a genuinely absent file initializes as empty now; anything unreadable raises `CodeAgentSchedulesUnreadableError` and mutations refuse to run.
- 61ca441: Persist scheduled automation transcripts into chat threads so Open thread shows the run's agent steps.
- Updated dependencies [fc85cb2]
  - @agent-native/toolkit@0.16.7

## 0.164.4

### Patch Changes

- c58cd6e: Preserve verified mutation receipts and exact member identity across Dispatch and A2A delegation.

## 0.164.3

### Patch Changes

- f790010: Keep the current-main merge tree formatter-clean for shared agent runtime sources.

## 0.164.2

### Patch Changes

- 330cf77: Keep impersonal HTML redirects eligible for the shared SSR edge cache.

## 0.164.1

### Patch Changes

- 5a05b04: Connect signed-in users to Builder's managed AI gateway with least-privilege OAuth, encrypted per-user token custody, refresh, and revocation while preserving legacy Builder credentials for uncovered integrations.

## 0.164.0

### Minor Changes

- a2f21dc: Add an internal beta/production environment badge and typed deployment-lane metadata to hosted Agent-Native app shells.

### Patch Changes

- a2f21dc: Fix `useActionQuery`/`useActionMutation`/`callAction` surfacing an opaque `405` when a caller's HTTP verb doesn't match an action's declared `http.method` (e.g. a `defineAction({ http: { method: "DELETE" } })` called without `{ method: "DELETE" }`). The transport now throws a typed `action_method_mismatch` error naming the action, the method that was sent, and the method it declares, instead of a bare "Method not allowed" the caller had to reverse-engineer — and marks it non-retryable, since resending the same wrong verb never succeeds.
- a2f21dc: Show Approve/Deny again when a tool approval has to be re-asked. `approval_required` now carries an `askId` identifying that specific gate hit, and the chat retains a user's resolution per ask instead of per approval key. Previously, if a resume never consumed the grant (expired TTL, turn-id mismatch), the server re-asked for the same call and the client still showed the quiet "Approved" note — the buttons never came back, so the action silently never ran and there was no way to retry.
- a2f21dc: Improve locale picker labels and localized auth marketing copy.
- a2f21dc: Stop caller-supplied auth marketing from being overwritten by built-in localized copy. An app passing its own `marketing` whose `appName` matched a built-in slug (`Dispatch`, `Calendar`, …) had its tagline and features replaced by the stock localized copy in every non-English locale. A slug is now claimed only by content that actually matches the built-in entry.
- a2f21dc: Fix a bug where closing one chat tab could close several tabs at once (or make a tab reappear right after closing it). A duplicated thread id made two tab-bar entries share one underlying thread, so closing either removed both. Open-tab ids are now de-duplicated in the tab state itself, which covers both a corrupted list restored from localStorage and duplicates introduced at runtime by a synchronous burst of open requests.
- a2f21dc: Keep semantic settings URLs under the app's mounted workspace path.
- a2f21dc: Fix Connect Builder (and other `agentNativePath`/`appPath` calls) building the wrong URL in a multi-app workspace dev gateway when the current page's client-side route (e.g. `/settings`) isn't itself a workspace app id. Previously `appBasePath()` would blindly trust the URL's first path segment as the workspace mount, producing URLs like `/settings/_agent-native/builder/connect` that the gateway 404s into its app-picker page instead of Builder's real sign-in screen. The guessed segment is now validated against the deployed workspace app manifest when one is available.
- a2f21dc: Extend the human-in-the-loop tool approval grant window from 15 minutes to 1 hour. A user who stepped away between seeing an "Approve to run..." prompt and clicking it (e.g. to update their client) could return to a silently expired grant — clicking Approve did nothing because the durable row no longer matched `expires_at > now`, with no error shown.
- a2f21dc: Add regression coverage proving the magic-link `callbackURL`/`newUserCallbackURL` construction survives Better Auth's own `originCheck` validator end-to-end (not just a shape assertion) — this is the exact flow behind the `{"message":"Invalid callbackURL","code":"INVALID_CALLBACK_URL"}` reports from a UTM-tagged signup link and a retried sign-up after a stale `?error=` redirect. The existing absolute-URL promotion in `betterAuthCallbackURL` already fixed the underlying behavior; this closes the test gap so a future regression is caught even if the constructed URL still "looks" valid.

  Also stop silently swallowing a failure in the best-effort `email_verified` repair that runs after a successful verify-email redirect. A DB error there was previously indistinguishable from "nothing needed repairing," which is exactly the symptom in the "clicked the verify link, login still says not verified" reports — it's now reported via `captureAuthError` (still non-blocking) so a genuine failure is visible instead of silent.

- a2f21dc: Fix two bugs where a failure looked like success:
  - First-run onboarding's Skip/Continue no longer silently do nothing when the completion save fails. `completeFirstRun()` now rejects instead of swallowing a failed fetch or non-ok response, and `FirstRunOnboarding` surfaces the failure with a "Try again" affordance instead of bouncing to an unrelated full-screen error.
  - A workspace file (including binary exports) now renders a download card the moment it's created — `show-workspace-file`'s binary content-type gate is gone, and any tool result shaped like a workspace-file card (e.g. `web-request`/`provider-api-request`'s `saveToFile`) renders one automatically, without a second discretionary `show-workspace-file` call.

- a2f21dc: Keep replayed conversations faithful to what the agent actually did.
  - Resuming a run (chained background continuation, agent-teams `continue`) now
    replays the tool calls and results stored in `thread_data` instead of
    flattening each turn to its prose, so a resumed chunk can see the output of
    work already committed rather than re-running it. Integration turns keep their
    existing delivered-text-only replay policy, and each replayed result is bounded
    with an in-band truncation notice.
  - The outbound history window no longer slides by one message per turn. Every
    prompt cache matches a byte-identical prefix, so a window that moved every turn
    meant no cached prefix ever matched once a thread passed the message cap, and
    the whole conversation was re-billed at write price on every turn. The window
    start is now quantized to a stride.
  - Anthropic `redacted_thinking` blocks survive normalization and replay verbatim.
    They were silently dropped as an unknown block type, which left the next
    iteration of a tool-use turn sending an assistant turn the API rejects.
    Unrecognized content block types now warn instead of vanishing.
  - Reducing a long thread is Observational Memory's job, but its Observer only
    engages past 30k unobserved tokens while a 24-message count cap bit long
    before that, so turns left the request while compaction still had nothing to
    say about them. The count cap is now a backstop well above that threshold; the
    two char budgets remain the real bound on what a request carries.
  - A thinking block with no signature is dropped with a warning instead of being
    sent with an empty one, which the native API rejects outright — failing the
    whole turn on a provider error that points nowhere near the cause. The Builder
    gateway path is unchanged, since its tolerance here is unverified.

- a2f21dc: Retry a failed chat request automatically after the user connects an LLM provider from the recovery card, instead of leaving the request waiting behind a dismissed error.
- a2f21dc: Fix `provider-api-request` reporting a failed Slack send as a success. Slack's Web API always answers HTTP 200, even on failure, and encodes the real outcome as `ok: false` in the JSON body — `chat.postMessage` calls that failed (e.g. `not_in_channel`, `channel_not_found`, `msg_too_long`) looked identical to a delivered message to any caller checking `response.ok`, including the agent, which could then tell a user a Slack message was sent when it never was. Provider configs can now declare `bodyOkField` for this always-200-with-body-encoded-outcome convention; the Slack provider sets it, and a body-level `false` now flips the response's `ok` to `false` so a failed or unconfirmed send can no longer be reported as delivered.
- a2f21dc: Record a rejected Builder credential on the transcription path so it is not
  retried forever. The chat engine already marks a 401/403 and stops reusing that
  credential for the auth-failure TTL; transcription threw the raw upstream text
  and marked nothing, so one unusable credential re-sent the same doomed request
  on every attempt — 24 identical "Missing Authentication header" 401s in a day.
- Updated dependencies [a2f21dc]
  - @agent-native/toolkit@0.16.6

## 0.163.4

### Patch Changes

- 0860ba4: Keep the Vite "dev server is restarting" page polling until Nitro answers instead of stopping after five 1-second reloads during a multi-minute first boot.

## 0.163.3

### Patch Changes

- e059442: Keep collaboration auto-seeding correct for mapped document ids without issuing one database read per source row, and carry the configured deployment lane into server telemetry.
- e059442: Harden the local self-hosting Docker quickstart and document PostgreSQL volume upgrades.

## 0.163.2

### Patch Changes

- 8236ce6: Fence session replay uploads that time out before transport cancellation.

## 0.163.1

### Patch Changes

- 3ffbacb: Keep collaboration auto-seeding correct for mapped document ids without issuing one database read per source row, and carry the configured deployment lane into server telemetry.
- 3ffbacb: Harden the local self-hosting Docker quickstart and document PostgreSQL volume upgrades.

## 0.163.0

### Minor Changes

- a688849: Add organization groups and privacy controls for workspace apps. New apps use the organization default (organization-wide by default), while creators and organization admins can manage individual, group, and organization access from the shared popover.

## 0.162.0

### Minor Changes

- 0b57293: Add an internal beta/production environment badge and typed deployment-lane metadata to hosted Agent-Native app shells.

### Patch Changes

- 0b57293: Fix `useActionQuery`/`useActionMutation`/`callAction` surfacing an opaque `405` when a caller's HTTP verb doesn't match an action's declared `http.method` (e.g. a `defineAction({ http: { method: "DELETE" } })` called without `{ method: "DELETE" }`). The transport now throws a typed `action_method_mismatch` error naming the action, the method that was sent, and the method it declares, instead of a bare "Method not allowed" the caller had to reverse-engineer — and marks it non-retryable, since resending the same wrong verb never succeeds.
- 0b57293: Show Approve/Deny again when a tool approval has to be re-asked. `approval_required` now carries an `askId` identifying that specific gate hit, and the chat retains a user's resolution per ask instead of per approval key. Previously, if a resume never consumed the grant (expired TTL, turn-id mismatch), the server re-asked for the same call and the client still showed the quiet "Approved" note — the buttons never came back, so the action silently never ran and there was no way to retry.
- 0b57293: Fix a bug where closing one chat tab could close several tabs at once (or make a tab reappear right after closing it). A duplicated thread id made two tab-bar entries share one underlying thread, so closing either removed both. Open-tab ids are now de-duplicated in the tab state itself, which covers both a corrupted list restored from localStorage and duplicates introduced at runtime by a synchronous burst of open requests.
- f97dad9: Keep mounted framework endpoints reachable in dev and strip React Router HMR imports from transplanted app modules.
- 0b57293: Keep semantic settings URLs under the app's mounted workspace path.
- 0b57293: Fix Connect Builder (and other `agentNativePath`/`appPath` calls) building the wrong URL in a multi-app workspace dev gateway when the current page's client-side route (e.g. `/settings`) isn't itself a workspace app id. Previously `appBasePath()` would blindly trust the URL's first path segment as the workspace mount, producing URLs like `/settings/_agent-native/builder/connect` that the gateway 404s into its app-picker page instead of Builder's real sign-in screen. The guessed segment is now validated against the deployed workspace app manifest when one is available.
- 0b57293: Extend the human-in-the-loop tool approval grant window from 15 minutes to 1 hour. A user who stepped away between seeing an "Approve to run..." prompt and clicking it (e.g. to update their client) could return to a silently expired grant — clicking Approve did nothing because the durable row no longer matched `expires_at > now`, with no error shown.
- bcd4c14: Time out session-replay uploads so a hung request releases the flush lock instead of growing the replay queue for the rest of the session, and bound the extension-marker scan by its watermark instead of reading every marker row ever written.
- 0b57293: Add regression coverage proving the magic-link `callbackURL`/`newUserCallbackURL` construction survives Better Auth's own `originCheck` validator end-to-end (not just a shape assertion) — this is the exact flow behind the `{"message":"Invalid callbackURL","code":"INVALID_CALLBACK_URL"}` reports from a UTM-tagged signup link and a retried sign-up after a stale `?error=` redirect. The existing absolute-URL promotion in `betterAuthCallbackURL` already fixed the underlying behavior; this closes the test gap so a future regression is caught even if the constructed URL still "looks" valid.

  Also stop silently swallowing a failure in the best-effort `email_verified` repair that runs after a successful verify-email redirect. A DB error there was previously indistinguishable from "nothing needed repairing," which is exactly the symptom in the "clicked the verify link, login still says not verified" reports — it's now reported via `captureAuthError` (still non-blocking) so a genuine failure is visible instead of silent.

- 0b57293: Fix two bugs where a failure looked like success:
  - First-run onboarding's Skip/Continue no longer silently do nothing when the completion save fails. `completeFirstRun()` now rejects instead of swallowing a failed fetch or non-ok response, and `FirstRunOnboarding` surfaces the failure with a "Try again" affordance instead of bouncing to an unrelated full-screen error.
  - A workspace file (including binary exports) now renders a download card the moment it's created — `show-workspace-file`'s binary content-type gate is gone, and any tool result shaped like a workspace-file card (e.g. `web-request`/`provider-api-request`'s `saveToFile`) renders one automatically, without a second discretionary `show-workspace-file` call.

- 0b57293: Keep replayed conversations faithful to what the agent actually did.
  - Resuming a run (chained background continuation, agent-teams `continue`) now
    replays the tool calls and results stored in `thread_data` instead of
    flattening each turn to its prose, so a resumed chunk can see the output of
    work already committed rather than re-running it. Integration turns keep their
    existing delivered-text-only replay policy, and each replayed result is bounded
    with an in-band truncation notice.
  - The outbound history window no longer slides by one message per turn. Every
    prompt cache matches a byte-identical prefix, so a window that moved every turn
    meant no cached prefix ever matched once a thread passed the message cap, and
    the whole conversation was re-billed at write price on every turn. The window
    start is now quantized to a stride.
  - Anthropic `redacted_thinking` blocks survive normalization and replay verbatim.
    They were silently dropped as an unknown block type, which left the next
    iteration of a tool-use turn sending an assistant turn the API rejects.
    Unrecognized content block types now warn instead of vanishing.
  - Reducing a long thread is Observational Memory's job, but its Observer only
    engages past 30k unobserved tokens while a 24-message count cap bit long
    before that, so turns left the request while compaction still had nothing to
    say about them. The count cap is now a backstop well above that threshold; the
    two char budgets remain the real bound on what a request carries.
  - A thinking block with no signature is dropped with a warning instead of being
    sent with an empty one, which the native API rejects outright — failing the
    whole turn on a provider error that points nowhere near the cause. The Builder
    gateway path is unchanged, since its tolerance here is unverified.

- 16cbc53: Stop PR Visual Recap gate skips from creating visible pull request comments.
- 0b57293: Fix `provider-api-request` reporting a failed Slack send as a success. Slack's Web API always answers HTTP 200, even on failure, and encodes the real outcome as `ok: false` in the JSON body — `chat.postMessage` calls that failed (e.g. `not_in_channel`, `channel_not_found`, `msg_too_long`) looked identical to a delivered message to any caller checking `response.ok`, including the agent, which could then tell a user a Slack message was sent when it never was. Provider configs can now declare `bodyOkField` for this always-200-with-body-encoded-outcome convention; the Slack provider sets it, and a body-level `false` now flips the response's `ok` to `false` so a failed or unconfirmed send can no longer be reported as delivered.
- 0b57293: Record a rejected Builder credential on the transcription path so it is not
  retried forever. The chat engine already marks a 401/403 and stops reusing that
  credential for the auth-failure TTL; transcription threw the raw upstream text
  and marked nothing, so one unusable credential re-sent the same doomed request
  on every attempt — 24 identical "Missing Authentication header" 401s in a day.
- Updated dependencies [16cbc53]
- Updated dependencies [0b57293]
  - @agent-native/recap-cli@0.5.5
  - @agent-native/toolkit@0.16.5

## 0.161.23

### Patch Changes

- 112547e: Resolve Agent-Native model selections through request, org/user defaults, and the global catalog before sending a concrete model to the Builder gateway.

## 0.161.22

### Patch Changes

- 8a7ba01: Restore formatter compliance in core schema sanitization code.

## 0.161.21

### Patch Changes

- 0d81f46: Keep the core tool-schema seam regression test formatted with the current source formatter.
- 0b0085f: Fix workspace app sign-in continuation and mounted-app launches.

## 0.161.20

### Patch Changes

- 814f0ad: Allow explicitly configured public ingestion routes to complete cross-origin preflight requests without enabling credentialed CORS.
- c54d918: `useSemanticNavigationState` no longer reports an unserializable navigation state
  once per render. The write-dedup token fell back to a fresh symbol, and
  `navigationKeys` is typically a new array each render, so every re-render issued
  another failing write and another `onError`. It now falls back to the state's own
  identity, which still lets a genuinely different unserializable state reach the
  write path and surface its real error.

## 0.161.19

### Patch Changes

- efc5f92: Improve the self-hosting documentation with a fast local Docker quickstart and downloadable Chat fixture.
- 9fed363: Teach generated workspaces to reuse shared settings, vault, OAuth, and onboarding primitives before building custom integration setup UI.

## 0.161.18

### Patch Changes

- 9dd50a0: Drop JSON Schema keywords OpenAI's function validator rejects: unsupported
  `format` values (`uri` from `z.string().url()` among them) and constraint-only
  keywords like `patternProperties`, `not`, and `if`/`then`/`else`. Any one of them
  400s the entire chat request, so a single `z.string().url()` in one tool broke
  every turn that offered it.
- f294ae3: Keep the Connect Builder and Custom keys actions side by side in the agent sidebar.

## 0.161.17

### Patch Changes

- 34496d7: Sanitize every tool schema at the engine boundary, not just `defineAction` ones.
  Hand-written tools (extensions, MCP, context tools) and third-party MCP server
  schemas bypassed the sanitizer entirely, so `extension-data-set` shipped a `data`
  property with no `type` and OpenAI 400'd the whole request — every tool in the
  payload, not just that one.

## 0.161.16

### Patch Changes

- c940f4c: Record a rejected Builder credential on the transcription path so it is not
  retried forever. The chat engine already marks a 401/403 and stops reusing that
  credential for the auth-failure TTL; transcription threw the raw upstream text
  and marked nothing, so one unusable credential re-sent the same doomed request
  on every attempt — 24 identical "Missing Authentication header" 401s in a day.

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
