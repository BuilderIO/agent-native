import type { ActionEntry } from "../../agent/production-agent.js";

/**
 * Load the sandboxed code-execution tool entries for one action registry:
 * `run-code` plus its `get-code-execution` poll companion. The poll tool is
 * registered ALONGSIDE run-code everywhere run-code appears, so the durable
 * background-execution guidance run-code emits ("check it with
 * get-code-execution") always points at a callable tool. Returns an empty
 * registry when the coding module is unavailable (e.g. bundled browser
 * build), mirroring the prior silent-skip behavior.
 *
 * Exported for tests — the plugin init calls this for the prod, lean, and dev
 * tool bags, so a spec on this helper pins the real registration wiring.
 */
export async function loadRunCodeToolEntries(
  supplier: () => Record<string, ActionEntry>,
  runCodeOptions?: { bridgeTools?: string[] },
): Promise<Record<string, ActionEntry>> {
  try {
    const { createRunCodeEntry, createGetCodeExecutionEntry } =
      await import("../../coding-tools/run-code.js");
    const entries: Record<string, ActionEntry> = {
      "run-code": createRunCodeEntry(supplier, runCodeOptions),
      "get-code-execution": createGetCodeExecutionEntry(),
    };

    // Data programs: stored JS scripts executed through this same run-code
    // sandbox, cached in SQL, and rendered by dashboard panels. Registered
    // identically to run-code — same try/dynamic-import guard, silently
    // skipped when the module is unavailable (e.g. bundled browser build) —
    // so every app gets the primitive without per-template wiring.
    try {
      const { initDataPrograms, createDataProgramActions } =
        await import("../../data-programs/index.js");
      const appId = resolveDataProgramsAppId();
      initDataPrograms({ appId, getActions: supplier });
      Object.assign(
        entries,
        createDataProgramActions({ appId, getActions: supplier }),
      );
    } catch {
      // Module unavailable — skip silently, mirroring the run-code guard above.
    }

    return entries;
  } catch {
    // Module unavailable (e.g. bundled browser build) — skip silently.
    return {};
  }
}

/**
 * Resolve the stable app identity data programs are scoped under. Mirrors
 * the precedent in `cli/agent.ts` (`AGENT_NATIVE_APP_ID` env override, then
 * `APP_ID`, then a fixed fallback) — data programs don't need a per-call
 * agent-supplied appId the way staged datasets do (staged datasets are
 * scratch space the agent explicitly stages into); a data program is a
 * persisted resource scoped to "this app deployment".
 */
function resolveDataProgramsAppId(): string {
  return (
    process.env.AGENT_NATIVE_APP_ID?.trim() ||
    process.env.APP_ID?.trim() ||
    process.env.APP_NAME?.trim() ||
    "app"
  );
}
