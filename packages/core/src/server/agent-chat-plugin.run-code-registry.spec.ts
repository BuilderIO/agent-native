import { describe, expect, it } from "vitest";

import { loadRunCodeToolEntries } from "./agent-chat-plugin.js";

/**
 * The agent-chat plugin registers the sandboxed code-execution tools through
 * `loadRunCodeToolEntries` for every registry that gets `run-code` (prod,
 * lean, and dev tool bags). These tests pin the registration contract:
 * `get-code-execution` — the standalone, access-scoped poll tool for durable
 * background executions exported by `createGetCodeExecutionEntry` — is
 * registered ALONGSIDE `run-code`, so the enqueue guidance run-code emits
 * ("check it with get-code-execution") always points at a callable tool.
 *
 * The data-programs actions (`save-data-program`, `preview-data-program`,
 * `run-data-program`, `list-data-programs`, `get-data-program`,
 * `delete-data-program`) are registered identically to run-code — same
 * try/dynamic-import guard — so every registry that gets run-code also gets
 * the data-programs primitive without per-template wiring.
 */
describe("loadRunCodeToolEntries (run-code + get-code-execution registration)", () => {
  it("registers get-code-execution and the data-programs actions alongside run-code", async () => {
    const entries = await loadRunCodeToolEntries(() => ({}));
    expect(Object.keys(entries).sort()).toEqual([
      "delete-data-program",
      "get-code-execution",
      "get-data-program",
      "list-data-programs",
      "preview-data-program",
      "run-code",
      "run-data-program",
      "save-data-program",
    ]);
  });

  it("registers get-code-execution as a read-only poll tool keyed on executionId", async () => {
    const entries = await loadRunCodeToolEntries(() => ({}));
    const entry = entries["get-code-execution"];
    expect(entry.readOnly).toBe(true);
    expect(entry.tool?.parameters).toMatchObject({
      type: "object",
      required: ["executionId"],
    });
    expect(
      (entry.tool?.parameters as { properties?: Record<string, unknown> })
        .properties,
    ).toHaveProperty("executionId");
  });

  it("returns a structured error (not a bare throw) for a missing executionId", async () => {
    const entries = await loadRunCodeToolEntries(() => ({}));
    const result = await entries["get-code-execution"].run(
      {} as Record<string, string>,
      undefined,
    );
    const parsed = JSON.parse(String(result));
    expect(parsed.status).toBe("error");
    expect(parsed.error?.code).toBe("execution_id_required");
  });
});
