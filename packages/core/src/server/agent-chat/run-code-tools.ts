import type { ActionEntry } from "../../agent/production-agent.js";
import { getAppConfig } from "../../app-config/index.js";
import type { SandboxCodeEvaluator } from "../../coding-tools/run-code.js";

export async function loadRunCodeToolEntries(
  supplier: () => Record<string, ActionEntry>,
  runCodeOptions?: {
    bridgeTools?: string[];
    evaluator?: SandboxCodeEvaluator;
  },
): Promise<Record<string, ActionEntry>> {
  try {
    const { createRunCodeEntry, createGetCodeExecutionEntry } =
      await import("../../coding-tools/run-code.js");
    const { createToolOrchestrationEntry } =
      await import("../../coding-tools/tool-orchestration.js");
    const entries: Record<string, ActionEntry> = {
      "run-code": createRunCodeEntry(supplier, runCodeOptions),
      "tool-orchestration": createToolOrchestrationEntry(supplier, {
        evaluator: runCodeOptions?.evaluator,
      }),
      "get-code-execution": createGetCodeExecutionEntry(),
    };

    try {
      const { initDataPrograms, createDataProgramActions } =
        await import("../../data-programs/index.js");
      const appId = resolveDataProgramsAppId();
      initDataPrograms({
        appId,
        getActions: supplier,
        evaluator: runCodeOptions?.evaluator,
      });
      Object.assign(
        entries,
        createDataProgramActions({
          appId,
          getActions: supplier,
          evaluator: runCodeOptions?.evaluator,
        }),
      );
    } catch {
      // Module unavailable — skip silently, mirroring the run-code guard above.
    }

    return entries;
  } catch {
    return {};
  }
}

function resolveDataProgramsAppId(): string {
  const app = getAppConfig().app;
  return app.id ?? app.name ?? "app";
}
