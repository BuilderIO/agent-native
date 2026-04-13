# Onboarding

The framework-level onboarding system gives every template a shared setup
experience in the agent chat sidebar. Users see a checklist of setup steps,
each with one or more ways to complete it — paste an API key, connect
Builder, or ask the agent to do it for them.

The system is **auto-mounted**. Templates don't need to wire anything to get
the three built-in steps (LLM, database, auth). To add app-specific steps
(Gmail, Slack, Notion, etc.), call `registerOnboardingStep()` from a server
plugin.

## Auto-mounted routes

All routes live under `/_agent-native/onboarding/`:

| Route                                               | Purpose                           |
| --------------------------------------------------- | --------------------------------- |
| `GET /_agent-native/onboarding/steps`               | List steps with completion status |
| `POST /_agent-native/onboarding/steps/:id/complete` | Mark step complete (override)     |
| `POST /_agent-native/onboarding/dismiss`            | Dismiss the onboarding banner     |
| `POST /_agent-native/onboarding/reopen`             | Clear dismissal (re-show panel)   |
| `GET /_agent-native/onboarding/dismissed`           | Read dismissal + allComplete flag |

## Adding a step from a template

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

## Method kinds

| Kind               | Payload                   | Use for                                   |
| ------------------ | ------------------------- | ----------------------------------------- |
| `link`             | `{ url, external? }`      | Send user to an OAuth flow or docs page   |
| `form`             | `{ fields, writeScope? }` | Collect env vars (keys, secrets, URLs)    |
| `builder-cli-auth` | `{ scope: "browser" }`    | Connect Builder (unlocks shared infra)    |
| `agent-task`       | `{ prompt }`              | Send a prompt to the agent chat to handle |

The `primary: true` flag marks a method as the big CTA for its step.

## Built-in steps

| ID         | Required | Description                                   |
| ---------- | -------- | --------------------------------------------- |
| `llm`      | yes      | ANTHROPIC_API_KEY or Builder connection       |
| `database` | no       | SQLite default or a DATABASE_URL for Postgres |
| `auth`     | no       | Local dev mode, Google OAuth, or access token |

Any of these can be overridden by re-registering with the same `id` after the
defaults load.

## Client usage

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
