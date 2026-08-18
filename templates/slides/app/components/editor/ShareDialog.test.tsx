import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "ShareDialog.tsx"),
  "utf8",
);

describe("<ShareDialog>", () => {
  it("delegates to the shared dialog contract instead of rendering a bespoke URL popup", () => {
    expect(source).toContain('from "@agent-native/core/client/sharing"');
    expect(source).toContain("CoreShareDialog");
    expect(source).toContain("ShareCopyRow");
    expect(source).toContain("writeClipboardText");
    expect(source).toContain("CloudUpgrade");
    expect(source).toContain("fetch(`${appBasePath()}/api/share`");
    expect(source).toContain("/share/${shareToken}");
    expect(source).not.toContain("Popover");
    expect(source).not.toContain("IconExternalLink");
    expect(source).not.toContain("IconCopy");
    expect(source).not.toContain("IconCheck");
    expect(source).not.toContain("value={shareUrl}");
  });
});
