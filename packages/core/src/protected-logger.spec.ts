import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { KNOWN_PLAINTEXT_SENTINEL } from "./e2ee/contracts.js";
import { logProtectedExecutionReceipt } from "./protected-logger.js";

const receipt = {
  version: 1,
  actionName: "protected-fixture",
  resourceType: "document",
  placement: "enrolled_broker",
  status: "executed",
} as const;

describe("protected structured logger", () => {
  it("emits only a bounded event and content-free receipt", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logProtectedExecutionReceipt({
      level: "info",
      event: "broker_job_queued",
      receipt,
    });
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).not.toContain(KNOWN_PLAINTEXT_SENTINEL);
    expect(info).toHaveBeenCalledWith("agent_native_protected_execution", {
      event: "broker_job_queued",
      receipt,
    });
  });

  it("keeps raw console calls out of the protected Core execution modules", () => {
    const protectedModules = [
      "action-execution.ts",
      "protected-execution-context.ts",
    ];
    for (const file of protectedModules) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/\bconsole\s*\./);
    }
  });
});
