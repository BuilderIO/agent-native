# Magic Link Sign-In Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one action. Do not skip steps. Verify after each task. Commit after each task.

**Goal:** Make email magic links the default auth method below Google sign-in while preserving password auth as an optional alternate mode.

**Architecture:** Configure Better Auth's built-in `magicLink` plugin in Core and deliver its single-use URLs through the existing `sendEmail` transport. Render a new shared system-email template and expose one default email form in the server-rendered onboarding page; the existing password forms remain available behind an in-page mode switch.

**Tech Stack:** TypeScript, Better Auth 1.6.16, server-rendered HTML/JavaScript, Vitest, SendGrid/Resend via Core `sendEmail`.

### Task 1: Add the magic-link transactional email

**Files:**

- Modify: `packages/core/src/server/email-templates.ts`
- Modify: `packages/core/src/server/email-templates.spec.ts`
- Modify: `packages/core/src/email-catalog/system-emails.ts`
- Modify: `.changeset/transactional-email-catalog.md`

**Step 1: Add the renderer contract and implementation**

Add `RenderMagicLinkEmailArgs` and `renderMagicLinkEmail()` beside the other auth messages. Use `getAppSlug()` and `resolveBrand()` for content branding, render a “Sign in” CTA with the generated URL, explain that the link is single-use and short-lived, and return only `{ subject, html, text }` so the configured sender and effective no-reply address are preserved.

```ts
export interface RenderMagicLinkEmailArgs {
  email: string;
  magicLinkUrl: string;
}

export function renderMagicLinkEmail(
  args: RenderMagicLinkEmailArgs,
): RenderedEmailMessage {
  const email = stripCrlf(args.email);
  const brand = resolveBrand(getAppSlug());
  const { html, text } = renderEmail({
    brandName: brand,
    preheader: `Use this secure link to sign in to ${brand}.`,
    heading: `Sign in to ${brand}`,
    paragraphs: [
      `Use the button below to sign in as ${emailStrong(email)}.`,
      `This link is single-use and expires soon.`,
    ],
    cta: { label: "Sign in", url: args.magicLinkUrl },
    footer: `If you didn't request this, you can safely ignore this email.`,
  });
  return { subject: `Sign in to ${brand}`, html, text };
}
```

**Step 2: Register the catalog definition**

Export `CORE_MAGIC_LINK_EMAIL_ID = "core.magic-link-sign-in"`, import the renderer, and register it with:

```ts
defineTransactionalEmail({
  id: CORE_MAGIC_LINK_EMAIL_ID,
  app: "core",
  name: "Magic link sign-in",
  trigger:
    "A user chooses Continue with email on the sign-in screen. The single-use link signs in an existing user or creates a verified account after a new recipient opens it.",
  recipientLabel: "Entered email address",
  recipient:
    "The normalized address entered in the magic-link form. Delivery occurs before the UI reports success.",
  senderLabel: "Configured no-reply",
  sender:
    "The configured EMAIL_FROM with no Reply-To override. First-party deployments use noreply@agent-native.com.",
  preview: () =>
    renderMagicLinkEmail({
      email: SAMPLE_EMAIL,
      magicLinkUrl: SAMPLE_URL,
    }),
});
```

**Step 3: Add renderer tests**

Test that custom app branding appears in the subject/body, the generated URL is present, and `appSender` is undefined.

**Step 4: Update the existing changeset**

Extend `.changeset/transactional-email-catalog.md` to mention default magic-link auth and its catalog entry; do not add a duplicate Core changeset.

**Step 5: Verify**

Run: `pnpm --filter @agent-native/core exec vitest run src/server/email-templates.spec.ts src/email-catalog/registry.spec.ts`

Expected: all selected tests pass.

### Task 2: Configure Better Auth magic links

**Files:**

- Modify: `packages/core/src/server/better-auth-instance.ts`
- Modify: `packages/core/src/server/better-auth-instance.spec.ts`

**Step 1: Import and mount the plugin**

Import `magicLink` from `better-auth/plugins`. Add it before JWT and bearer in the shared `plugins` array so every app receives the routes.

```ts
magicLink({
  sendMagicLink: async ({ email, url }) => {
    const { subject, html, text } = renderMagicLinkEmail({
      email,
      magicLinkUrl: url,
    });
    await sendEmail({
      to: email,
      subject,
      html,
      text,
      templateId: CORE_MAGIC_LINK_EMAIL_ID,
    });
  },
}),
```

Import `CORE_MAGIC_LINK_EMAIL_ID` and `renderMagicLinkEmail` alongside the existing reset/verification imports. Do not pass `appSender` or a Reply-To override.

**Step 2: Preserve extension plugins**

Keep `...(config?.plugins ?? [])` after Core's plugins so app-provided Better Auth plugins continue to mount.

**Step 3: Add configuration coverage**

Use a hoisted `betterAuth` mock in a focused spec to capture the options passed by `createBetterAuthInstance`, invoke the magic-link plugin callback with a Google-only user's email and generated URL, and assert `sendEmail` receives the recipient, rendered content, and `CORE_MAGIC_LINK_EMAIL_ID` without `appSender`, `from`, or `replyTo`. Verify extension plugins remain in the final array.

Do not re-test Better Auth internals. Its own contract covers finding an existing social-only user and creating a verified user at link verification; our test covers that Core does not block either account shape before sending.

**Step 4: Verify**

Run: `pnpm --filter @agent-native/core exec vitest run src/server/better-auth-instance.spec.ts src/server/email.spec.ts`

Expected: all selected tests pass.

### Task 3: Make magic link the default sign-in UI

**Files:**

- Modify: `packages/core/src/server/onboarding-html.ts`
- Modify: `packages/core/src/server/onboarding-html.spec.ts`

**Step 1: Add localized copy keys**

Add corresponding values to every locale in `AUTH_LOCALE_COPY` for:

- `continueWithEmail`
- `emailLinkSubtitle`
- `usePasswordInstead`
- `useEmailLinkInstead`
- `emailLinkSent`
- `emailLinkSentDescription`
- `resendMagicLink`
- `magicLinkFailed`
- `magicLinkExpired`

The English source copy is:

```ts
continueWithEmail: "Continue with email",
emailLinkSubtitle: "Sign in or create an account with a secure email link",
usePasswordInstead: "Use password instead",
useEmailLinkInstead: "Use an email link instead",
emailLinkSent: "Check your email",
emailLinkSentDescription: "We sent a secure sign-in link to your email address.",
resendMagicLink: "Resend link",
magicLinkFailed: "Could not send sign-in link.",
magicLinkExpired: "This sign-in link is invalid or has expired. Request a new one.",
```

**Step 2: Render the default form**

Insert `#magic-link-form` before the password tabs with:

```html
<form id="magic-link-form" class="form active">
  <label for="m-email">Email</label>
  <input
    id="m-email"
    type="email"
    autocomplete="email"
    autofocus
    placeholder="you@example.com"
    required
  />
  <button type="submit">Continue with email</button>
  <p class="msg" id="m-msg" aria-live="polite"></p>
  <button
    type="button"
    class="link-button auth-method-toggle"
    id="use-password"
  >
    Use password instead
  </button>
</form>
```

Wrap the existing tabs, signup form, verification step, login form, and forgot form in `#password-auth` hidden by default. Add `#use-email-link` in password mode to return to magic-link mode. Do not render either section in `googleOnly` mode.

**Step 3: Add mode-switch behavior**

Add `setAuthMethod("magic-link" | "password")` that toggles `#magic-link-form` and `#password-auth`, transfers a valid email between `#m-email`, `#s-email`, `#l-email`, and `#f-email`, updates heading/subtitle keys, and never writes the method to localStorage. Existing `setActiveTab()` continues to manage only password signup/login forms.

Default to magic-link on every page load except when the URL explicitly requests password context (`?tab=login`, `?tab=signup`, `/login`, `/signup`, reset errors, or verified-password-signup completion).

**Step 4: Submit magic-link requests**

POST to the app-scoped endpoint:

```js
fetch(__anPath("/_agent-native/auth/ba/sign-in/magic-link"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: email,
    callbackURL: __anResumeHref(),
    errorCallbackURL: __anPath("/_agent-native/sign-in?magicLinkError=1"),
  }),
});
```

Normalize and validate the email before submission. Disable the button while awaiting delivery. On success show `emailLinkSentDescription`, change the button to `resendMagicLink`, and retain the email for resends. On non-2xx or network failure restore the button and show `magicLinkFailed`.

**Step 5: Handle verification errors**

On `magicLinkError` or Better Auth's `error` query parameter, default to magic-link mode and render `magicLinkExpired`. Preserve the existing resume destination and do not echo provider error details.

**Step 6: Update auth-view copy mapping**

Add a `magic-link` view mapping to the current heading/subtitle helpers. Leave Google-only, verification, forgot-password, signup, and login mappings intact.

**Step 7: Add HTML behavior tests**

Extend `onboarding-html.spec.ts` to assert:

- Google button markup and handler are unchanged.
- `#magic-link-form` is active by default and the password wrapper is not.
- The request uses the app-scoped Better Auth magic-link endpoint and resume callback.
- Mode toggles transfer email but do not persist auth-method choice.
- Password signup/login/forgot forms and routes remain present.
- `googleOnly` omits both magic-link and password sections.
- Invalid/expired callbacks select magic-link mode and show localized generic copy.
- Every locale has all new keys.

**Step 8: Verify**

Run: `pnpm --filter @agent-native/core exec vitest run src/server/onboarding-html.spec.ts`

Expected: all onboarding HTML tests pass with `BETTER_AUTH_URL` explicitly isolated in the affected origin test.

### Task 4: Verify the complete flow

**Files:** None.

**Step 1: Build Core**

Run: `pnpm --filter @agent-native/core build`

Expected: TypeScript, CLI TypeScript, dist finalization, and dist import checks exit 0.

**Step 2: Run focused auth/email tests**

Run: `pnpm --filter @agent-native/core exec vitest run src/server/better-auth-instance.spec.ts src/server/email.spec.ts src/server/email-templates.spec.ts src/server/onboarding-html.spec.ts src/email-catalog/registry.spec.ts`

Expected: all selected tests pass.

**Step 3: Run workspace guards**

Run: `pnpm guards`

Expected: all guards pass.

**Step 4: Browser verification**

Open `/dispatch/_agent-native/sign-in` and verify:

1. Google sign-in is visually and behaviorally unchanged.
2. Magic-link email is the default section below “or”.
3. Invalid email is rejected client-side.
4. A valid request shows the success/resend state only after the API responds.
5. “Use password instead” reveals existing signup/login and Forgot Password.
6. “Use an email link instead” returns to magic-link mode.
7. Mobile layout and keyboard focus remain usable.

**Step 5: Delivery verification**

Use an allowed origin and a controlled test address in the current app database. Confirm SendGrid accepts the message from configured `EMAIL_FROM`, no Reply-To override is present, `core.magic-link-sign-in` appears in email activity, the link creates/signs in the user, and the callback returns to the original app path.

**Step 6: Final integrity check**

Run: `git diff --check`

Expected: no whitespace errors.
