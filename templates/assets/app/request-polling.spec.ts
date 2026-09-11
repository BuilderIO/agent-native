import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function appSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Assets application-state request budget", () => {
  it.each(["./routes/brand-kits.$id.tsx", "./routes/library.tsx"])(
    "keeps %s on shared DB sync instead of a one-second request loop",
    (path) => {
      const source = appSource(path);
      expect(source).toContain('queryKey: ["app-state"');
      expect(source).not.toMatch(/refetchInterval:\s*1_?000/);
    },
  );

  it("keeps the root application-state sync subscription mounted", () => {
    const source = appSource("./root.tsx");
    expect(source).toContain("useDbSync({");
    expect(source).toContain('"app-state"');
  });
});
