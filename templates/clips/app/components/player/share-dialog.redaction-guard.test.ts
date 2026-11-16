import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// oracle-change: share-dialog.test.tsx now exercises the redaction controls and blocked copy behavior directly.
describe("sharing is held back while redactions are pending", () => {
  it("is wired up on every screen that offers sharing", () => {
    for (const path of [
      "app/routes/_app.r.$recordingId.tsx",
      "app/routes/share.$shareId.tsx",
      "app/components/library/library-grid.tsx",
    ]) {
      expect(read(path), path).toContain("pendingRedactions={");
    }
  });

  it("gives the library the count it needs to do that", () => {
    expect(read("actions/list-recordings.ts")).toContain("pendingRedactions:");
  });
});
