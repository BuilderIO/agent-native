import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { mailLabelDisplayName } from "./label-display";

describe("mailLabelDisplayName", () => {
  it("shows only the final path segment and lets the badge truncate it", () => {
    expect(
      mailLabelDisplayName("[superhuman]/ai/automated_notifications"),
    ).toBe("automated notifications");
  });

  it("is shared by list and detail label chips", () => {
    const list = readFileSync(
      new URL("../components/email/EmailListItem.tsx", import.meta.url),
      "utf8",
    );
    const thread = readFileSync(
      new URL("../components/email/EmailThread.tsx", import.meta.url),
      "utf8",
    );
    const globalCss = readFileSync(
      new URL("../global.css", import.meta.url),
      "utf8",
    );

    expect(list).toContain("mailLabelDisplayName(labelName)");
    expect(list).toContain("{displayName}");
    expect(list).not.toContain("truncate(displayName");
    expect(thread).toContain("mailLabelDisplayName(");
    expect(thread).not.toContain("{labelId}</span>");
    expect(globalCss).toContain("text-overflow: ellipsis;");
    expect(globalCss).toContain("max-width: 120px;");
  });
});
