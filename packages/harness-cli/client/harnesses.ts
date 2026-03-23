import type { HarnessConfig } from "./lib/config";

export const claudeCodeConfig: HarnessConfig = {
  name: "Claude Code",
  command: "claude",
  installPackage: "@anthropic-ai/claude-code",
  options: [
    {
      key: "skipPermissions",
      flag: "--dangerously-skip-permissions",
      label: "--dangerously-skip-permissions",
      description: "Auto-accept all tool use (no confirmation prompts)",
      defaultValue: false,
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

export const codexConfig: HarnessConfig = {
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
  customPlaceholder: "e.g. --model o3 --provider openai",
};

export const geminiConfig: HarnessConfig = {
  name: "Gemini CLI",
  command: "gemini",
  installPackage: "@google/gemini-cli",
  options: [
    {
      key: "sandboxed",
      flag: "--sandbox",
      label: "--sandbox",
      description: "Run in sandboxed mode",
      defaultValue: false,
    },
  ],
  customPlaceholder: "e.g. --model gemini-2.5-pro",
};

export const opencodeConfig: HarnessConfig = {
  name: "OpenCode",
  command: "opencode",
  installPackage: "opencode-ai",
  options: [],
  customPlaceholder: "e.g. --provider anthropic",
};

export const fusionConfig: HarnessConfig = {
  name: "Builder.io",
  command: "fusion",
  installPackage: "@builder.io/fusion",
  options: [],
  customPlaceholder: "e.g. --project my-project",
};

export const agentUiConfig: HarnessConfig = {
  name: "Agent UI",
  command: "agent-ui",
  installPackage: "",
  options: [],
  customPlaceholder: "",
};

export const allHarnesses: HarnessConfig[] = [
  claudeCodeConfig,
  codexConfig,
  geminiConfig,
  opencodeConfig,
  fusionConfig,
  agentUiConfig,
];
