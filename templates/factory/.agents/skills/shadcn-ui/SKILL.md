---
name: shadcn-ui
description: >-
  Using the app's local UI adapter and Toolkit or shadcn primitives. Use when
  choosing or composing standard controls, implementing dialogs, menus, or
  forms, or changing component variants and theme tokens.
scope: dev
---

# shadcn/ui and Local UI Adapters

Use the components already provided by the app. Read the app's design-system
configuration, Toolkit provider, and local UI components before adding or
changing a control. Their exports, variants, and props are the contract; do
not guess from upstream examples.

## Keep imports behind the local adapter

Product pages and domain components should import standard controls through the
app's configured local UI alias. In the Chat starter, that is
`@/components/ui/*`; its `app/components/ui/button.tsx` is a one-line
re-export of `@agent-native/toolkit/ui/button`. Follow an adjacent local shim
when the app needs another Toolkit primitive that is already exported there.

Use the app's configured design system and provider mapping for controls passed
to shared Toolkit surfaces. For shared Toolkit feature presentation, use the
semantic components exposed by `@agent-native/toolkit/design-system`; keep the
feature behavior in its existing controller and customize only its supported
presentation seam.

## Compose existing controls

- Prefer a primitive's built-in variant and size. Put page layout on a parent
  instead of overriding shared component appearance for one screen.
- Use the app's semantic theme tokens for reusable UI, such as
  `bg-background`, `text-muted-foreground`, `border-border`, and `bg-primary`.
  Keep theme values in the app's existing CSS theme file.
- Use the control that matches the choice: `Switch` for a binary setting,
  `Checkbox` for independent multi-select, `RadioGroup` for one choice from a
  short set, and `Select` or the app's combobox for a longer predefined list.
- Compose cards and form fields from the primitives already available. Avoid
  adding explanatory copy that repeats a visible title or label; see
  `frontend-design` for the app's surface-density rules.
- Put selectable items inside their menu or list group primitives. Keep tab
  triggers inside the tab list. Supply an accessible title to dialog, sheet,
  drawer, and alert-dialog content.
- Match the trigger API to the actual local component. Toolkit wrappers may
  expose a different API from the upstream primitive; inspect its props before
  using options such as `asChild` or `render`.

## Keep controls operable

Use the app's existing field components and validation pattern. Associate
errors with their inputs and expose invalid state to assistive technology.
Icon-only actions need an accessible name and a usable focus target. Use the
icon package already installed by the app.

Do not recreate menus, popovers, dialogs, or confirmations with absolute
positioning and custom click-outside handlers. Never use browser `alert`,
`confirm`, or `prompt`; use the app's dialog primitives. Keep overlay focus,
keyboard, dismissal, and stacking behavior from the existing primitive.

For small visual refinements, use layout classes and semantic tokens. Avoid raw
palette overrides, arbitrary one-off values, and manual overlay `z-index` unless
you are fixing a reproduced bug. Use `gap-*` for layout spacing and the app's
class-merging helper when it has one.

## Related skill

- **frontend-design** — Product UX, density, visual direction, and responsive
  behavior.
