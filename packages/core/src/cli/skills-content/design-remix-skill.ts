export const DESIGN_REMIX_SKILL_MD = `---
name: remix
description: >-
  Rebuild website effects in your repo or Design with exact behavior and original
  code. Use when asked to remix, borrow, port, recreate, explain an effect, or
  /remix source into ours.
metadata:
  visibility: exported
---

# Remix

Use **repo mode** for a source-and-change prompt inside a repository; Design is
not required. Use **Design mode** when the user asks for Design, a canvas or
selection, or wants to pick visually.

## Repo Mode: Run End To End

For \`/remix add the stripe hero animation to ours but make it blue\`, locate
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
   including the original-colors fidelity check below, then show before/after
   images of the destination and the source comparison.

## Design Mode: Choose On The Canvas

Use the current canvas selection, or open the hosted editor at
\`https://design.agent-native.com\`. Connect and place screens as
\`/visual-edit\` does (WebMCP \`open-visual-edit\` in a page-capable browser,
otherwise hosted Design MCP at \`https://design.agent-native.com/mcp\`). Read
visual-edit for bridge, auth, and handoff rules. Never start a local Design server.

Ask only for a missing source or destination; a new site can be scaffolded in
the user's stack. Infer style from the destination. If the prompt already
names the section and destination, use them; otherwise let the user select.

### Put Both Sites On The Canvas

1. Start or reuse the destination dev server and verify the route responds,
   then call \`open-visual-edit\` with its URL and route. That screen is the
   destination.
2. Add the source as a second screen beside it, at the same viewport width.
   Design's URL screens are localhost-backed, and most production sites refuse
   framing, so capture the source with your browser tool (rendered DOM,
   stylesheets, scripts, and assets, saved to a scratch folder outside the
   repo), serve that folder on its own localhost port, and add it with
   \`add-localhost-screens\`. When it cannot be served, add the captured DOM as a
   static screen with \`create-file\`. Title it after the source URL.
3. Tell the user, in one line, to select the part to take in the source and the
   spot it goes in the destination. Both can be selected at once
   (Shift-click across screens): "from this to that". Several source layers
   are one remix; several destination layers mean place it in each.

Read the picks with \`view-screen\` (\`designSelection\`) or the \`Selected objects\`
context block. Ask once if the selection names only one side.

### Resolve The Pick

Effects usually paint on a layer the user cannot click: a
\`pointer-events: none\` canvas, video, or background behind the hero wrapper.
Each selected element carries \`effectCandidates\`: the visible layers behind or
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
timing. By default change only colors, and fonts and copy if the part has any,
mapping each to the destination's tokens (CSS variables, Tailwind theme, design
system). Change anything else only when the user asks.

- Use the destination's components and conventions for markup; add a component
  in its usual place rather than a pasted blob.
- Respect \`prefers-reduced-motion\`, keep the page usable without WebGL, and do
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
density) as typed props or CSS custom properties with defaults. Repo mode
needs no inspector. **Only in Design mode**, also expose them through Design's
tweak system, never a private UI:

1. Bind each parameter to a CSS custom property on the effect's root and have
   the effect read it every frame (\`getComputedStyle(el).getPropertyValue\`), so
   Design's live \`tweak-values\` updates show instantly.
2. Register the knobs with \`update-design\`, setting data path \`tweaks\` to the
   definitions: \`{ id, label, type: "slider" | "toggle" | "segment" |
   "color-swatch" | "color-swatches", min, max, step, defaultValue, cssVar,
   unit?, scope }\`. Set \`scope\` to \`{ screenId, nodeId }\` (or \`selector\` on a
   URL screen) of the effect's root. Keep existing tweaks; append.
3. Design shows them, already expanded, in the inspector's **Tweaks** section
   whenever the user selects that screen, the effect, or any parent or child of
   it, and never for a sibling.
4. Read values with \`get-design-snapshot\` (\`tweaks\`, \`appliedTweaks\`) and set
   them with \`apply-tweaks\`. When the user is happy, write the chosen values
   back into the destination source as the defaults.

## Remix Explain

\`remix explain <part of a site>\` teaches instead of porting. Extract the part as
above, then build original minimal demos from the spec. In repo mode, provide
a local explainer page with typed props/CSS knobs and captures. In Design mode,
lay out an explainer microsite on the canvas beside the source:

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

Show source-versus-result screenshots (and clips for motion) plus destination
before/after images. List knobs, their defaults, swappable assets, and any
unverified behavior or remaining differences. In repo mode, report changed
files and verification directly; in Design mode, hand off source edits the
visual-edit way for review in the destination repo.
`;
