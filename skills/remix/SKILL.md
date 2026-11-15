---
name: remix
description: >-
  Take a section, effect, or interaction from one website and rebuild it in
  another site in Design, matched to the destination's design system, with
  swappable assets and live knobs. Use when the user asks to remix, borrow,
  port, or recreate part of a site in theirs, or asks to "remix explain" how a
  site's effect works.
metadata:
  visibility: exported
---

# Remix

`/remix` takes one part of a source site (a hero, a shader background, a
scroll effect, a 3D card) and rebuilds it inside a destination site so it looks
the same as the source, recolored to the destination. Design is the workbench:
the source and the destination sit side by side as screens, the user points at
what to take and where it goes, and every effect ships with knobs in Design's
Tweaks section.

The editor is hosted at `https://design.agent-native.com`. Open it, connect, and
place screens exactly as `/visual-edit` does (WebMCP `open-visual-edit` in a
page-capable browser, otherwise the hosted Design MCP at
`https://design.agent-native.com/mcp`). Read the visual-edit skill for the
bridge, auth, and handoff rules; this skill covers only what remix adds. Never
start a local Design server.

## Ask Only What Is Missing

Two inputs decide the job. Ask for one only when the request leaves it out:

1. **Source**: the site (and page) to remix from, e.g. `apple.com/airpods-pro`.
2. **Destination**: the running local app or site to remix into, or "a new
   site". For a new site, scaffold a minimal page in the user's stack and run it
   on localhost first.

Do not ask about style, colors, or fonts; the destination answers those. Do not
ask which section yet; the user picks it on the canvas.

## Put Both Sites On The Canvas

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

## Resolve The Pick

Effects usually paint on a layer the user cannot click: a
`pointer-events: none` canvas, video, or background behind the hero wrapper.
Each selected element carries `effectCandidates`: the visible layers behind or
inside it (kind, how much of the pick they cover, whether they animate or use
WebGL). Before extracting:

- One clearly effect-like candidate (say a WebGL canvas covering most of the
  pick): take it and say so in one line, e.g. "You clicked the hero container;
  I'm taking the WebGL canvas behind it."
- Several plausible candidates: ask once, naming each by kind and size, and
  select each on the canvas while you ask when a tool allows.
- Never remix only the clicked wrapper when an effect layer sits behind it.

The user can also pick a hidden layer by hand: right-click the spot and use
**Select layer**.

## Extract From Shipped Code

The running source is the reference for how it looks; its shipped code is the
reference for how it works. Read the code before writing any.

- Drive the source in your own browser (or Design's Interact mode): scroll,
  hover, click, and resize until the effect runs, then read the network log and
  the elements behind the selection.
- Pull the minified JS, CSS, and HTML that drive the selected layer. Find the
  entry point (canvas/WebGL context, `requestAnimationFrame` loop, scroll or
  pointer listeners, GSAP/Three/Lottie/Spline imports, keyframes) and pretty-
  print just that slice. Record shaders, uniforms, easing curves, timings,
  breakpoints, and asset URLs as facts with their file and line.
- Keep everything captured outside the destination repository.
- Rebuild it in the destination in our own code, using the same math,
  geometry, parameters, and timings you recorded. Never paste the source's
  minified bundles, shader source, fonts, logos, icons, copy, or media into
  the destination. Where the source samples a proprietary texture or image,
  generate one procedurally that produces the same result. Owning the code is
  not a licence to change the look.

## Match The Source, Recolor To The Destination

The remix must be visually near-identical to the source: same shape,
composition, scale, placement relative to its container, texture, motion, and
timing. By default change only colors, and fonts and copy if the part has any,
mapping each to the destination's tokens (CSS variables, Tailwind theme, design
system). Change anything else only when the user asks.

- Use the destination's components and conventions for markup; add a component
  in its usual place rather than a pasted blob.
- Respect `prefers-reduced-motion`, keep the page usable without WebGL, and do
  not regress the destination's load time.

## Check Fidelity Before Done

Render the rebuild with the source's original colors beside a capture of the
source at the same viewport and the same animation time (pin the clock or the
time uniform). Compare silhouette, placement, scale, texture, and motion;
change the rebuild and recapture until the two read as the same effect. Only
then swap in the destination's colors. Show the user that side-by-side, and
name any remaining difference.

## Swappable Assets

Make each creative asset (image, video, 3D model, texture, Lottie, font) one
named prop or constant at the top of the component, with a placeholder we own.
Say in the report where to swap each one.

## Knobs Are Always On

Every shader, WebGL, canvas, 3D, or animation effect gets knobs. Expose its
meaningful parameters (speed, intensity, colors, scale, camera, easing,
density) through Design's tweak system, never a private UI:

1. Bind each parameter to a CSS custom property on the effect's root and have
   the effect read it every frame (`getComputedStyle(el).getPropertyValue`), so
   Design's live `tweak-values` updates show instantly.
2. Register the knobs with `update-design`, setting data path `tweaks` to the
   definitions: `{ id, label, type: "slider" | "toggle" | "segment" |
   "color-swatch" | "color-swatches", min, max, step, defaultValue, cssVar,
   unit?, scope }`. Set `scope` to `{ screenId, nodeId }` (or `selector` on a
   URL screen) of the effect's root. Keep existing tweaks; append.
3. Design shows them, already expanded, in the inspector's **Tweaks** section
   whenever the user selects that screen, the effect, or any parent or child of
   it, and never for a sibling.
4. Read values with `get-design-snapshot` (`tweaks`, `appliedTweaks`) and set
   them with `apply-tweaks`. When the user is happy, write the chosen values
   back into the destination source as the defaults.

## Remix Explain

`remix explain <part of a site>` teaches instead of porting. Extract the part as
above, then lay out an explainer microsite on the canvas beside the source:

- One small inline HTML/CSS screen per idea, left to right: the effect in
  isolation, then each layer of how it works (geometry, shader, timing, scroll
  binding), each a live minimal demo with a short caption and the few lines of
  code that matter.
- Every demo has knobs registered as above, like a lil-gui or Tweakpane panel in
  a three.js example, scoped to that screen.
- For something too heavy for inline HTML, run a tiny dev server and add it as a
  localhost screen.

## Motion

When the user wants to retime a remixed animation, the Motion panel (a Design
Lab) can edit GSAP-style tracks and keyframes. It is optional; knobs come first.

## Finish

Show the fidelity side-by-side and the destination screen with the remix in
place, list the knobs and the swappable assets, and name what you could not
reproduce. Hand off source edits
the visual-edit way: the user reviews the diff in the destination repo.
