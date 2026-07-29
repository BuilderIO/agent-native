import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Clips cross-app action catalog", () => {
  it("exposes only the bounded recording player read", async () => {
    const source = await readFile(
      new URL("./agent-chat.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('connectorCatalog: ["get-recording-player-data"]');
  });
});
