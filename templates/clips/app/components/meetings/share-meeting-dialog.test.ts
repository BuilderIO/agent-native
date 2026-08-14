import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "app/components/meetings/share-meeting-dialog.tsx"),
  "utf8",
);

describe("meeting share popover", () => {
  it("no longer exposes the transcript toggle or mutation in the meeting share UI", () => {
    expect(source).not.toContain('t("shareMeeting.includeTranscript")');
    expect(source).not.toContain("checked={includeTranscript}");
    expect(source).not.toContain("update-meeting");
    expect(source).not.toContain("Switch");
    expect(source).not.toContain("transcriptReady");
    expect(source).not.toContain("shareTranscript: next");
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

  it("keeps individual access in the primary share surface", () => {
    expect(source).toContain("<SharePeopleTab");
    expect(source).not.toContain('value="invite"');
  });
});
