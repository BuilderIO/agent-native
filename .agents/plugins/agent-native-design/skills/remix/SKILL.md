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
unavailable; then finish in repo mode with images.

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
   remix board.

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
above, then build the board's **How it works** row beside the source, without a
Remix frame. Headless, provide a local explainer page with typed props/CSS
knobs and captures.

## Motion

When the user wants to retime a remixed animation, the Motion panel (a Design
Lab) can edit GSAP-style tracks and keyframes. It is optional; knobs come first.

## Finish On A Remix Board

Open Design as `/visual-edit` does (same launch targets and links) and lay out
one board, left to right, at the same viewport size:

1. **Original**: the source screen from "Put Both Sites On The Canvas" (live
   where it frames, else the served capture, else a static snapshot).
2. **Remix**: the destination with the rebuilt effect, as a localhost screen
   when its dev server runs, else an inline screen of the rebuilt section.
3. **How it works**: a row of 3-5 small inline screens beneath, one stage of
   the technique each (geometry, motion, camera, shading, palette), each a
   live figure with 1-2 knobs in the destination's palette.

Title screens with `rename-screen` ("Original · stripe.com", "Remix", "1 ·
Folded plane"), then size and place them in one `update-design` call:
`screenMetadata.<id>` `{ width, height, heightMode: "fixed" }` and
`canvasFrames.<id>` `{ x, y, width, height }`.
Explainer and Remix knobs are the same tweaks: the explainer's speed knob is
the remix's speed tweak, scoped to both screens, and both read its one cssVar.
Turning a knob in any frame updates the remix too. Every frame runs live in
Interact mode.

Explainer frames: one idea per frame, diagram first, a caption of a sentence
or two, real parameter names and values from the spec, small and light.
Use system or already-loaded web fonts, never embedded base64 fonts or
images; a design has a size limit.

Then report: the board link, source-versus-result captures (clips for motion),
knobs and defaults, swappable assets, and unverified behavior or remaining
differences. In repo mode also list changed files and verification; in Design
mode hand off source edits the visual-edit way.
