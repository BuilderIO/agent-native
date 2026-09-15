import {
  createAcpHarnessAdapter,
  type AcpHarnessAdapterOptions,
} from "./acp-adapter.js";
import { registerBuiltinAcpHarnesses } from "./acp-builtin.js";
import {
  createAiSdkHarnessAdapter,
  type AiSdkHarnessRuntime,
} from "./ai-sdk-adapter.js";
import { registerAgentHarness } from "./registry.js";

const AI_SDK_HARNESS_RUNTIMES: AiSdkHarnessRuntime[] = [
  "claude-code",
  "codex",
  "pi",
];

export function registerBuiltinAgentHarnesses(): void {
  for (const runtime of AI_SDK_HARNESS_RUNTIMES) {
    const adapter = createAiSdkHarnessAdapter({ runtime });
    registerAgentHarness({
      name: adapter.name,
      label: adapter.label,
      description: adapter.description,
      installPackage: adapter.installPackage,
      capabilities: adapter.capabilities,
      create: (config) =>
        createAiSdkHarnessAdapter({
          runtime,
          ...(config ?? {}),
        } as Parameters<typeof createAiSdkHarnessAdapter>[0]),
    });
  }

  // Generic ACP entry: resolve with { command, args } for any ACP agent.
  const acpAdapter = createAcpHarnessAdapter({ command: "acp" });
  registerAgentHarness({
    name: "acp",
    label: "ACP Agent",
    description: "Drives a local ACP-compliant coding agent over stdio.",
    installPackage: acpAdapter.installPackage,
    capabilities: acpAdapter.capabilities,
    create: (config) =>
      createAcpHarnessAdapter({
        ...((config ?? {}) as Partial<AcpHarnessAdapterOptions>),
      }),
  });

  registerBuiltinAcpHarnesses();
}
