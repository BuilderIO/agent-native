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

  it("configures the router basename through shared mount recovery", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "entry.client.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'import { configureClientRouterBasename } from "@agent-native/core/client/api-path";',
    );
    const configure = source.search(/^configureClientRouterBasename\(\);$/m);
    expect(configure).toBeGreaterThan(-1);
    expect(configure).toBeLessThan(source.indexOf("hydrateRoot("));
    expect(source).not.toContain("appBasePath()");
  });

  it("installs app-link attribution before hydrating", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "entry.client.tsx"),
      "utf8",
    );

    const install = source.search(/^installAppLinkAttribution\(\);$/m);
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(source.indexOf("hydrateRoot("));
  });
});
