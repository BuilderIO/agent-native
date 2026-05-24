import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Workbench",
    tagline:
      "A visual command center for AI-assisted work — see what needs your attention, review PRs, monitor agent runs, and build your own mini-tools, all in one place.",
    features: [
      "Cross-source Attention Queue — PRs, agent runs, and errors in one inbox",
      "Best-in-class PR review with AI summaries and risk badges",
      "First-class agent run monitoring — transcripts, blockers, artifacts",
      "Custom Tools — extend Workbench with sandboxed mini-apps the agent builds for you",
    ],
  },
});
