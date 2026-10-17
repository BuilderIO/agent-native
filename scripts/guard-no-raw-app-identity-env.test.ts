import { describe, expect, it } from "vitest";

import { findRawAppIdentityEnvReads } from "./guard-no-raw-app-identity-env.js";

describe("findRawAppIdentityEnvReads", () => {
  const root = "/repo";
  const files = new Map([
    [
      "/repo/packages/core/src/server/auth.ts",
      "const name = process.env.APP_NAME;\n",
    ],
    [
      "/repo/packages/core/src/app-config/schema.ts",
      "const name = process.env.APP_NAME;\n",
    ],
    [
      "/repo/packages/core/src/server/clean.ts",
      "const name = getAppConfig().app.name;\n",
    ],
  ]);

  it("finds only added raw identity reads outside app-config", () => {
    const findings = findRawAppIdentityEnvReads(
      new Map([
        ["/repo/packages/core/src/server/auth.ts", new Set([1])],
        ["/repo/packages/core/src/app-config/schema.ts", new Set([1])],
        ["/repo/packages/core/src/server/clean.ts", new Set([1])],
      ]),
      (file) => files.get(file) ?? "",
      root,
    );

    expect(findings).toEqual([
      "packages/core/src/server/auth.ts:1: const name = process.env.APP_NAME;",
    ]);
  });

  it("detects bracket notation and all three app identity variables", () => {
    const contents = new Map([
      ["/repo/packages/core/src/a.ts", `process.env["AGENT_APP"]`],
      ["/repo/packages/core/src/b.ts", `process.env.VITE_APP_NAME`],
    ]);
    const findings = findRawAppIdentityEnvReads(
      new Map([...contents.keys()].map((file) => [file, new Set([1])])),
      (file) => contents.get(file) ?? "",
      root,
    );
    expect(findings).toHaveLength(2);
  });
});
