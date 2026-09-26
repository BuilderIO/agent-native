
import {
  createAcpHarnessAdapter,
  type AcpHarnessAdapterOptions,
} from "./acp-adapter.js";
import { registerAgentHarness } from "./registry.js";

interface AcpPreset {
  name: string;
  label: string;
  description: string;
  command: string;
  args: string[];
}

export const BUILTIN_ACP_PRESETS: AcpPreset[] = [
  {
    name: "acp:gemini",
    label: "Gemini CLI (ACP)",
    description: "Drives the Gemini CLI as a local ACP coding agent.",
    command: "npx",
    args: ["-y", "@google/gemini-cli", "--experimental-acp"],
  },
  {
    name: "acp:claude-code",
    label: "Claude Code (ACP)",
    description: "Drives Claude Code as a local ACP coding agent.",
    command: "npx",
    args: ["-y", "@zed-industries/claude-code-acp"],
  },
];

export function registerBuiltinAcpHarnesses(): void {
  for (const preset of BUILTIN_ACP_PRESETS) {
    registerAgentHarness({
      name: preset.name,
      label: preset.label,
      description: preset.description,
      installPackage: createAcpHarnessAdapter({ command: preset.command })
        .installPackage,
      capabilities: createAcpHarnessAdapter({ command: preset.command })
        .capabilities,
      create: (config) => {
        const overrides = (config ?? {}) as Partial<AcpHarnessAdapterOptions>;
        return createAcpHarnessAdapter({
          name: preset.name,
          label: preset.label,
          description: preset.description,
          command: preset.command,
          args: preset.args,
          ...overrides,
        });
      },
    });
  }
}
