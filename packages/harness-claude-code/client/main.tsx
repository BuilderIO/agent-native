import React from "react";
import ReactDOM from "react-dom/client";
import {
  App,
  HarnessConfigProvider,
  type HarnessConfig,
} from "@agent-native/harness-shared";
import "./global.css";

const config: HarnessConfig = {
  name: "Claude Code",
  command: "claude",
  installPackage: "@anthropic-ai/claude-code",
  options: [
    {
      key: "skipPermissions",
      flag: "--dangerously-skip-permissions",
      label: "--dangerously-skip-permissions",
      description: "Auto-accept all tool use (no confirmation prompts)",
      defaultValue: true,
    },
    {
      key: "resume",
      flag: "--resume",
      label: "--resume",
      description: "Resume the most recent conversation",
      defaultValue: false,
    },
    {
      key: "verbose",
      flag: "--verbose",
      label: "--verbose",
      description: "Enable verbose logging output",
      defaultValue: false,
    },
  ],
  customPlaceholder: 'e.g. --model sonnet --print "hello"',
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HarnessConfigProvider config={config}>
      <App />
    </HarnessConfigProvider>
  </React.StrictMode>
);
