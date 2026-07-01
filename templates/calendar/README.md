# Calendar

An open-source, agent-native alternative to the Google Calendar + Calendly combo.
An agent-powered calendar with Google Calendar sync and Calendly-style public
booking links — schedule, find slots, and manage availability in plain English.

**Live app: [calendar.agent-native.com](https://calendar.agent-native.com)**

Connect your Google Calendar and the agent can read your schedule, find free
slots, create events, and manage booking links. Anything you can do in the UI,
the agent can do through the same actions.

## Features

- Day, week, and month views with multiple Google accounts overlayed.
- Google Calendar sync and read-only ICS feed subscriptions.
- Weekly availability with timezone support for slot-finding.
- Calendly-style public booking links at `/book/{slug}` with custom fields.
- Ask the agent anything schedule-related, from "am I free Thursday?" to
  creating and rescheduling events.
- Share booking links with teammates and required co-hosts.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-calendar --standalone --template calendar
cd my-calendar
pnpm install
pnpm dev
```

Connecting Google Calendar in dev needs a Google OAuth client — see the docs for
setup. Full docs: [agent-native.com/docs/template-calendar](https://agent-native.com/docs/template-calendar).
