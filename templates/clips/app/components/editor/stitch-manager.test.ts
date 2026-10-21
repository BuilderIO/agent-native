import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(): string {
  return readFileSync(new URL("./stitch-manager.tsx", import.meta.url), "utf8");
}

describe("StitchManager layout", () => {
  it("loads playable media fields for the stitch queue", () => {
    const source = readSource();

    expect(source).toContain(
      'useActionQuery("list-recordings", {\n    includeMedia: true,\n  })',
    );
  });
});
