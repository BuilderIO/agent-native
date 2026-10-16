---
name: prototypes
description: >-
  Open, edit, republish, and Figma-sync the template prototypes in prototypes/ (Claude artifacts of Design, Chat, Slides, Clips, Analytics). Use when asked to open or change a prototype, push one to its app's Figma page, or pull Figma edits back into it.
scope: dev
user-invocable: true
---

# Prototypes

`prototypes/README.md` is the index: one folder per template, each prototype's artifact link, the kit, and the build. Read it first. Each prototype is one `source.html` that `node prototypes/kit/build.ts <name>` turns into a single page, published as a Claude artifact. Designers and PMs ask the agent to open a prototype; there is no gallery page.

## What a prototype shows

- Shipped-app prototypes (Chat, Slides, Clips web and desktop, Analytics) match the code exactly: the menus' icons, state colors (red where the code uses destructive), copy verbatim (em dashes and emoji included), and the app's custom SVG icons. Check the component before claiming what ships.
- The Design prototype is a redesign. Redesign rules apply there: text-only menus, amber warnings with red only for destructive actions, 24px controls, everything on the 8pt grid. Mark controls the code doesn't have as new.
- Tokens come from the code at build time. Use the code's names (`--color-border`, `--design-editor-accent-color`) and never copy values in.

## Edit and republish

1. Change `<name>/source.html`. Shared needs go in `prototypes/kit/` (menus, Settings, icons via `kit/add-icons.ts`), not copied between prototypes.
2. Add a dated, past-tense entry at the top of `<name>/changes.json`. The prototype's Changes drawer shows it.
3. Build, then load `dist/index.html` headlessly (Playwright, via the main checkout's `node_modules/.pnpm/playwright@*`) in light and dark. Zero page and console errors, and look at a screenshot of what changed.
4. Republish to the link in the README (the Artifact tool's `url`), so the link stays. Publishing only stamps a new version.
5. Commit and push on the current branch.

Building the experience in the app (design to code) is a separate handoff: work in `templates/<app>` from the prototype, its Changes log, and the Figma frames, then follow `adding-a-feature` and `ship`.

## Figma

The Agent-Native file is `oJQ7t9q4e8oHzLZKuki7k1`. Every app already has a page there, because design usually starts in Figma. `<name>/prototype.json` names it under `figma.page` (with `pageId`), lists any `figma.related` pages (Chat's agent chat surface lives on AgentKit, shared by every app), and records `figma.sections`, the sections and frames this prototype maps to. If an app has no page, ask. Don't create one.

Load `figma-use` before every `use_figma` call, and `figma-design-to-code` before `get_design_context`.

### Push: prototype to Figma

Rebuild the screens and states with the file's design system so they stay editable and on-system. Never push screenshots or SVG conversions.

- **Components:** the shadcn UI kit (Nova variants: Button, Icon Button, Toggle Icon Button, Dropdown Menu, Input, and so on). Find them with `search_design_system`, then import by key with `importComponentSetByKeyAsync` or `importComponentByKeyAsync`. The plugin API can't list team libraries.
- **Reuse:** components already on the app's page come first, such as Design's `Editor/*` parts. Anything reused becomes a component or variant set, with properties named like the code's props.
- **Icons:** the kit's icon components, swapped through instance properties. Match the code's glyphs.
- **Color:** bind every paint to the file's variables with `figma.variables.setBoundVariableForPaint`, such as Design's `Design/Tokens` collection, or the variable `search_design_system` finds for the app's token. Use raw hex only where the code has no token.
- **Text and geometry:** Inter, with sizes, weights, and spacing from the code. 24px controls and the 8pt grid.
- **Placement:** one section per surface on the app's page. Update an existing section in place by node id, so links from Jira and docs keep working. Put new sections below existing content, and check bounding boxes for overlap. Don't edit sections someone else made, or a baseline, without asking.
- **Calls:**
  - Make each call idempotent by name, and return the node ids.
  - Run `setCurrentPageAsync` first: new nodes land on the current page, which may be the cover.
  - A failed script rolls back, so re-read before retrying.
  - Call `loadFontAsync` for every font a text node uses.
  - Only slots accept `appendChild` on an instance.
- **Verify:** screenshot the section with `get_screenshot`, and fix what's off. Record new section and frame ids in `prototype.json`.

### Pull: Figma to prototype

1. Find what changed. Use `get_screenshot` for the section or frame the person names, and `use_figma` to read the nodes involved: text, fills and their bound variables, sizes, auto layout, and component properties. Use `get_design_context` when you need code-shaped detail.
2. Map each change into `source.html`:
   - Copy goes in verbatim.
   - A bound variable becomes the matching code token.
   - Sizes snap to the 8pt grid.
   - Components become the prototype's existing parts.
3. Ask when a change is ambiguous or the code can't do it yet. Say which controls are new.
4. Add a Changes entry ("Updated … from Figma"), then build, verify, republish, and commit as above.
