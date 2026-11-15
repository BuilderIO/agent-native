# Remix

Rebuild an effect or section from another website in your own repo with exact
behavior and original code. Run directly in a repo, or use Agent-Native Design
to pick visually on a canvas. Design is optional.

## Install

Run this from your app repository:

```bash
npx @agent-native/core@latest skills add remix
```

This installs the skill and a Design connector for optional canvas work.
Repo mode uses your coding agent's browser and local dev server.

## Examples to try

- **A background effect:** `/remix the hero background from stripe.com into my homepage`
- **A section:** `/remix the pricing table from linear.app into /pricing`
- **A new site:** `/remix the product reveal from apple.com into a new landing page`
- **Learn how it works:** `/remix explain the scroll animation on this page`

If you leave out the source or the destination, the agent asks for it.

## Example: work directly in a repo

```text
/remix add the stripe hero animation to ours but make it blue
```

The agent finds your hero component, studies the source in its own browser,
writes a behavior spec outside the repo, and implements from that spec in your
stack without copying source expression. It maps the palette to blue, keeps
the behavior exact, exposes typed props or CSS custom properties with defaults,
and verifies matched screenshots/clips. You get before/after images and a
source-versus-result comparison without opening Design.

## Example: pick visually in Design

```text
/remix in Design, the wave hero from that site into my homepage
```

Design opens with both pages. Select the effect in the source and the hero in
your page (you can select both at once), and the agent reads the source's
shipped code, rebuilds the same effect in your codebase with your color tokens,
checks it side by side against the original, and puts it in place. If the
effect sits behind what you clicked, the agent finds it; you can also
right-click and choose **Select layer**.

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

- The remixed part rebuilt in your own code, matching the original in your colors.
- Typed props or CSS knobs with defaults; inspector Tweaks when using Design.
- Swappable assets with placeholders you own; no copied code, logos, fonts, or
  media from the source. Proprietary assets get procedural or openly licensed
  stand-ins with the same visual character.

See the [skill instructions](https://github.com/BuilderIO/agent-native/blob/main/skills/remix/SKILL.md)
for the full flow.
