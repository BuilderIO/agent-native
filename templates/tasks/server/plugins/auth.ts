import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Tasks",
    tagline:
      "Manage your personal tasks: triage in the inbox, finish from the list. Use an agent that can do all of that for you.",
    features: [
      "Inbox triage — capture ideas and drafts as they come, then promote them to tasks when they are ready",
      "Task management — create, reorder, and complete tasks in a list that stays in the order you put it in",
      "Track what you care about with custom fields — text, numbers, currency, dates, and color-coded selects",
      "Anything you can do here, the agent can do too — and it sees what is on your screen, so “finish these” means the rows you actually selected",
    ],
  },
});
