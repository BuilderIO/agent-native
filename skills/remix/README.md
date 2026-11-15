# Remix

Point at something you love on another website, point at the spot in your own
site, and let your coding agent rebuild it there. Remix works in Agent-Native
Design: the source site and your site sit side by side on one canvas, and the
result uses your colors, fonts, and components instead of theirs.

## Install

Run this from your app repository:

```bash
npx @agent-native/core@latest skills add remix
```

This installs the skill and connects it to Agent-Native Design. Keep your app
running when you use `/remix`.

## Examples to try

- **A background effect:** `/remix the hero background from stripe.com into my homepage`
- **A section:** `/remix the pricing table from linear.app into /pricing`
- **A new site:** `/remix the product reveal from apple.com into a new landing page`
- **Learn how it works:** `/remix explain the scroll animation on this page`

If you leave out the source or the destination, the agent asks for it.

## Example: replace a hero background

```text
/remix the wave hero from that site into my homepage
```

Design opens with both pages. Select the effect in the source and the hero in
your page (you can select both at once), and the agent reads the source's
shipped code, rebuilds the effect in your codebase with your design tokens, and
puts it in place.

Select the new background, or anything inside it, and its **Tweaks** section
lists knobs for speed, intensity, and colors. Drag them until it looks right;
your agent can read and set the same values, then write the final ones into your
source as the defaults. Images, videos, and 3D models are each one prop, so you
can swap in your own.

## Remix explain

`/remix explain` lays out a small explainer next to the source instead of
porting anything: one live demo per idea (the effect alone, then its geometry,
shader, and timing), each with its own knobs, like the control panels in
three.js examples.

## What you get

- The remixed part rebuilt in your own code, matched to your design system.
- Knobs for every shader, WebGL, 3D, or animation effect, readable over MCP.
- Swappable assets with placeholders you own; no copied code, logos, fonts, or
  media from the source.

See the [skill instructions](https://github.com/BuilderIO/agent-native/blob/main/skills/remix/SKILL.md)
for the full flow.
