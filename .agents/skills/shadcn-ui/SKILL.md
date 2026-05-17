---
name: shadcn-ui
description: >-
  Use when adding, updating, debugging, styling, or composing shadcn/ui
  components, forms, dialogs, menus, charts, sidebars, themes, registries, or
  any project with a components.json file.
source: https://ui.shadcn.com/docs/skills
---

# shadcn/ui

This skill keeps shadcn/ui work project-aware. Components are source files in the app, so always inspect the local project before adding, importing, or rewriting them.

## First Steps

1. Work from the app root that owns `components.json`.
2. Run `pnpm dlx shadcn@latest info --json` when you need current project context: framework, Tailwind version, aliases, icon library, installed components, and resolved paths.
3. Use the actual aliases from `components.json` or `shadcn info`; do not assume `@/components/ui` if the project says otherwise.
4. Check `app/components/ui/` or the resolved `ui` path before importing a component.
5. For unfamiliar components, run `pnpm dlx shadcn@latest docs <component>` and read the returned docs or examples before coding.

## Adding Or Updating Components

- Add missing primitives with `pnpm dlx shadcn@latest add <component>` from the app root.
- Before overwriting an existing component, use `pnpm dlx shadcn@latest add <component> --dry-run` and `--diff` to inspect the change.
- After adding registry code, read the generated files. Fix import aliases, icon imports, missing subcomponents, and composition issues before using the component.
- Do not fetch raw component files manually from GitHub when the shadcn CLI can resolve the registry item.
- If a user asks to add a third-party block but does not name a registry, ask which registry to use instead of guessing.

## Component Composition

- Use existing primitives before custom markup: `Alert` for callouts, `Badge` for small status labels, `Separator` for dividers, `Skeleton` for placeholders, `Table` for tabular data, and `Card` for framed content.
- Use full card anatomy when appropriate: `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, and `CardFooter`.
- Dialog, Sheet, Drawer, and AlertDialog content must include an accessible title. Use visually hidden titles only when the visible UI already communicates the title.
- Put items inside their group components: `SelectItem` in `SelectGroup`, `DropdownMenuItem` in `DropdownMenuGroup`, `CommandItem` in `CommandGroup`, and equivalent menu groups.
- `TabsTrigger` belongs inside `TabsList`.
- `Avatar` always needs `AvatarFallback`.
- Buttons do not have magic loading props. Compose loading with `disabled`, `Spinner`, and clear text.

## Forms And Inputs

- Use the app's shadcn form primitives instead of raw div stacks.
- If `Field`, `FieldGroup`, `FieldSet`, or `InputGroup` are installed or worth adding, use them for form layout, grouped fields, and input add-ons.
- Do not place buttons inside inputs with absolute positioning. Use `InputGroup` and `InputGroupAddon` when available.
- Use `ToggleGroup` for small option sets, `RadioGroup` for one-of-many choices, `Checkbox` for multi-select, `Switch` for settings toggles, `Select` or `Combobox` for predefined choices, and `Slider` or numeric input for numeric values.
- Validation must be accessible: pair visual invalid states with `aria-invalid`, and connect descriptions/errors to controls.

## Styling And Theming

- Use semantic tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `border-border`, `text-destructive`) instead of raw colors for reusable app UI.
- Prefer built-in variants and sizes before custom classes.
- Use `className` mostly for layout and spacing; avoid overriding component colors and typography unless the component is intentionally being extended.
- Use `gap-*` instead of `space-x-*` / `space-y-*`.
- Use `size-*` when width and height are equal.
- Use `truncate` for single-line clipping.
- Use `cn()` for conditional classes.
- Do not add manual `z-index` to overlay primitives unless you are fixing a verified stacking bug.
- Add custom colors as CSS variables in the existing Tailwind CSS file reported by shadcn info. For Tailwind v4, register variables with `@theme inline`.

## Transitions And Motion

shadcn's built-in component animations are the right level of polish — keep them. The goal is a snappy, clean UI, not a motionless one. Match shadcn's motion vocabulary; don't strip it and don't pile on decorative custom animation.

- **Never remove or override a shadcn component's default animation.** `data-[state=open]:animate-in`, `data-[state=closed]:animate-out`, `fade-in/out`, `zoom-in/out`, `slide-in-from-*`, accordion height, the `tailwindcss-animate` utilities — these ship for a reason. Leave them as-is.
- **Custom transitions are fine when they communicate a state change and match shadcn's feel.** Reuse the same vocabulary: short durations (~120–200ms), `ease-out`, opacity/transform only, gated on `data-[state=...]`. Examples that are good and welcome:
  - A portaled custom popover/tooltip/sheet that fades + scales/slides in on `data-[state=delayed-open]` / `data-[state=closed]`, mirroring Radix's own content animation.
  - A list row or toast that fades/slides in on mount and out on dismiss.
  - A chevron/caret `rotate` on expand, a subtle `opacity`/`color` hover on an icon button, skeleton shimmer, a progress/height transition on a collapsible.
  - Continuous, product-defining motion where it _is_ the experience (e.g. a multi-stage booking flow's stage transitions) — fine, and framer-motion is acceptable there.
- **Avoid decorative, attention-seeking, or slow motion:** hand-rolled `duration-700` hero fade-ins, parallax, bouncing/spring entrances on ordinary content, animated gradients, staggered cascades on long lists, anything that delays the user seeing or acting on content. If an animation makes the UI feel slower, cut it.
- Rule of thumb: if the motion clarifies what just changed and is over in well under a quarter-second, it's polish; if it's there to look impressive, it's bloat.

## Icons

- Agent-native apps use `@tabler/icons-react`. Do not add `lucide-react` because a registry example used it.
- If registry code imports a different icon package, replace those imports with Tabler equivalents before finishing.
- Let shadcn components size icons through their CSS. Avoid manual icon sizing inside buttons, menus, alerts, and sidebars unless the local component API requires it.

## Base-Specific APIs

Check the project context before using trigger composition APIs:

- Radix-based components use `asChild` for custom triggers.
- Base UI components may use `render` and sometimes `nativeButton={false}`.

Do not wrap triggers in extra divs just to place a Button or Link inside them.

## Related Skills

- **frontend-design** — Product UX, visual direction, responsive polish, and verification
- **actions** — Data fetching and mutation patterns for agent-native apps
- **security** — User data, forms, external input, and action safety
