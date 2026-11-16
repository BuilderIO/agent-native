---
name: remix
description: >-
  Rebuild website effects in your repo or Design with exact behavior and original
  code. Use when asked to remix, borrow, port, recreate, explain an effect, or
  /remix source into ours.
metadata:
  visibility: exported
---

# Remix

Use **repo mode** for a source-and-change prompt inside a repository. Use
**Design mode** when the user asks for Design, a canvas or selection, or wants
to pick visually. Both modes finish on a **remix board** in Design (below)
unless the user says no Design, headless, or just the code, or Design is
unavailable; then use the image finish in **Finish Without Design**.

Design is available when the authenticated Design MCP connector is connected
or a browser that runs page JavaScript holds a signed-in Design tab. A missing
connector is not enough to skip the board: open Design through the launch order
in **Put Design Beside The Chat** (MCP App, then the host's inline browser such
as Claude Code's side-panel browser, then the desktop app, then the system
browser) and use the page's WebMCP tools as `/visual-edit` describes.

## Repo Mode: Run End To End

For `/remix add the stripe hero animation to ours but make it blue`, locate
the destination hero component in the repo and proceed without questions.
Ask only when something essential is missing and cannot be inferred, such as
an ambiguous source page or destination. For a new site, scaffold in the user's
stack. Follow the repo's instructions and reuse its components and conventions.

1. Start or reuse the destination dev server. Capture its current appearance.
2. Drive the source in your own browser (Playwright, Chrome, or an inline
   browser), capture the running effect and inspect its shipped code using the
   two-step extraction below. No Design connector or canvas is needed.
3. Implement from the behavior spec in the destination. Apply the requested
   change: "make it blue" maps the palette to blue while keeping everything
   else identical, subject to the original-code and asset rules below.
4. Expose knobs as typed props or CSS custom properties with explicit defaults.
   Verify source versus rebuild using matched screenshots and motion clips,
   including the original-colors fidelity check below, then finish on the
   remix board, or without Design as described below.

## Design Mode: Choose On The Canvas

Use the current canvas selection, or open the hosted editor at
`https://design.agent-native.com`. Connect and place screens as
`/visual-edit` does (WebMCP `open-visual-edit` in a page-capable browser,
otherwise hosted Design MCP at `https://design.agent-native.com/mcp`). Design
mode depends on the `visual-edit` skill for bridge, auth, and handoff rules:
read it, and if it is not installed run
`npx @agent-native/core@latest skills add visual-edit` first (repo mode does
not need it). Never start a local Design server.

Ask only for a missing source or destination; a new site can be scaffolded in
the user's stack. Infer style from the destination. If the prompt already
names the section and destination, use them; otherwise let the user select.

### Put Design Beside The Chat

Use `open-visual-edit` with `target: "inline-browser"` (default) and
`minimalUi: true`. This is the default for a remix board: layers stay hidden,
the inspector appears after selecting an item, and the user can turn minimal
UI off with the existing shortcut. Prefer the MCP App returned by
`open-visual-edit` in Claude Desktop/Code/claude.ai and Codex when available;
otherwise use the host's inline browser. Fall back to the desktop app, then the
system browser, only when inline rendering is unavailable. System browser uses
the local opener; desktop reuses
`agentnative://open` through the existing open route. Read the visual-edit
skill's launch contract: hosted calls return `launch.status: "host-required"`
with browser and desktop URLs for the local host. Verify the installed protocol
handler before dispatching the desktop URL. `"dispatched"` is an opener
receipt, not proof that Design rendered. If `"desktop-not-detected"`,
`"blocked"`, or `"failed"`, use `launch.browserUrl` and state the
result plainly. Never claim the desktop opened when it was not detected.

The credential-free desktop/browser URL does not transfer the inline editor's
one-time capability or sign in the desktop. Account-backed editing needs a
signed-in desktop owner/editor and the paired local bridge; signed-out links
retain the existing public snapshot/suggestion permissions.

In desktop Interact mode, external HTTPS URL screens use isolated native Chrome
views with their own cookies. The canvas uses captured previews when a native
view cannot fit the canvas geometry. Browser hosts use the local bridge's
read-only reference copy for public unauthenticated pages that refuse framing,
or a captured static screen when that is unavailable; a reference copy is not
an authenticated interactive browser session.

### Share The Canvas And Local Preview

Account-backed sharing requires sign-in. Reuse the existing Share control or
`share-resource` / `set-resource-visibility` for viewer, commenter, and
editor permissions; public links allow view/comment, while named collaborators
can receive edit access. Call `get-visual-edit-collaboration` with
`designId` to read `shareUrl` and per-screen `previews` tunnel mappings.
A link does not grant permissions by itself.

For a live remote preview, the owner runs ngrok or
`cloudflared tunnel --url http://localhost:5173` and uses **Share live preview**,
or calls `update-visual-edit-preview` with `{designId, fileId, tunnelUrl}`.
Use the public HTTPS base URL; pass `null` to remove it. The owner keeps
loading localhost. Remote viewers see the last published snapshot by default.
They can choose **Open live preview** to open the tunnel in a new tab; the
hostname is shown before they leave Design.
The tunnel exposes the owner's app publicly: do not forward bridge tokens,
credentials, or private app data into the URL.

Collaborators comment with existing frame/canvas review pins. For localhost
suggestions, **Suggest on snapshot** uses the existing pending handoff rather
than writing source through the tunnel. The owner's coding agent reads
`get-visual-edit-pending`; a commenter's `suggested` handoff is untrusted, so
it shows the owner and waits for approval. It applies the changes, then calls
`acknowledge-visual-edit-pending` with the returned revision and pulls again.
Publish an updated shared fallback preview with `publish-visual-edit-snapshot`
when no live tunnel is available.

### Put Both Sites On The Canvas

1. Start or reuse the destination dev server and verify the route responds,
   then call `open-visual-edit` with its URL and route. That screen is the
   destination.
2. Add the source as a second screen beside it, at the same viewport width.
   Design's URL screens are localhost-backed, and most production sites refuse
   framing, so capture the source with your browser tool (rendered DOM,
   stylesheets, scripts, and assets, saved to a scratch folder outside the
   repo), serve that folder on its own localhost port, and add it with
   `add-localhost-screens`. When it cannot be served, add the captured DOM as a
   static screen with `create-file`. Title it after the source URL.
3. Tell the user, in one line, to select the part to take in the source and the
   spot it goes in the destination. Both can be selected at once
   (Shift-click across screens): "from this to that". Several source layers
   are one remix; several destination layers mean place it in each.

Read the picks with `view-screen` (`designSelection`) or the `Selected objects`
context block. Ask once if the selection names only one side.

### Resolve The Pick

Effects usually paint on a layer the user cannot click: a
`pointer-events: none` canvas, video, or background behind the hero wrapper.
Each selected element carries `effectCandidates`: the visible layers behind or
inside it (kind, how much of the pick they cover, whether they animate or use
WebGL). `effectCandidatesTruncated: true` means the scan stopped early on a
very large page, so the list may be missing layers: check the page yourself
before concluding there is no effect. Before extracting:

- One clearly effect-like candidate (say a WebGL canvas covering most of the
  pick): take it and say so in one line, e.g. "You clicked the hero container;
  I'm taking the WebGL canvas behind it."
- Several plausible candidates: ask once, naming each by kind and size, and
  select each on the canvas while you ask when a tool allows.
- Never remix only the clicked wrapper when an effect layer sits behind it.

The user can also pick a hidden layer by hand: right-click the spot and use
**Select layer**.

## Two-Step Clean-Room Extraction (Both Modes)

### 1. Study And Write A Behavior Spec

The running page shows how it looks; shipped code explains how it works.
Drive the source in your own browser: scroll, hover, click, and resize until
the effect runs. Inspect the relevant HTML, CSS and JavaScript, network assets,
canvas/WebGL loop, shaders, uniforms, listeners and animation libraries.

Write a behavior spec in your own words in a scratch file **outside the repo**
before implementing. Record geometry, math in words or equations, numeric
parameters, timings/easing, scroll and pointer mappings, layering, responsive
rules, and asset character. Keep source citations and all captures outside the
destination repository. Record uncertainty rather than guessing.

### 2. Implement From The Spec

Use the spec to write original code in the destination's own idiom and
structure. Source is evidence, not material to translate. Do not copy verbatim
or near-verbatim code, shader source, comments, identifiers, file structure,
minified snippets, fonts, logos, images, models, or copy into the destination.
Numbers, formulas and observable behavior are facts: use the same math,
geometry, parameters and timings exactly; the expression must be ours.
Replace proprietary textures and assets with procedural or openly licensed
stand-ins of the same visual character, recording licence/provenance. Match
asset role, scale and placement without copying its drawing. Review the diff
for source expression before handoff. Original code is not a reason to relax
behavioral fidelity; disclose unavoidable asset differences.

## Match The Source, Recolor To The Destination

The remix must be visually near-identical to the source: same shape,
composition, scale, placement relative to its container, texture, motion, and
timing. Unless the user says otherwise, always restyle its brand layer to the
destination: colors, fonts, iconography (the destination's icon set), logos,
and copy, each mapped to the destination's tokens (CSS variables, Tailwind
theme, design system). Change anything else only when the user asks.

- Use the destination's components and conventions for markup; add a component
  in its usual place rather than a pasted blob.
- Respect `prefers-reduced-motion`, keep the page usable without WebGL, and do
  not regress the destination's load time.

## Check Fidelity Before Done

Render the rebuild with the source's original colors beside a capture of the
source at the same viewport and the same animation time (pin the clock or the
time uniform). Compare silhouette, placement, scale, texture, and motion;
change the rebuild and recapture until the two read as the same effect. Only
then apply the destination's brand layer (colors, fonts, iconography, logos,
copy). Fonts and copy change text wrapping and placement, so compare layout
again after the swap and fix drift without undoing the brand mapping. Show the
user the original-colors side-by-side and the final one, and name any remaining
difference.

## Swappable Assets

Make each creative asset (image, video, 3D model, texture, Lottie, font) one
named prop or constant at the top of the component, with a placeholder we own.
Say in the report where to swap each one.

## Knobs Are Always On

Every shader, WebGL, canvas, 3D, or animation effect gets knobs. Expose its
meaningful parameters (speed, intensity, colors, scale, camera, easing,
density) as typed props or CSS custom properties with defaults. A headless
finish needs no inspector. **On a Design board**, also expose them through
Design's tweak system, never a private UI:

1. Bind each parameter to a CSS custom property on the effect's root and have
   the effect read it every frame (`getComputedStyle(el).getPropertyValue`), so
   Design's live `tweak-values` updates show instantly.
2. Register the knobs with `update-design`, setting data path `tweaks` to the
   definitions: `{ id, label, type: "slider" | "toggle" | "segment" |
   "color-swatch" | "color-swatches", min, max, step, defaultValue, cssVar,
   unit?, options?, scope }`. `segment`, `color-swatch` and
   `color-swatches` require `options`, a list of `{ label, value, color? }`
   choices; without it the inspector shows empty controls. Always set
   `scope.screenId`, plus `nodeId` (or `selector` on a URL screen) of the
   effect's root: `{ screenId, nodeId }` or `{ screenId, selector }`. A knob
   that drives several screens takes a list of scopes, one per screen, under
   one id and cssVar. Keep existing tweaks; append.
3. Design shows them, already expanded, in the inspector's **Tweaks** section
   whenever the user selects that screen, the effect, or any parent or child of
   it, and never for a sibling.
4. Read values with `get-design-snapshot` (`tweaks`, `appliedTweaks`) and set
   them with `apply-tweaks`. When the user is happy, write the chosen values
   back into the destination source as the defaults.

## Remix Explain

`remix explain <part of a site>` teaches instead of porting. Extract the part as
above, then finish on the **Explain board** variant in "Finish On A Remix
Board". Headless, provide a local explainer page with typed props/CSS knobs and
captures.

## Motion

When the user wants to retime a remixed animation, the Motion panel (a Design
Lab) can edit GSAP-style tracks and keyframes. It is optional; knobs come first.

## Finish On A Remix Board

Open Design as `/visual-edit` does (same launch targets and links) and lay out
one board, left to right, at the same viewport size.

A board writes files to a Design project, so it needs the authenticated
connector or a signed-in Design tab. The `/visual-edit` page lists only the
visual-edit tools (`open-visual-edit` and a few others); file tools such as
`create-file`, `update-file` and `list-files` register on a signed-in
`/design/<id>` page. When the tab is signed out, ask the user to sign in to
Design there, wait, open the board's design page, and check its tools again
before falling back to **Finish Without Design**.

1. **Original**: the source screen from "Put Both Sites On The Canvas" (live
   where it frames, else the served capture, else a static snapshot).
2. **Remix**: the destination with the rebuilt effect, as a localhost screen
   when a visual-edit bridge is connected for its dev server, else an inline
   screen of the rebuilt section.
3. **How it works**: a row of 3-5 small inline screens beneath, one stage of
   the technique each (geometry, motion, camera, shading, palette), each a
   live exploded view of the remix screen's layers (see **How It Works
   Frames**) driven by the remix's knobs.

Title screens with `rename-screen` ("Original · stripe.com", "Remix",
"Folded plane"), then size and place them in one `update-design` call:
`screenMetadata.<id>` `{ width, height, heightMode: "fixed" }` and
`canvasFrames.<id>` `{ x, y, width, height }`. Lay out in canvas pixels, every
gap edge to edge (numbers for 1440×900 screens and 600×460 explainers):

- Top row: a 420 px band from y 0 to 420 holds the headers, notes and
  Design's screen labels, so Original and Remix start at y 420. Original x =
  0; Remix x = Original x + Original width + 400 (1840), a 400 px gap.
- How it works: its 600 px band starts 280 px below the top row's bottom
  (420 + 900 + 280 = 1600), so explainers start at y 2200, 160 px apart, the
  row centred under the top row: first x = (3280 − row width) / 2, where 3280
  is the top row's width.
- The board title and technique line sit above y 0.

**Explain board** (`remix explain`): the same board with no Remix group, so
Original then How it works. Keep the same layout, regions, headers, notes,
connectors and explainer frames; leave out the Remix screen, its region and
header, and the Original-to-Remix connector, and draw one connector from
Original down to How it works. Number the sections "01" and "02", drop the
"Only colors, fonts and icons changed" note, and scope each knob to the
explainer screens and, when inline, the Original. Center the explainer row
under Original: first x = Original x + (Original width − row width) / 2.

### Annotate The Canvas

Use the board like a whiteboard, styled as an editorial page: paper,
hairlines and quiet type, not sticky notes or heavy arrows. Canvas annotations
live in the design's board file, `__board__.html`. Call
`migrate-board-objects-to-file` once; it is idempotent and creates the file.
Then find the file's id in `get-design` `files` and write it with
`update-file`. Each annotation is a direct `<body>` child, absolutely
positioned in canvas coordinates (the same space as `canvasFrames`), with
`data-agent-native-node-id`, `data-agent-native-layer-name` and
`data-an-primitive` (`rectangle`, `text`, `ellipse` or `arrow`). That makes
each one an editable layer. Add:

- A paper region behind each group (Original, Remix, How it works): warm
  off-white, a 3 px warm-grey hairline border, 6 px radius, about 100 px past
  the frames. Set `canvasBackground` to a slightly darker warm grey in the
  same `update-design` call. Earlier body children paint below later ones; screens paint above.
- A section header in each region's top band: an Inter title (about 84 px,
  weight 600), a 3 px hairline running right, and a serif-italic index at its
  end ("01", "02", "03"; EB Garamond, else Georgia). Above everything, a board
  title (Inter, about 112 px), a serif-italic one-line technique and a
  full-width hairline.
- Margin notes, not stickies: small grey Inter (about 34 px) under the header
  rule, each line led by a serif-italic note number. Use the source
  URL, "Only colors, fonts and icons changed" and "Each explainer reads
  the remix's own knobs". On an Explain board, which has no Remix, the last
  note says the explainers share one set of knobs, and the Original too
  when it is inline.
- A serif-italic step index ("01"…) on a hairline above each explainer.
  Design's screen label carries the step name, so name screens plainly.
- Thin ink connectors (3 px, dark warm grey, small triangle head): Original to
  Remix, Remix down to How it works, and between explainers. An arrow is an
  `<svg data-an-primitive="arrow" overflow="visible">` with a `<path d="M 0 0
  L 192 0" stroke-width="3" marker-end="url(#id)">` and a triangle
  `<marker id="id">` in its `<defs>`.

Keep each header and its notes inside its band from the layout above. Inside a
`style` attribute, quote font names with single quotes; a double quote ends
the attribute.

Explainer and Remix knobs are the same tweaks: the explainer's speed knob is
the remix's speed tweak, scoped to both screens, and both read its one cssVar.
Turning a knob in any frame updates the remix too. Every frame runs live in
Interact mode; inline frames keep the knob values there, but a localhost or URL
screen loads as itself in Interact and shows its source defaults, so judge its
knobs in Edit.

### How It Works Frames

Explain how the screen works, not the technique in the abstract. The row is a
left-to-right series of steps; each card is an exploded view of the Remix's
real screen at that step, its layers pulled apart in depth so you can see what
each one paints:

- Layers are thin flat planes in the screen's proportions and corner radius,
  stacked in 3D and spread along the depth axis: `preserve-3d` under a
  perspective, each plane at `translateZ(i * gap)`, the stage at about
  `rotateX(55deg) rotateZ(-40deg)` (or the same oblique projection in SVG).
- Each plane holds that layer's real content: the destination page's text and
  buttons, the effect canvas at that step (vertex grid, bent grid, grain in
  greys, palette), the background. Empty, clip and mask layers are dashed
  outlines; content layers are filled. The front plane is the composited
  result. At most a tiny source note ("same as stripe.com") in the margin.
- Label each plane beside it, outside the plane, in tiny uppercase Inter or
  serif italic ("PAGE", "EFFECT CANVAS", "CLIP", "RESULT"), with a hairline
  leader where needed.
- Steps read as one story, for example: the page exploded into text, effect
  canvas and background; the effect canvas exploded into its passes; the
  canvas behind the text and its clip; the result collapsed with its knobs.
- An explode control animates between collapsed (the real screen) and
  exploded. Idle, the stack breathes or turns slightly; dragging tilts it;
  hovering a plane lights it in the accent and dims the others.
- A small config panel in one corner in our paper style, never a dark
  lil-gui: 3-6 rows with the explode toggle, the step's 1-3 real knobs as
  sliders and optionally a layer toggle, updating the planes live.
- Keep the config panel visible in Edit and Interact so the board shows what
  each step's knobs do. Until the user changes a value, it demos one knob at a
  time: the slider sweeps out from the saved value and back, the planes follow,
  and the live row takes the accent. The demo writes only the frame's own
  `:root` and never calls `setTweak`. When a `tweak-values` message
  changes a value after the first one, stop the demo and ease the planes and
  slider to the new value over about 700 ms, then hold it. Hovering the panel
  pauses the demo, and `prefers-reduced-motion` disables it. Embedded in
  Design outside Interact (no `window.__anInteract`), the panel is
  display-only: set `disabled` on its inputs so neither pointer nor keyboard
  changes a value that cannot be saved; values change there from the Tweaks
  panel, and hovering the panel still pauses the demo. Running standalone (top
  window), the knobs work and change only that page.
- At most one handwritten note per card (Caveat or Gochi Hand, else serif
  italic) with a hand-drawn arrow to the key plane ("the shader only paints
  this layer").

Draw on warm paper with a faint grid, thin ink lines and four warm greys, with
exactly one accent; colors the step is about (a palette, the final hero) appear
as content, and a dark destination stays dark on its planes. No building-block
or hardware metaphors and no flowchart of labelled boxes.

- A 600×460 card: number (serif italic) and title at the top, a short
  interaction hint and the live readout at the bottom. No labels inside a
  plane; its own headline and buttons are content.
- Calm and live: idle motion pauses on hover or focus, E toggles explode, S
  slows, and `prefers-reduced-motion` holds it still.
- One model of true values drives motion and readout: read the shared tweak
  CSS variables from `:root` every frame, with the spec's real parameter names
  and formulas.
- Parts are layers. Wrap each plane, and each on-figure control, in its own
  absolutely positioned HTML element with `data-agent-native-node-id` and
  `data-agent-native-layer-name`, present in the static HTML and moved by the
  script, so a click in Edit selects that part. Scope each knob to the Remix's
  node and to the planes that embody it: selecting a plane shows only its
  knobs, selecting the frame shows them all. In Interact, dragging a panel
  slider or on-figure control sets its CSS variable on the frame's `:root`
  for instant feedback, then saves it with
  `window.__anInteract.setTweak(id, value)` (an id or the tweak's cssVar)
  when present. Design saves only a tweak scoped to that screen, clamped to
  its min, max and step, as if set in the inspector, so the other frames
  follow and Apply lists the change. Throttle calls to about one per
  animation frame while dragging.
- Small and self-contained: framework-free JS, CSS 3D and inline SVG, at most
  two webfonts, never embedded images or base64 fonts; a design has a size
  limit.

## Finish Without Design

When the user opts out of Design or Design is unavailable, finish in the repo
with images:

1. Source versus result: matched screenshots at the same viewport, plus clips
   for motion.
2. The original-colors fidelity check, side by side with the source.
3. Destination before and after: the page as it was, then with the remix in
   its palette.

## Report

Every finish reports the changed files and the verification: checks run and
the original-colors fidelity side by side with the source. Then add
source-versus-result captures (clips for motion), knobs and defaults,
swappable assets, and unverified behavior or remaining differences. With a
board, give its link, and in Design mode hand off source edits the
visual-edit way. Without Design, include the three image sets above.
