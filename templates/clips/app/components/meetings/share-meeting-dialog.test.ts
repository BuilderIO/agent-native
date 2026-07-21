import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "app/components/meetings/share-meeting-dialog.tsx"),
  "utf8",
);

describe("meeting share popover", () => {
  it("makes transcript sharing an explicit admin-managed opt-in", () => {
    expect(source).toContain('t("shareMeeting.sharedContent")');
    expect(source).toContain('t("shareMeeting.summaryIncluded")');
    expect(source).toContain('t("shareMeeting.includeTranscript")');
    expect(source).toContain("checked={includeTranscript}");
    expect(source).toContain("!canManage || !transcriptReady");
    expect(source).toContain("{ id: meetingId, shareTranscript: next }");
  });

  it("explains when the transcript is unavailable", () => {
    expect(source).toContain('t("shareMeeting.includeTranscriptDescription")');
    expect(source).toContain('t("shareMeeting.transcriptUnavailable")');
  });
});
