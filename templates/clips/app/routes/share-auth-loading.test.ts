import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRoute(name: string): string {
  return readFileSync(resolve(process.cwd(), "app/routes", name), "utf8");
}

describe("authenticated recording route loading", () => {
  it("waits for the browser session before the direct player action", () => {
    const route = readRoute("r.$recordingId.tsx");
    expect(route).toContain("enabled: !!recordingId && !sessionLoading");
    expect(route).toContain("if (sessionLoading)");
    expect(route).toContain(
      "if (playerDataQ.isLoading || playerDataForbidden)",
    );
  });

  it("waits for the browser session before the share payload request", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain("enabled: !!shareId && !sessionLoading");
    expect(route).toContain("if (sessionLoading || dataQ.isLoading)");
  });

  it("waits for the browser session before the meeting share payload request", () => {
    const route = readRoute("share.meeting.$meetingId.tsx");
    expect(route).toContain('fetchPublicMeeting(meetingId ?? "", { signal })');
    expect(route).toContain("enabled: !!meetingId && !sessionLoading");
    expect(route).toContain("initialData: initialMeetingResult");
    expect(route).toContain(
      "!meeting && (sessionLoading || meetingQuery.isLoading)",
    );
    expect(route).toContain('eq(schema.meetings.visibility, "public")');
    expect(route).not.toContain('fetch("/api/public-meeting');
  });

  it("only renders a non-seekable transcript when the meeting payload shares it", () => {
    const route = readRoute("share.meeting.$meetingId.tsx");
    expect(route).toContain("{transcript && (");
    expect(route).toContain("<TranscriptBubbles");
    expect(route).toContain("recordingId={null}");
    expect(route).toContain('t("shareMeeting.copyTranscript")');
  });

  it("keeps editor shares editable and shows their insights", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain('viewerRole === "editor"');
    expect(route).toContain("role={viewerRole ??");
    expect(route).toContain("<InsightsPanel");
    expect(route).toContain("{viewerCanEdit ? (");
  });
});
