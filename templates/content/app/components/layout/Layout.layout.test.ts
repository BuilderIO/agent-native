import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readLayoutSource() {
  return readFileSync(new URL("./Layout.tsx", import.meta.url), {
    encoding: "utf8",
  });
}

describe("app layout", () => {
  it("exposes the sidebar width to editor content for responsive surfaces", () => {
    const source = readLayoutSource();

    expect(source).toContain("const contentSidebarWidth = isMobile");
    expect(source).toContain('"--content-sidebar-width"');
    expect(source).toContain("sidebarCollapsed");
  });
});
