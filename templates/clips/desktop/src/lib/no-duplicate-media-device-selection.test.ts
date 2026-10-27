import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("desktop mic resolver has a single source of truth", () => {
  it("does not re-fork shared/media-device-selection.ts locally", () => {
    expect(
      existsSync(new URL("./media-device-selection.ts", import.meta.url)),
    ).toBe(false);
  });

  it("imports the resolver from the shared module, not a local copy", () => {
    const consumers = [
      new URL("./media-capture-constraints.ts", import.meta.url),
      new URL("../hooks/useMediaDevices.ts", import.meta.url),
    ];
    for (const consumer of consumers) {
      const source = readFileSync(consumer, "utf8");
      expect(source, consumer.pathname).toContain(
        `../../../shared/media-device-selection"`,
      );
    }
  });
});
