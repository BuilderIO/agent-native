import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");

describe("Brain sidebar footer", () => {
  it("does not reserve empty space for a hidden organization switcher", () => {
    expect(source).toContain("<OrgSwitcher />");
    expect(source).not.toContain("OrgSwitcher reserveSpace");
    expect(source).toContain('from "@agent-native/core/client/org"');
  });

  it("keeps agent controls in the fixed bottom navigation region", () => {
    expect(source).toContain("const bottomNavItems");
    expect(source).toContain("bottomNavItems.map");
  });
});
