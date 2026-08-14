import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "app/components/meetings/share-meeting-dialog.tsx"),
  "utf8",
);

describe("meeting share popover", () => {
  it("makes transcript sharing an explicit admin-managed opt-in", () => {
    expect(source).toContain('t("shareMeeting.includeTranscript")');
    expect(source).toContain("checked={includeTranscript}");
    expect(source).toContain("!canManage || !transcriptReady");
    expect(source).toContain("{ id: meetingId, shareTranscript: next }");
  });

  it("explains when the transcript is unavailable", () => {
    expect(source).toContain('t("shareMeeting.includeTranscriptDescription")');
    expect(source).toContain('t("shareMeeting.transcriptUnavailable")');
  });

  it("offers a separate temporary agent link for private meetings", () => {
    expect(source).toContain('useActionMutation("create-agent-resource-link")');
    expect(source).toContain('resourceType: "meeting"');
    expect(source).toContain("contextUrl");
    expect(source).toContain('t("shareDialog.shareWithAgents")');
    expect(source).toContain('t("shareMeeting.agentLinkDescription")');
    expect(source).toContain('t("shareDialog.retryAgentLink")');
    expect(source).toContain(
      "const visibleAgentLink = isPublic ? shareUrl : agentLink;",
    );
    expect(source).not.toContain("!isPublic ? (");
  });
});
