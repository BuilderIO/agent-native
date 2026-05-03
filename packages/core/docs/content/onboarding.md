---
title: "Onboarding & API Keys"
description: "Setup checklist for first-run configuration — API keys, OAuth, and provider connections"
---

# Onboarding

When you first open an app built on the agent-native framework, you'll see a
**Setup** checklist in the agent sidebar. It keeps first-run configuration close
to the agent chat: connect an AI engine, optionally point the app at shared
infrastructure, and add providers only when you need them.

## For end users

### What you'll see

- A **Setup** panel above the agent chat with a checklist like "Connect an AI
  engine", "Email delivery", etc.
- A counter at the top (e.g. "1 of 4") shows how many steps are ready.
- The current step is expanded; finished steps show a green check and stay
  readable if you open them.
- Required steps show a small red **required** pill. The panel stays visible
  until every required step is complete.
- Once everything required is done, the panel hides itself automatically.
- The whole panel can be collapsed with the chevron in the top-right, or
  hidden entirely with **Hide setup** at the bottom.

### How to complete each step

Steps offer one or more **methods** — different ways to satisfy the same
requirement. The primary path is shown first; secondary paths are kept compact
behind a picker or disclosure when a step has several equivalent providers.

- **Connect a service (one click)** — e.g. _Connect Builder_ for the managed
  AI gateway. Click the button, a window opens, you sign in, the window closes,
  and the step is marked complete. No keys to copy.
- **Paste an API key or fill a form** — e.g. choose an LLM provider, database,
  OAuth provider, or email provider, paste the value(s), click **Save**.
  Secret fields use a password input so the value isn't shown on screen. Saved
  values go into your local `.env` (or workspace settings) — see
  [Security](/docs/security) for where they live.
- **Open a link** — some steps point to a sign-in page or docs. Click
  **Continue** and finish the flow in the new tab.
- **Ask the agent** — a few steps offer a "Let the agent set it up" option.
  Click it and the agent picks up in the chat, walking you through any
  external setup (creating OAuth credentials, etc.).

### The built-in steps you'll usually see

- **Connect an AI engine** (required) — the only mandatory step. Connect
  Builder for a one-click managed gateway, or open the secondary provider-key
  picker and paste your own LLM key.
- **Database** (optional) — set `DATABASE_URL` when you want to use a specific
  SQL database connection string.
- **Authentication** (optional) — built-in email/password accounts work by
  default. Add OAuth or access-token sign-in only when you want those paths.
- **Email delivery** (optional) — useful before deploy for password resets,
  team invitations, and share notifications. Use the provider you already use;
  local development can run without it.

Templates can add their own steps on top of these — e.g. a CRM template might
add "Connect Gmail", a docs template might add "Pick a default workspace". See
[Authentication](/docs/authentication) for sign-in setup details.

### Coming back to the checklist

If you hit **Hide setup**, the panel disappears for that browser session.
Required steps that aren't yet complete will surface again on next load. Once
everything required is done, the panel auto-hides for good — there's nothing
left to do.

## For developers

If you're building a template, you register onboarding steps so they appear in
the user's sidebar checklist. The framework handles rendering, completion
tracking, and dismissal — you just declare what the step is and how it's
satisfied.

The system is **auto-mounted**. Templates don't need to wire anything to get
the four built-in steps (LLM, database, auth, email). To add app-specific
steps (Gmail, Slack, Notion, etc.), call `registerOnboardingStep()` from a
server plugin.

### Auto-mounted routes

All routes live under `/_agent-native/onboarding/`:

| Route                                               | Purpose                           |
| --------------------------------------------------- | --------------------------------- |
| `GET /_agent-native/onboarding/steps`               | List steps with completion status |
| `POST /_agent-native/onboarding/steps/:id/complete` | Mark step complete (override)     |
| `POST /_agent-native/onboarding/dismiss`            | Dismiss the onboarding banner     |
| `POST /_agent-native/onboarding/reopen`             | Clear dismissal (re-show panel)   |
| `GET /_agent-native/onboarding/dismissed`           | Read dismissal + allComplete flag |

### Adding a step from a template

```ts
// server/plugins/my-onboarding.ts
import { defineNitroPlugin } from "@agent-native/core/server";
import { registerOnboardingStep } from "@agent-native/core/onboarding";

export default defineNitroPlugin(() => {
  registerOnboardingStep({
    id: "gmail",
    order: 100,
    title: "Connect Gmail",
    description: "Grant read/send access so the agent can work with email.",
    methods: [
      {
        id: "oauth",
        kind: "link",
        primary: true,
        label: "Sign in with Google",
        payload: {
          url: "/_agent-native/google/auth-url?scope=mail",
          external: false,
        },
      },
      {
        id: "delegate",
        kind: "agent-task",
        label: "Let the agent set it up",
        badge: "beta",
        payload: {
          prompt: "Walk me through connecting Gmail. Set env vars as needed.",
        },
      },
    ],
    isComplete: () => !!process.env.GMAIL_REFRESH_TOKEN,
  });
});
```

### Method kinds

| Kind               | Payload                         | Use for                                   |
| ------------------ | ------------------------------- | ----------------------------------------- |
| `link`             | `{ url, external? }`            | Send user to an OAuth flow or docs page   |
| `form`             | `{ fields, writeScope? }`       | Collect env vars (keys, secrets, URLs)    |
| `builder-cli-auth` | `{ scope: "llm" \| "browser" }` | Connect Builder (unlocks shared infra)    |
| `agent-task`       | `{ prompt }`                    | Send a prompt to the agent chat to handle |

The `primary: true` flag marks a method as the big CTA for its step.

### Built-in steps

| ID         | Required | Description                                       |
| ---------- | -------- | ------------------------------------------------- |
| `llm`      | yes      | Builder connection or a provider LLM key          |
| `database` | no       | Default database or any SQL `DATABASE_URL`        |
| `auth`     | no       | Built-in accounts, optional OAuth or access token |
| `email`    | no       | Resend or SendGrid for transactional email        |

Any of these can be overridden by re-registering with the same `id` after the
defaults load.

### Client usage

The panel is already inside `<AgentPanel>`. To build a custom layout:

```tsx
import {
  OnboardingPanel,
  OnboardingBanner,
  useOnboarding,
} from "@agent-native/core/client/onboarding";

function MySidebar() {
  const { allComplete, dismissed, currentStepId } = useOnboarding();
  if (allComplete || dismissed) return <Chat />;
  return (
    <>
      <OnboardingPanel />
      <Chat />
    </>
  );
}
```

For background on where step values are stored and how secrets are handled,
see [Security](/docs/security). For end-user messaging touchpoints (invitations,
password resets) that depend on the **Email delivery** step, see
[Messaging](/docs/messaging).
