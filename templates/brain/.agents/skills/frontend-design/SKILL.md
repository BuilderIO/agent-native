---
name: frontend-design
description: >-
  Create distinctive, production-grade frontend interfaces with high design
  quality. Use when building web components, pages, artifacts, posters, or
  applications (websites, landing pages, dashboards, React components,
  HTML/CSS layouts, or when styling/beautifying any web UI). Generates
  creative, polished UI that avoids generic AI aesthetics.
scope: dev
license: Complete terms in LICENSE.txt
source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
metadata:
  internal: true
---

# Frontend Design

This skill guides creation of distinctive, production-grade frontend interfaces. Implement real working code with strong product judgment, excellent accessibility, and a clear visual point of view.

The user may ask for a component, page, full app, dashboard, marketing surface, or restyle. Before coding, understand the audience and pick a direction that fits the product instead of defaulting to generic SaaS polish.

## Design Thinking

Before coding, decide:

- **Purpose**: What workflow does this surface make easier? What is the primary action?
- **Audience**: Who will use it repeatedly, and what should feel fast, calm, playful, premium, editorial, technical, or utilitarian?
- **Tone**: Choose a concrete aesthetic direction: refined minimal, dense operations console, editorial, playful, industrial, warm handmade, high-contrast data tool, etc.
- **Information hierarchy**: What must be visible in the first five seconds, and what should be progressively disclosed?
- **Differentiation**: What makes this feel designed for this exact domain?

Then implement working code that is cohesive, accessible, responsive, and polished in small details: typography, spacing, copy, motion, empty states, loading states, focus states, and error states.

## Minimalism And Progressive Disclosure

Default to Apple/Linear-level restraint: make the primary workflow obvious, then remove everything that does not help that workflow right now. A polished UI often has fewer visible controls, fewer borders, fewer labels, and fewer explanatory surfaces than the first reasonable implementation.

- **Start by subtracting**: Before adding a visible control, banner, toolbar row, card, or explanatory block, ask what can be removed, merged, renamed, or moved into an existing affordance.
- **One primary action**: Each surface should have one dominant next action. Secondary actions belong in menus, popovers, command palettes, disclosure rows, or contextual hover/focus states unless they are used constantly.
- **Progressively disclose rare work**: Advanced options, diagnostics, metadata, settings, import/export, destructive actions, and inspection tools should stay tucked away until requested. Prefer small icon triggers with tooltips, popovers, drawers, or detail panels over permanent chrome.
- **Keep chrome quiet**: Avoid new always-visible bars, badges, callouts, helper text, and counters unless they prevent mistakes or are central to repeated use. Status can often be a dot, ring, muted count, or tooltip.
- **Favor content over containers**: Do not wrap every section in a card. Use whitespace, alignment, typography, dividers, and full-width bands before adding boxes.
- **Design for repeated use**: Production app UI should feel calm after the hundredth use. If a control shouts, animates, explains itself, or occupies a full row for an occasional action, hide or compress it.
- **Make absence intentional**: Empty states should be sparse and action-oriented. Do not fill blank space with marketing copy, decorative art, or lists of features just because the screen feels empty.
- **Use familiar primitives**: Icon buttons need clear tooltips. Menus, popovers, tabs, switches, and segmented controls should carry complexity instead of exposing every option at once.

## Aesthetic Guidelines

- **Typography**: Use the product's existing type system first. For net-new public pages, choose characterful but readable type and keep sizing appropriate to the surface.
- **Color and theme**: Use semantic tokens and CSS variables. Avoid one-note palettes and default purple/blue gradients unless the brand demands them.
- **Motion**: Prefer purposeful transitions and small state changes. Use CSS transitions/keyframes unless the app already uses a motion library.
- **Composition**: Match the workflow. Operational apps should be dense and scannable; marketing or portfolio pages can be more immersive.
- **Visual assets**: Websites, games, and object-focused pages need real or generated media when images help users understand the subject.
- **Responsive fit**: Text must not overflow buttons, cards, tabs, sidebars, or fixed-format tools. Use stable dimensions for boards, grids, toolbars, and counters.

## Agent-Native UI Rules

- Agent-native apps use React, Vite, Tailwind CSS, shadcn/ui, and `@tabler/icons-react`.
- **Use shadcn/ui primitives for standard UI**: `DropdownMenu`, `Popover`, `Dialog`, `AlertDialog`, `Sheet`, `Tabs`, `Tooltip`, `Select`, `Command`, `Sidebar`, `Table`, `Card`, `Badge`, `Skeleton`, and related primitives.
- **When touching shadcn/ui components, also read `shadcn-ui` if it exists.** That skill covers `components.json`, CLI docs, component composition, theming, and registry workflows.
- Check `app/components/ui/` before importing a shadcn component. If a primitive is missing, add it from the app root with `pnpm dlx shadcn@latest add <component>`, then review the generated file.
- Do not build custom dropdowns, menus, popovers, modals, or confirmations with manual absolute positioning and click-outside effects.
- Never use browser dialogs (`window.alert`, `window.confirm`, `window.prompt`). Use `AlertDialog`, `Dialog`, or app-specific confirmation UI.
- Use Tabler icons for all first-party UI icons. Do not add Lucide, Heroicons, inline SVG icon sets, or emoji icons.
- Use `useActionQuery` and `useActionMutation` from `@agent-native/core/client` for action-backed UI. Standard CRUD should go through actions, not custom `/api/` routes.
- Keep UI optimistic where possible: update cache and navigation immediately, then reconcile or roll back on mutation result.
- Custom styles belong in Tailwind classes, component CSS, or the existing global CSS theme file; avoid inline styles.

## shadcn/ui Design Rules

- Use built-in component variants first (`variant`, `size`) before overriding classes.
- Use semantic tokens (`bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`) instead of raw Tailwind colors for app chrome and reusable components.
- Use `gap-*` in flex/grid layouts instead of `space-x-*` or `space-y-*`.
- Use `size-*` when width and height are equal, and `truncate` instead of spelling out overflow/ellipsis/nowrap.
- Use `cn()` from the local utils alias for conditional classes.
- Dialog, Sheet, Drawer, and AlertDialog content must have an accessible title. Use `sr-only` only when the visible design already communicates the title.
- Put menu/list items inside their group primitives: `SelectGroup`, `DropdownMenuGroup`, `CommandGroup`, and equivalents.
- Use full `Card` composition when the content has a title, description, content, or actions. Do not dump complex cards into a single `CardContent`.
- Use `ToggleGroup` for small option sets, `Switch` for binary settings, `Checkbox` for multi-select, `RadioGroup` for one-of-many, and `Slider`/inputs for numeric values.
- For forms, prefer the app's existing shadcn form pattern. If newer `Field`, `FieldGroup`, or `InputGroup` primitives are installed or appropriate to add, use them instead of raw layout divs.
- Loading states use `Skeleton`, `Progress`, `Spinner`, or the app's existing loading primitives. Empty states should have one clear next action.

## Anti-Patterns

Avoid:

- Generic AI aesthetics: purple gradients, glassy cards everywhere, vague sparkle language, decorative blobs, and context-free hero sections.
- Custom reimplementations of shadcn primitives.
- Raw color overrides on shared components when semantic tokens or variants would work.
- New always-visible controls for rare actions. Prefer menus, popovers, sheets, tabs, collapsibles, or advanced sections.
- Full-width banners, persistent helper rows, decorative cards, or explanatory chrome for status that could be a compact affordance.
- Treating progressive disclosure as optional. If a control is not part of the main daily workflow, hide it until context, hover, focus, or explicit user intent makes it relevant.
- UI cards nested inside other cards.
- Text or icons that resize or shift fixed-format UI on hover/loading.

## Verification

For substantial frontend work:

1. Run the relevant formatter/checks.
2. Start the dev server when the app needs one.
3. Verify with browser screenshots at desktop and mobile widths.
4. Check interactive states: hover, focus, loading, empty, error, and destructive confirmations.

## Related Skills

- **shadcn-ui** — shadcn CLI, component docs, composition rules, theming, and registries
- **self-modifying-code** — The agent can edit source code to apply design changes
- **storing-data** — All data lives in SQL; use actions for data access
- **actions** — `useActionQuery`/`useActionMutation` hooks for frontend data fetching
