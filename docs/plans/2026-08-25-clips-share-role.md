# Clips Existing Share Role Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one action. Do not skip steps. Verify after each task. Commit after each task.

**Goal:** Allow Clips owners and share administrators to change an existing user's recording permission from the share dialog.

**Architecture:** Extend the template-owned `SharePeopleTab` to render the existing role `Select` for manageable grants. Reuse the framework `share-resource` upsert action and refetch the existing shares query after a successful update; no new action or API route is needed.

**Tech Stack:** React, TypeScript, shadcn Select, Agent Native action hooks, Vitest.

### Task 1: Add existing-grant role updates

**Files:**
- Modify: `templates/clips/app/components/sharing/share-ui.tsx`

**Step 1: Extend the error action type**

Allow `onError` to receive `"permission"` in addition to `"invite"` and `"remove"`.

**Step 2: Add the role-change handler**

Call `share-resource` with the existing grant's resource, principal type, principal id, and selected role. Refetch `sharesQuery` on success and report `"permission"` on failure.

**Step 3: Render the manager selector**

For manageable grants, replace static role text with the existing compact `Select`, using `ROLE_OPTIONS`, localized labels, role descriptions, and a disabled state while the share mutation is pending. Preserve static role text for non-managers.

**Step 4: Format**

Run: `pnpm exec oxfmt templates/clips/app/components/sharing/share-ui.tsx`

Expected: command exits 0 and only formats the modified file.

### Task 2: Add focused regression coverage

**Files:**
- Modify: `templates/clips/app/components/player/share-dialog.test.ts`

**Step 1: Add the assertion**

Add a focused test asserting that existing manageable grants use the role selector, role changes call the share mutation with the existing principal, and failures use the permission error path.

**Step 2: Format**

Run: `pnpm exec oxfmt templates/clips/app/components/player/share-dialog.test.ts`

Expected: command exits 0.

**Step 3: Run the targeted test**

Run the Clips package's existing Vitest command for `app/components/player/share-dialog.test.ts` as defined in `templates/clips/package.json`.

Expected: all tests in the file pass.

### Task 3: Verify the feature

**Files:**
- Verify: `templates/clips/app/components/sharing/share-ui.tsx`
- Verify: `templates/clips/app/components/player/share-dialog.test.ts`

**Step 1: Run Clips type checking**

Run the typecheck command defined by `templates/clips/package.json`.

Expected: command exits 0.

**Step 2: Run localization guards**

Run: `pnpm guard:i18n-catalogs && pnpm guard:i18n-changed-copy`

Expected: both guards exit 0 and all configured locale catalogs stay aligned.

**Step 3: Exercise the UI**

Open an owned recording's share dialog in the running Clips app. Change an existing grant between Viewer, Commenter, Editor, and Admin; confirm the saved role survives refetch. Confirm a non-manager sees static role text.

Expected: manager changes persist, controls disable during the write, and read-only users cannot edit roles.
