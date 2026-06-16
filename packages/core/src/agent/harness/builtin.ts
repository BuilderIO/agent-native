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
}
