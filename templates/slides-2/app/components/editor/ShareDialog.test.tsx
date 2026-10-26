import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// source-read-ok: verifies the app delegates share-dialog ownership to the core UI boundary.
const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "ShareDialog.tsx"),
  "utf8",
);

describe("<ShareDialog>", () => {
  it("delegates to the shared dialog contract instead of rendering a bespoke URL popup", () => {
    expect(source).toContain('from "@agent-native/core/client/sharing"');
    expect(source).toContain("CoreShareDialog");
    expect(source).toContain('title={t("share.title")}');
    expect(source).toContain('"create-share-link"');
    expect(source).not.toContain("ShareCopyRow");
    expect(source).not.toContain("writeClipboardText");
    expect(source).not.toContain("/api/share");
    expect(source).toContain("appPath(`/share/${shareToken}`)");
    expect(source).toContain("/share/${shareToken}");
    expect(source).not.toContain("Popover");
    expect(source).not.toContain("IconExternalLink");
    expect(source).not.toContain("IconCopy");
    expect(source).not.toContain("IconCheck");
    expect(source).not.toContain("value={shareUrl}");
  });
});
