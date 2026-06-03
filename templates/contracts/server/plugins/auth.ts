import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Visual Plans",
    tagline:
      "Catch risky agent assumptions before they become code and require proof before done.",
    features: [
      "Review the assumptions your coding agent is acting on",
      "Correct agent feedback as structured state instead of chat scrollback",
      "Attach test, command, CI, and human-confirmed evidence to acceptance criteria",
    ],
  },
});
