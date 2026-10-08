import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Dispatch settings SSR entry", () => {
  it("loads the component-only page module", () => {
    const source = readFileSync(
      new URL("../../app/routes/settings.tsx", import.meta.url),
      "utf-8",
    );

    expect(source).toContain(
      "@agent-native/dispatch/routes/pages/settings-page",
    );
  });
});
