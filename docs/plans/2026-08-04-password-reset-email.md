# Password Reset Email Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one action. Do not skip steps. Verify after each task. Commit after each task.

**Goal:** Make password-reset delivery work for Google-only users while keeping the configured no-reply sender and reply behavior.

**Architecture:** Keep Better Auth's existing reset-token and credential-creation behavior. Remove only the reset template's `appSender` transport override so `sendEmail` uses `EMAIL_FROM`; preserve app branding in email content.

**Tech Stack:** TypeScript, Better Auth, Vitest, SendGrid transport.

### Task 1: Remove the reset sender override

**Files:**

- Modify: `packages/core/src/server/email-templates.ts`
- Modify: `packages/core/src/email-catalog/system-emails.ts`

**Step 1:** Remove `appSender` from the object returned by `renderResetPasswordEmail`.

**Step 2:** Change the catalog sender label to `Configured no-reply` and describe that password resets use `EMAIL_FROM` without a Reply-To override.

**Step 3: Verify**
Run: `pnpm --filter @agent-native/core typecheck`
Expected: exit code 0.

### Task 2: Add regression coverage

**Files:**

- Modify: `packages/core/src/server/email-templates.spec.ts`
- Modify or create the narrowest existing Better Auth password-route spec after inspecting current test helpers.

**Step 1:** Add a test that a recognized app's reset email has app-branded content but no `appSender`.

**Step 2:** Add a route-level test that an existing social-only user triggers `sendResetPassword` and can create a credential through reset.

**Step 3: Verify**
Run: `pnpm --filter @agent-native/core test -- email-templates better-auth`
Expected: all selected tests pass.

### Task 3: Final verification

**Files:** None.

**Step 1:** Run `pnpm --filter @agent-native/core build`.

**Step 2:** Run `pnpm guards`.

**Step 3:** Exercise the local forgot-password endpoint with an allowed origin and inspect the recorded email attempt.

**Step 4:** Report any production-only remaining risk, especially app-local account storage or stale trusted origins.
