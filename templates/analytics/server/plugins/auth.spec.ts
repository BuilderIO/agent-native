import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const authTsSource = readFileSync(
  new URL("./auth.ts", import.meta.url),
  "utf8",
);

describe("analytics auth plugin background startup", () => {
  it("keeps Better Auth out of durable background cold starts", () => {
    expect(authTsSource).toContain(
      'markDefaultPluginProvided(nitroApp, "auth")',
    );
    expect(authTsSource).toMatch(
      /if \(isInBackgroundFunctionRuntime\(\)\) \{[\s\S]*?return;\s*\}\s*await authPlugin\(/,
    );
  });
});
