# UI Aesthetic Preferences

Guidelines for building UI in this project, based on established preferences.

## General Principles

- **Minimal chrome** — avoid unnecessary headers, labels, and decorative elements. If a section's purpose is obvious from context, skip the heading.
- **No emoji in UI** unless explicitly requested.
- **Avoid visual clutter** — remove status indicators (dots, badges) unless they serve a clear functional purpose. If something is configured and working, it doesn't need a green dot.
- **Keep controls compact** — use small (`text-[11px]`, `h-7`) buttons and controls. Dense UI is preferred over spacious/padded layouts.

## Inputs & Controls

- **Give inputs a background** — all interactive inputs (textareas, selects, toggle groups, drop zones) should use `bg-muted` to visually distinguish them from the page background. This applies to:
  - Text inputs and textareas
  - Select dropdowns
  - Toggle button groups
  - Drag-and-drop zones
- **Toggle groups** — use segmented button bars with `border-border` dividers. Active state: `bg-foreground text-background`. Inactive: `text-muted-foreground`.
- **Multi-select toggles** — show a `Check` icon (lucide) when selected, not radio dots or checkboxes.

## Buttons

- **No decorative icons on action buttons** — e.g. no sparkle icon on "Generate". Keep action buttons text-only unless the icon is functional.
- **Loading state** — when a button triggers an async action, replace all button text with a spinner only (no "Loading..." or "Generating..." text). Keep the button disabled.
- **Cancel pattern** — use a plain gray `X` icon next to the loading button, not a full "Cancel" button with outline/text. Just the icon, with `text-muted-foreground hover:text-foreground`.

## Layout

- **Content max-width** — use `max-w-3xl mx-auto` for centered content panels.
- **Spacing** — use `space-y-5` for section gaps, `space-y-3` within sections, `gap-1.5` for inline control groups.
- **Labels** — use `text-xs font-medium text-muted-foreground` for field labels above inputs. Use `text-[11px] text-muted-foreground` for inline labels next to controls.

## Errors

- **Error display** — use `bg-destructive/10 border border-destructive/20` cards with the model/source name in `font-medium` and the error message in `text-xs text-destructive/80`.

## Components

- **Break down complex UI** into smaller component files. Even within a single page, create auxiliary files to keep things maintainable.
- **Avoid deeply nested JSX** — extract sections into their own components when a render function exceeds ~80 lines.

## State Persistence

- **Persist user preferences in `localStorage`** — model selections, sizes, mode toggles, and other settings that the user configures should survive page reloads. Use the `useLocalStorage` hook from `@/hooks/use-local-storage`.
