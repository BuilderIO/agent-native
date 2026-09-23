import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `useLaunchDarklyFlag`/`useLaunchDarklyFlags` must read evaluated flags
 * through the `get-launchdarkly-flags` action, never by statically reaching
 * `../../launchdarkly/*` (the Node-SDK-backed server module) or the
 * `@launchdarkly/node-server-sdk` package directly. Either would pull the
 * LaunchDarkly server SDK — and whatever SDK key it might see through a
 * misconfigured import — into the browser bundle.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_SPECIFIERS = [
  "@launchdarkly/node-server-sdk",
  "../../launchdarkly/client.js",
  "../../launchdarkly/evaluate.js",
  "../../launchdarkly/index.js",
];

describe("client/launchdarkly stays off the server SDK", () => {
  for (const file of ["index.ts", "use-launchdarkly-flag.ts"]) {
    it(`${file} never imports the LaunchDarkly server module`, () => {
      const code = readFileSync(join(HERE, file), "utf8");
      for (const specifier of FORBIDDEN_SPECIFIERS) {
        expect(code.includes(specifier)).toBe(false);
      }
    });
  }
});
