/**
 * The `/_agent-native/ping?configuration=1` probe the sign-in banner reads.
 *
 * `createCoreRoutesPlugin` mounts dozens of unrelated routes before `/ping`,
 * so booting the real plugin to reach this handler would stand up most of the
 * server. Following `core-routes-plugin.health-auth.spec.ts`, this checks the
 * handler source of both probe copies; the report they return is exercised
 * through `createServer`'s copy in `create-server.spec.ts`.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function probeSource(file: string, start: string, end: string): string {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("configuration probe missing-settings line", () => {
  // Both copies must report the server's own answer. A copy that falls back to
  // the env-name checks shows no banner on a Netlify function without
  // NODE_ENV while sign-up is refused, or a banner for an unpooled-only URL or
  // a workspace-derived auth secret that the server accepts.
  it.each([
    ["./core-routes-plugin.ts", "`${P}/ping`", "if (!options.disableHealth)"],
    ["./create-server.ts", '"/_agent-native/ping"', "// Env key management"],
  ])("%s reports getMissingDeploySettings()", (file, start, end) => {
    expect(probeSource(file, start, end)).toContain(
      "missingDeploySettings: getMissingDeploySettings()",
    );
  });
});
