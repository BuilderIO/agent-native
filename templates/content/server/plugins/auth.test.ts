import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const authPluginSource = readFileSync(
  new URL("./auth.ts", import.meta.url),
  "utf8",
);

describe("Content auth public surface", () => {
  it("allows only the named public-document action through the outer auth guard", () => {
    expect(authPluginSource).toContain(
      '"/_agent-native/actions/get-public-document"',
    );
    expect(authPluginSource).not.toMatch(/["']\/_agent-native\/actions\/?["']/);
  });
});
