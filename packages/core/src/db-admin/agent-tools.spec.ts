import { describe, expect, it } from "vitest";

import { isMcpActionEligible } from "../mcp/action-eligibility.js";
import { isFrameworkMcpTool } from "../mcp/framework-tools.js";
import { createDbAdminAgentTools } from "./agent-tools.js";

describe("database administration action registry", () => {
  it("keeps unscoped administration internal, including metadata reads", () => {
    const entries = createDbAdminAgentTools();
    expect(Object.keys(entries)).toHaveLength(5);
    expect(entries["db-admin-tables"].readOnly).toBe(true);
    expect(entries["db-admin-query"].readOnly).not.toBe(true);
    for (const [name, entry] of Object.entries(entries)) {
      expect(isFrameworkMcpTool(entry), name).toBe(true);
      expect(isMcpActionEligible(name, entry), name).toBe(false);
    }
  });
});
