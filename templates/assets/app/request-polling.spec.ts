import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function appSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Assets application-state request budget", () => {
  it("keeps the root application-state sync subscription mounted", () => {
    const source = appSource("./root.tsx");
    expect(source).toContain("useDbSync({");
    expect(source).toContain('"app-state"');
  });
});
