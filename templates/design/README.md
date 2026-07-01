# Design

An agent-native HTML prototyping studio — describe a screen and get a working
Alpine/Tailwind prototype you can refine, tweak, and export. An open-source,
self-hostable alternative to v0 and Lovable-style prototyping tools.

**Live app: [design.agent-native.com](https://design.agent-native.com)**

Instead of a layered drawing canvas, the agent generates complete self-contained
HTML prototypes, renders them in an iframe, and lets you refine the result with
prompts and visual tweak controls.

## Features

- Generate complete, working HTML prototypes from a prompt.
- Compare multiple design directions, then keep refining the strongest one.
- Visual tweak controls for common copy, layout, color, and spacing changes.
- Save and reuse design-system preferences to stay on-brand.
- Import existing HTML or reference material as context.
- Export real files: HTML, ZIP, or PDF.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-design --standalone --template design
cd my-design
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-design](https://agent-native.com/docs/template-design).
