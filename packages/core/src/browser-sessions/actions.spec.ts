import { describe, expect, it } from "vitest";

import { isMcpActionEligible } from "../mcp/action-eligibility.js";
import { isFrameworkMcpTool } from "../mcp/framework-tools.js";
import { createBrowserSessionActionEntries } from "./actions.js";

describe("browser session action registry", () => {
  it("keeps browser capabilities internal, including read-only discovery", async () => {
    const entries = createBrowserSessionActionEntries({
      getOwnerEmail: () => undefined,
    });
    expect(Object.keys(entries)).toHaveLength(7);
    expect(entries["list-browser-sessions"].readOnly).toBe(true);
    for (const [name, entry] of Object.entries(entries)) {
      expect(isFrameworkMcpTool(entry), name).toBe(true);
      expect(isMcpActionEligible(name, entry), name).toBe(false);
    }
    await expect(entries["list-browser-sessions"].run({})).rejects.toThrow(
      "No authenticated user",
    );
  });
});
