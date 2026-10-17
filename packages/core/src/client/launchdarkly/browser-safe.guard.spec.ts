import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_SPECIFIERS = [
  "@launchdarkly/node-server-sdk",
  "../../launchdarkly/client.js",
  "../../launchdarkly/evaluate.js",
  "../../launchdarkly/index.js",
];

describe("client/launchdarkly stays off the server SDK", () => {
  it("never imports the LaunchDarkly server module or SDK", () => {
    for (const file of ["index.ts", "use-launchdarkly-flag.ts"]) {
      const code = readFileSync(join(HERE, file), "utf8");
      for (const specifier of FORBIDDEN_SPECIFIERS) {
        expect(code.includes(specifier), `${file} -> ${specifier}`).toBe(false);
      }
    }
  });
});
