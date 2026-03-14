import React from "react";
import ReactDOM from "react-dom/client";
import {
  App,
  HarnessConfigProvider,
  type HarnessConfig,
} from "@agent-native/harness-shared";
import "./global.css";

const config: HarnessConfig = {
  name: "Codex",
  command: "codex",
  installPackage: "@openai/codex",
  options: [
    {
      key: "fullAuto",
      flag: "--full-auto",
      label: "--full-auto",
      description: "Auto-approve all actions without confirmation",
      defaultValue: true,
    },
    {
      key: "quiet",
      flag: "--quiet",
      label: "--quiet",
      description: "Non-interactive quiet mode",
      defaultValue: false,
    },
  ],
  customPlaceholder: 'e.g. --model o3 --provider openai',
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HarnessConfigProvider config={config}>
      <App />
    </HarnessConfigProvider>
  </React.StrictMode>
);
