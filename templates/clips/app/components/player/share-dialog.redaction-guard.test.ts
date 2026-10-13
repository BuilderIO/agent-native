import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("sharing is held back while redactions are pending", () => {
  it("replaces the popover's controls with an explanation", () => {
    const source = read("app/components/player/share-dialog.tsx");
    expect(source).toContain("pendingRedactions > 0 ? (");
    expect(source).toContain("shareDialog.redactionsPendingTitle");
  });

  it("refuses the copy-link half of the same control", () => {
    const source = read("app/components/player/share-dialog.tsx");
    const copy = source.slice(
      source.indexOf("const copyShareLink"),
      source.indexOf("writeClipboardText(shareUrl)"),
    );
    expect(copy).toContain("pendingRedactions > 0");
  });

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
