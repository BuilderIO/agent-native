/**
 * Guard: the docs client entry must wire up stale-chunk recovery the same
 * way the default app scaffold does (see
 * packages/core/src/templates/default/app/entry.client.tsx). Without this,
 * a visitor holding a cached JS chunk from before a deploy hits a hard
 * "Something went wrong" error instead of an automatic reload — see the
 * incident this guard was added for.
 *
 * This only checks that the wiring is present in source, not the recovery
 * behavior itself (that's covered by
 * packages/core/src/client/route-chunk-recovery.spec.ts and
 * client-bootstrap.spec.ts). `appBasePath()` also installs recovery
 * transitively via `initializeAgentNativeClient()`, so this call is
 * belt-and-suspenders — but it must stay explicit so the wiring doesn't
 * silently depend on that side effect.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("docs client entry", () => {
  it("installs route chunk recovery", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "entry.client.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'import { installRouteChunkRecovery } from "@agent-native/core/client/route-chunk-recovery";',
    );
    expect(source).toMatch(/^installRouteChunkRecovery\(\);$/m);
  });
});
