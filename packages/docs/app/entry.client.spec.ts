
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
