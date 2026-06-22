import { createAcpStdioHarnessAdapter } from "./acp-adapter.js";
import {
  createAiSdkHarnessAdapter,
  type AiSdkHarnessRuntime,
} from "./ai-sdk-adapter.js";
import { registerAgentHarness } from "./registry.js";

/**
 * ACP stdio adapter — the primary built-in harness. Any agent that speaks the
 * Agent Client Protocol over stdio can be wired here. The command, args, and
 * env are resolved at session-creation time.
 *
 * Registered as `acp:stdio`. Requires `@agentclientprotocol/sdk` (a direct dep
 * of `@agent-native/core`).
 */
function registerAcpStdioHarness(): void {
  const adapter = createAcpStdioHarnessAdapter();
  registerAgentHarness({
    name: adapter.name,
    label: adapter.label,
    description: adapter.description,
    installPackage: adapter.installPackage,
    capabilities: adapter.capabilities,
    create: (config) => createAcpStdioHarnessAdapter({ ...(config ?? {}) }),
  });
}

/**
 * AI SDK adapters — compatibility harnesses for Claude Code, Codex, and Pi.
 * These load their runtime packages lazily through optional peer deps.
 */
const AI_SDK_HARNESS_RUNTIMES: AiSdkHarnessRuntime[] = [
  "claude-code",
  "codex",
  "pi",
];

function registerAiSdkHarnesses(): void {
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

export function registerBuiltinAgentHarnesses(): void {
  registerAcpStdioHarness();
  registerAiSdkHarnesses();
}
