---
name: frontend-design
description: >-
  Sets the visual direction for a new or redesigned surface, with production
  quality that avoids generic AI aesthetics. Use when building, redesigning, or
  cleaning up any user-facing UI, including screenshot-driven feedback, copy or
  density reduction, settings, control placement, or a design pass ("make this
  look good"). Do not load it only for purely mechanical wiring or formatting.
scope: dev
license: Complete terms in LICENSE.txt
source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
local-changes: >-
  Description deliberately widened on 2026-08-09 because the previous narrow
  trigger excluded routine UI edits, including screenshot-driven cleanup, copy
  and density changes, settings, and control placement. An upstream sync must
  not re-narrow it. Verification remains deliberately rescoped; an upstream
  sync must not restore screenshot-everything or broad browser-automation steps.
metadata:
  internal: true
---

# Frontend Design

This skill guides creation of distinctive, production-grade frontend interfaces. Implement real working code with strong product judgment, excellent accessibility, and a clear visual point of view.

The user may ask for a component, page, full app, dashboard, marketing surface, or restyle. Before coding, understand the audience and pick a direction that fits the product instead of defaulting to generic SaaS polish.

## Design Thinking

Before coding, decide:

- **Purpose**: What workflow does this surface make easier? What does the user
  need to understand, decide, or do next?
- **Audience**: Who will use it repeatedly, and what should feel fast, calm, playful, premium, editorial, technical, or utilitarian?
- **Tone**: Choose a concrete aesthetic direction: refined minimal, dense operations console, editorial, playful, industrial, warm handmade, high-contrast data tool, etc.
- **Information hierarchy**: What must be visible to orient and act, and what
  can wait until context or intent makes it relevant?
- **Differentiation**: What makes this feel designed for this exact domain?

Then implement working code that is cohesive, accessible, responsive, and polished in small details: typography, spacing, copy, motion, empty states, loading states, focus states, and error states.

## Visual Direction Contract

Before styling a new app or workspace surface, define its product mode,
audience, visual world, palette family, type treatment, composition, shape
language, and anti-references in `DESIGN.md`. Read
`references/visual-direction.md` for the direction families and review
vocabulary. This is the Impeccable-inspired design contract for Agent-Native
apps: understand the product, name the mode, deal a few coherent directions,
commit to one, and audit the result instead of averaging back to a starter.

Preserve an existing brand system and component library. When no brand exists,
choose a deliberate direction based on the domain and compare sibling apps
before selecting its accent family. Shared behavior and semantic token names
should stay consistent; palette, density, composition, type contrast, and
shape language should not be identical by default.

## High-Signal Minimalism And Progressive Disclosure

Minimalism means fewer competing kinds of UI, not less useful information. Keep
surfaces dense and scannable: reduce redundant prose, decorative containers,
borders, badges, accent colors, and persistent controls before removing content
that helps the user orient, compare, decide, or recover. The reference class is
calm productivity software such as ChatGPT/Codex, Linear, and Vercel, not empty
whitespace.

### Product UX Philosophy

Apply these principles as binding decision rules:

- **Purpose over presence**: Every visible element must support orientation,
  state comprehension, a decision, an action, or recovery. Before adding one,
  name which; if it supports none or duplicates another element, remove or
  defer it.
- **Clarity over cleverness**: Use plain language, familiar patterns, explicit
  hierarchy, and visible state. Do not make decoration or invented terminology
  carry meaning. Preserve the labels, hit targets, focus states, and recovery
  paths required for accessible use.
- **Simple first, powerful on demand**: Keep the current task and state in the
  default presentation. Put advanced, rare, diagnostic, and secondary work
  behind contextual disclosure, menus, or Settings. Do not turn a discoverability
  concern into permanent chrome, and do not hide information needed for the
  current decision.
- **Hierarchy over chrome**: Use typography, spacing, alignment, and restrained
  emphasis to organize information. Treat prose, controls, borders, cards,
  badges, and accent colors as a competition budget: reduce competing kinds of
  elements before reducing useful information. When a surface has one clear
  next decision, give it dominant emphasis and move secondary actions out of
  the default path. Do not wrap every section in a card or add borders for
  grouping alone; use spacing, alignment, typography, or dividers first. A
  container must communicate grouping, state, or interaction.
- **Coherence over novelty**: Reuse the product's primitives, interaction
  patterns, and language. When given a screenshot or reference product, match
  its underlying hierarchy, density, and behavior; do not copy decoration or
  introduce a second visual language without a product reason.
- **Quiet continuity**: Feedback must be immediate, contextual, and honest.
  Preserve the user's place and layout, make loading, empty, and error states
  understandable, and use motion only to explain a change.
- **Respect repeated use**: Optimize for the hundredth use, not the first
  impression. If a control repeats an explanation, occupies persistent space
  for an occasional task, or turns routine work into ceremony, remove it or
  move it to the contextual surface that owns it.

### Progressive Disclosure And Information Timing

Expose information and controls according to relevance, frequency, and
consequence. Before coding, inventory the content and actions and assign them to
the smallest useful visibility layer:

1. **Orient and act**: location, current state, and context needed for the next
   meaningful choice.
2. **Support active work**: details and controls for the selected item or
   current workflow.
3. **Available on demand**: advanced settings, diagnostics, credentials,
   metadata, destructive actions, documentation, and rare tools.

Use a disclosure pattern that matches the task. Keep independent concerns easy
to scan inside an expanded area instead of dumping every form, explanation,
and secondary action into the first reveal. A collapsed row must retain its
label and essential state; remove explanatory subtext unless it changes the
next decision. For configuration with a known current state, show that state
first and expose editing contextually instead of defaulting to a full form.

Before shipping, verify collapsed, expanded, loading, empty, error, and
narrow-width states. The default state fails review when its first viewport
contains multiple unrelated forms, repeated explanatory copy, documentation
links, or controls for unrelated tasks. It also fails when useful information
has been replaced with empty whitespace or extra clicks solely to look minimal.
The default state passes when users can identify their location, current state,
current task, and relevant next choice without reading documentation, while
the useful information remains dense and scannable.

## Aesthetic Guidelines

- **Typography**: Use the product's existing type system first. For SaaS and
  operational apps, make a clear sans-serif hierarchy the default; reserve a
  serif or editorial face for a deliberate content preview or brand moment,
  not the whole application shell.
- **Color and theme**: Use semantic tokens and CSS variables. Avoid one-note palettes, default warm beige/terracotta, and default purple/blue gradients unless the brand demands them. New apps should choose a product-fitting accent family rather than inherit the previous app's color.
- **Motion**: Prefer purposeful transitions and small state changes. Use CSS transitions/keyframes unless the app already uses a motion library. Never `transition-all` — list the properties that actually change (e.g. `transition-[opacity,transform]`). Use the shared easing tokens defined in `packages/core/src/styles/agent-native.css` instead of hand-typing curves: `var(--ease-drawer)` (260ms, drawers/app chrome), `var(--ease-collapse)` (200ms, expand/collapse), `var(--ease-out-strong)` (snappy entrances) — in Tailwind, `ease-[var(--ease-collapse)]`. Enter/exit with ease-out, never `ease-in`. Overlays that zoom in must set the Radix origin var (e.g. `origin-[--radix-popover-content-transform-origin]`). Animate `transform`/`opacity`, not width/height/padding/box-shadow. Gate looping or large-movement animations with `motion-reduce:`. Command palettes and keyboard-triggered actions get no animation.
- **Composition**: Match the workflow. Operational apps should be dense and scannable; marketing or portfolio pages can be more immersive.
- **Visual assets**: Websites, games, and object-focused pages need real or generated media when images help users understand the subject.
- **Responsive fit**: Text must not overflow buttons, cards, tabs, sidebars, or fixed-format tools. Use stable dimensions for boards, grids, toolbars, and counters.

**Beat convergence, not just defaults.** You sample toward the "on-distribution" center, so naming what to avoid is not enough: every "don't" needs a "do", or you converge on the next safe option. Commit to one named direction, pair any reference with the reason it fits, and match implementation effort to the vision. If the brief is open, consider two or three coherent visual worlds, then commit to one instead of averaging them. When building on an existing app, inspect its tokens/type/components first and treat any drift back to a default as a missing token to pin, not something to re-prompt.

## Agent-Native UI Rules

- Agent-native apps use React and Vite. The default adapter uses Tailwind CSS,
  shadcn/ui, and `@tabler/icons-react`, but an app may register a different
  company design system in `app/design-system.ts`.
- **Use the app's design-system seam for standard UI.** Inspect
  `app/design-system.ts`, `ToolkitProvider`, and the local UI adapter directory
  before choosing a primitive. Use shadcn primitives when they are the active
  adapter; use the registered company components when they are not.
- **When touching shadcn/ui components, also read `shadcn-ui` if it exists.** That skill covers `components.json`, CLI docs, component composition, theming, and registry workflows.
- Check `app/components/ui/` before importing a shadcn component. If a primitive is missing, add it from the app root with `pnpm dlx shadcn@latest add <component>`, then review the generated file.
- Pages, routes, and domain components must import controls through the app's
  local adapter path, usually `@/components/ui/*`. Never import
  `@agent-native/toolkit/ui/*` directly in app product code.
- Toolkit/Core feature presentation flows through the semantic components from
  `@agent-native/toolkit/design-system`. Their props express intent, emphasis,
  size, controlled values, and behavior; they do not require Tailwind, CVA, or
  `className`.
- For deeper feature customization, consume the feature-level headless
  controller through its product render slot. The same controller must power
  the default and custom views. Eject the smallest supported unit only after
  tokens, semantic components, controllers, and slots are insufficient.
- Do not build custom dropdowns, menus, popovers, modals, or confirmations with manual absolute positioning and click-outside effects.
- Never use browser dialogs (`window.alert`, `window.confirm`, `window.prompt`). Use `AlertDialog`, `Dialog`, or app-specific confirmation UI.
- Use Tabler icons for all first-party UI icons. Do not add Lucide, Heroicons, inline SVG icon sets, or emoji icons.
- Keep inline help/info glyphs next to labels at `size-3` (12px) or smaller than the adjacent text. Preserve a larger hit area on the trigger, not the glyph. Use `guard:allow-large-help-icon` only for deliberate heading documentation or menu action exceptions.
- Use `useActionQuery` and `useActionMutation` from `@agent-native/core/client` for action-backed UI. Standard CRUD should go through actions, not custom `/api/` routes.
- Keep UI optimistic where possible: update cache and navigation immediately, then reconcile or roll back on mutation result.
- Custom styles belong in Tailwind classes, component CSS, or the existing global CSS theme file; avoid inline styles.

### Agent Surface And Page Boundaries

- Treat the domain UI and the agent as two coordinated surfaces. The domain
  page should make the repeatable job fast; the agent should handle judgment,
  exploration, and actions that benefit from conversation.
- Keep domain work on a named domain route such as `/automations`, `/block`, or
  `/workflow`. Preserve the starter's full-page chat route (`/` or `/chat/*`)
  when it exists; do not replace it with a domain form while leaving the shell
  configured as if it were chat.
- Use the persistent right `AgentSidebar` for contextual AI. A button that
  sends work to `sendToAgentChat` must open or focus that sidebar and leave the
  user on the current domain surface. Use full-page chat for chat-first work,
  not as a hidden transport for a domain button.
- Keep the left navigation domain-specific. A page called Automations,
  Block time, or Create deck should not be nested under a generic Chat item;
  Chat is its own destination and the right rail is the contextual assistant.
- Never use sparkle, wand, magic, robot, or similar decorative AI icons. Use a
  familiar message, assistant, or neutral action icon, and let the button copy
  explain the intent. An icon-only control needs a tooltip and accessible name.
- Give the persistent agent drawer a quiet but intentional boundary: a subtle
  surface shift, divider, or both. The sidebar and domain page should not read
  as one undifferentiated slab, and the treatment should remain calm when the
  drawer opens or closes.
- Treat an AI-labeled button as a contract. Buttons named Ask agent, Review
  with agent, Refine, Generate with AI, or similar must call
  `sendToAgentChat` with bounded context, `openSidebar: true`, and the intended
  `submit` mode. A deterministic local action is useful, but label it local,
  preview, or analyze rather than implying it invoked an agent.

### Product Surface Review

Before shipping a new app or a substantial redesign, review the surface as an
operator would use it repeatedly:

- Can users identify where they are, what state they are in, and what
  meaningful choices or next steps are available?
- Remove competing or redundant elements, then place optional inputs, provider
  choices, diagnostics, long explanations, and secondary actions where they
  remain discoverable without crowding the current task.
- Match the composition to the workflow. Use a focused page or step flow when
  the work is sequential; use an overview when comparing or monitoring several
  things is genuinely the job. Preserve the user's progress in either case.
- Remove generic hero copy, feature tours, repeated helper text, nested cards,
  status-chip soup, and decorative AI treatment before adding more styling.
- For review flows, choose stacking, side-by-side comparison, or another
  composition based on content length, scanability, and the user's comparison
  task.
- Compare the result with sibling apps. Shared toolkit behavior should feel
  consistent, but a repeated palette, hero composition, type pairing, and
  radius language without a product reason is visual drift, not consistency.
- Check the result with realistic content at the target desktop width and a
  narrow width. If it feels like documentation instead of a tool, reduce noise
  or clarify the hierarchy.

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
- Page and section data loading uses layout-matching `Skeleton` geometry. Do
  not show generic "Loading..." text for content loads; reserve `Spinner` for
  brief mutations, uploads, and progress actions. Use the app's existing
  loading primitive when it is a genuine design-system adapter. Empty states
  should communicate the state and offer the appropriate next step or small set
  of choices.

## Anti-Patterns

Avoid patterns that add visual noise, obscure state, or compete with the user's
task without a clear product reason:

- Generic AI aesthetics: purple gradients, glassy cards everywhere, vague sparkle language, decorative blobs, and context-free hero sections.
- Custom reimplementations of shadcn primitives.
- Raw color overrides on shared components when semantic tokens or variants would work.
- New always-visible controls for rare actions when a contextual surface would
  preserve discoverability and reduce noise.
- Full-width banners, persistent helper rows, decorative cards, or explanatory
  chrome for status that could be communicated more clearly with less weight.
- Hiding essential meaning or operability behind progressive disclosure. Defer
  complexity when it is contextual or infrequent, but preserve labels, focus,
  hit targets, accessibility, and recovery paths.
- UI cards nested inside other cards.
- Text or icons that resize or shift fixed-format UI on hover/loading.

## Verification

Match verification effort to the size of the change. For one component, one
form, one page, or a restyle, run the app's existing checks — formatter,
`pnpm typecheck`, existing tests — and stop there.

Escalate to browser verification only when the user asks for it, or when the
change is a multi-step user-visible flow that cannot be confirmed any other
way. Never author a new Playwright/Puppeteer script, add a browser-automation
dependency, or stand up an e2e harness to check work the user did not ask you
to test that way; use an available browser tool, or say what you could not
verify.

For substantial frontend work:

1. Run the relevant formatter/checks.
2. Start the dev server when the app needs one.
3. Verify with the available browser tooling at desktop and mobile widths.
4. Check interactive states: hover, focus, loading, empty, error, and destructive confirmations.
5. When registering or changing a company adapter, run
   `@agent-native/toolkit/conformance`, including mixed-overlay focus,
   `portalContainer`, and z-index stacking checks.
6. For a new app or a visual redesign, review `DESIGN.md` against the rendered
   surface and run the anti-slop audit in `references/visual-direction.md`.

## Related Skills

- **shadcn-ui** — shadcn CLI, component docs, composition rules, theming, and registries
- **customizing-agent-native** — Design-system registration, feature controllers, product slots, conformance, and ejection
- **self-modifying-code** — The agent can edit source code to apply design changes
- **storing-data** — All data lives in SQL; use actions for data access
- **actions** — `useActionQuery`/`useActionMutation` hooks for frontend data fetching
