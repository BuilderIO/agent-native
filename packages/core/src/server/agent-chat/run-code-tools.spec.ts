import { describe, expect, it } from "vitest";

import { isMcpActionEligible } from "../../mcp/action-eligibility.js";
import { isFrameworkMcpTool } from "../../mcp/framework-tools.js";
import { loadRunCodeToolEntries } from "./run-code-tools.js";

describe("code execution action registry", () => {
  it("keeps execution and saved-program capabilities internal without replacing app entries", async () => {
    const entries = await loadRunCodeToolEntries(() => ({}), {
      appActionNames: ["list-data-programs"],
    });
    expect(entries).toHaveProperty("run-code");
    expect(entries).toHaveProperty("save-data-program");
    expect(entries).not.toHaveProperty("list-data-programs");
    expect(entries["get-code-execution"].readOnly).toBe(true);
    for (const [name, entry] of Object.entries(entries)) {
      expect(isFrameworkMcpTool(entry), name).toBe(true);
      expect(isMcpActionEligible(name, entry), name).toBe(false);
    }
  });
});
