# Clips Share Action Spacing Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one action. Do not skip steps. Verify after each task. Commit after each task.

**Goal:** Increase spacing between the Clips share-page view badge, Share button, and options menu from 4px to 8px.

**Architecture:** Keep the existing responsive flex action cluster and change only its Tailwind gap token. No component boundaries, behavior, or responsive rules change.

**Tech Stack:** React, TypeScript, Tailwind CSS, oxfmt

### Task 1: Increase action spacing

**Files:**
- Modify: `templates/clips/app/routes/share.$shareId.tsx`

**Step 1: Update the action cluster**

Replace:

```tsx
<div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-1 sm:w-auto sm:justify-end">
```

with:

```tsx
<div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
```

**Step 2: Preserve the existing design**

Do not change markup, colors, dimensions, radii, typography, button variants, internal badge spacing, breakpoints, wrapping behavior, or media queries.

### Task 2: Verify

**Files:**
- Verify: `templates/clips/app/routes/share.$shareId.tsx`

**Step 1: Format the route**

Run:

```bash
pnpm exec oxfmt templates/clips/app/routes/share.$shareId.tsx
```

Expected: command exits 0.

**Step 2: Run Clips typecheck**

Run:

```bash
pnpm --dir templates/clips typecheck
```

Expected: command exits 0 with no TypeScript errors.

**Step 3: Inspect the rendered header**

Open an authenticated Clips share page at desktop and narrow widths. Confirm the view badge, Share button, and options menu have consistent 8px spacing and retain their previous appearance and wrapping behavior.
