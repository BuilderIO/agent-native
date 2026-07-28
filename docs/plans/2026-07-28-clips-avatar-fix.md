# Clips User Avatar Fix Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one action. Do not skip steps. Verify after each task. Commit after each task.

**Goal:** Display stored Agent Native profile avatars in the Clips viewer popover and share-access list while preserving existing fallbacks and styling.

**Architecture:** Resolve avatar URLs on the client with the framework's cached `useAvatarUrl(email)` hook. Keep avatar lookup in small row-level components so React hooks remain unconditional, and render images through the existing shadcn avatar primitive.

**Tech Stack:** React, TypeScript, Agent Native core avatar hook, shadcn/Radix Avatar, Tailwind CSS.

### Task 1: Render avatars in the viewed-by popover

**Files:**
- Modify: `templates/clips/app/components/sharing/viewed-by-popover.tsx`

**Step 1: Extend imports**

Import `useAvatarUrl` from `@agent-native/core/client/hooks` alongside `useActionQuery`, and import `AvatarImage` from the existing avatar module.

**Step 2: Add the row avatar component**

Add a `ViewerAvatar` component that accepts `email`, `name`, and the fallback label. It calls `useAvatarUrl(email)` once, renders `<AvatarImage src={avatarUrl} alt={label} />` only when a URL exists, and preserves the current `h-6 w-6`, fallback classes, and initials logic.

**Step 3: Replace the inline fallback-only avatar**

Render `ViewerAvatar` in each view row. Do not change row layout, labels, timestamps, query behavior, or anonymous handling.

**Step 4: Verify formatting**

Run: `pnpm exec oxfmt templates/clips/app/components/sharing/viewed-by-popover.tsx`
Expected: command exits successfully and only formatting changes are applied.

### Task 2: Render avatars in the share-access list

**Files:**
- Modify: `templates/clips/app/components/sharing/share-ui.tsx`

**Step 1: Extend imports**

Import `useAvatarUrl` with the existing Agent Native hooks and import the existing shadcn `Avatar`, `AvatarFallback`, and `AvatarImage` primitives under names that do not conflict with the exported access-list avatar component.

**Step 2: Update the access-list avatar component**

For user principals, call `useAvatarUrl(label)`, render the stored image when present, and preserve the current `h-7 w-7`, rounded shape, typography, background, and initial fallback. For organization principals, keep the existing group icon and do not issue an avatar lookup.

**Step 3: Keep all share behavior unchanged**

Do not change share actions, access roles, invite/remove behavior, labels, or server responses.

**Step 4: Verify formatting**

Run: `pnpm exec oxfmt templates/clips/app/components/sharing/share-ui.tsx`
Expected: command exits successfully and only formatting changes are applied.

### Task 3: Verify Clips

**Files:**
- Verify: `templates/clips/app/components/sharing/viewed-by-popover.tsx`
- Verify: `templates/clips/app/components/sharing/share-ui.tsx`

**Step 1: Run type checking**

Run: `pnpm --dir templates/clips typecheck`
Expected: exit code 0.

**Step 2: Run tests**

Run: `pnpm --dir templates/clips test`
Expected: exit code 0.

**Step 3: Verify in the browser**

Open a Clips recording with known viewers and shares. Confirm stored user profile images appear in both popovers, users without images retain initials, anonymous viewers retain the generic fallback, organization shares retain the group icon, and the existing dimensions/layout are unchanged.
