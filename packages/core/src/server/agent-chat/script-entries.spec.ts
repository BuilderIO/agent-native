import { describe, expect, it } from "vitest";

import { createCallAgentScriptEntry } from "./script-entries.js";

describe("cross-app script entries", () => {
  it("keeps discovery read-only without treating delegation as read-only", async () => {
    const entries = await createCallAgentScriptEntry("analytics");

    expect(entries["describe-workspace-apps"]?.readOnly).toBe(true);
    expect(entries["call-agent"]?.readOnly).not.toBe(true);
  });
});
