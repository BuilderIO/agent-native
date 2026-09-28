import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { navItems } from "../../lib/brain";

const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");

describe("Brain sidebar footer", () => {
  it("does not reserve empty space for a hidden organization switcher", () => {
    expect(source).toContain("<OrgSwitcher compact={collapsed} />");
    expect(source).not.toContain("OrgSwitcher reserveSpace");
    expect(source).toContain('from "@agent-native/core/client/org"');
  });

  it("leaves Settings to the account menu instead of a rail item", () => {
    expect(source).not.toContain("secondaryItems");
    expect(navItems.map((item) => item.view)).not.toContain("settings");
  });
});
