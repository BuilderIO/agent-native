import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");

describe("Brain sidebar footer", () => {
  it("keeps the organization switcher mounted in the bottom-left footer", () => {
    expect(source).toContain("OrgSwitcher reserveSpace");
    expect(source).toContain('from "@agent-native/core/client/org"');
  });
});
