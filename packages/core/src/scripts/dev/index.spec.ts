import { describe, expect, it } from "vitest";

import { isMcpActionEligible } from "../../mcp/action-eligibility.js";
import { isFrameworkMcpTool } from "../../mcp/framework-tools.js";
import { createDevScriptRegistry } from "./index.js";

describe("development action registry", () => {
  it("keeps coding actions and compatibility aliases internal", async () => {
    const entries = await createDevScriptRegistry({
      databaseTools: false,
      legacyAliases: true,
    });
    expect(entries).toHaveProperty("bash");
    expect(entries).toHaveProperty("list-files");
    expect(entries["read-file"].readOnly).toBe(true);
    expect(entries).not.toHaveProperty("db-query");
    for (const [name, entry] of Object.entries(entries)) {
      expect(isFrameworkMcpTool(entry), name).toBe(true);
      expect(isMcpActionEligible(name, entry), name).toBe(false);
    }
  });
});
