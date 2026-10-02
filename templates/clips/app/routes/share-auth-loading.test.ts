import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRoute(name: string): string {
  return readFileSync(resolve(process.cwd(), "app/routes", name), "utf8");
}

describe("authenticated recording route loading", () => {
  it("checks that a recording exists before verifying a scoped share token", () => {
    const route = readRoute("share.$shareId.tsx");
    const missingRecordGuard = route.indexOf(
      "if (!rec) return shareLoaderData(emptyLoaderData(url), hasAgentAccessToken);",
    );
    const tokenVerification = route.indexOf("const tokenGrantsAgentAccess =");

    expect(missingRecordGuard).toBeGreaterThanOrEqual(0);
    expect(tokenVerification).toBeGreaterThan(missingRecordGuard);
  });

  it("keeps expired share loader data impersonal for CDN caching", () => {
    const route = readRoute("share.$shareId.tsx");

    expect(route).toContain("isRecordingExpired(rec.expiresAt)");
    expect(route).not.toContain("isRecordingExpiredForViewer");
    expect(route).not.toContain("sameOwnerEmail");
  });

  it("waits for the browser session before the meeting share payload request", () => {
    const route = readRoute("share.meeting.$meetingId.tsx");
    expect(route).toContain('fetchPublicMeeting(meetingId ?? "", {');
    expect(route).toContain("enabled: !!meetingId && !sessionLoading");
    expect(route).toContain("initialData: initialMeetingResult");
    expect(route).toContain("privateShareLoaderData");
    expect(route).toContain(
      "export function headers({ loaderHeaders }: HeadersArgs)",
    );
    expect(route).toContain(
      "!meeting && (sessionLoading || meetingQuery.isLoading)",
    );
    expect(route).toContain('eq(schema.meetings.visibility, "public")');
    expect(route).not.toContain('fetch("/api/public-meeting');
  });

  it("keeps the meeting timestamp stable through hydration", () => {
    const route = readRoute("share.meeting.$meetingId.tsx");
    expect(route).toContain("useState(false);");
    expect(route).toContain('stable ? "en-US" : []');
    expect(route).toContain('...(stable ? { timeZone: "UTC" } : {})');
    expect(route).toContain(
      "formatDateTime(meeting.scheduledStart, !hasHydrated)",
    );
  });

  it("keeps meeting agent links scoped through both page and context loading", () => {
    const meetingRoute = readRoute("share.meeting.$meetingId.tsx");
    expect(meetingRoute).toContain("verifyScopedAgentAccessToken");
    expect(meetingRoute).toContain("CLIPS_MEETING_AGENT_RESOURCE_KIND");
    expect(meetingRoute).toContain("agentAccessToken");
    expect(meetingRoute).toContain('fetchPublicMeeting(meetingId ?? "", {');
    expect(meetingRoute).toContain("recordingId: schema.meetings.recordingId");
    expect(meetingRoute).toContain("recordingTranscripts");
    expect(meetingRoute).toContain("transcript: transcript");
  });

  it("keeps the shared clip agent scoped to the clip being viewed", () => {
    const shareRoute = readRoute("share.$shareId.tsx");
    const agentPanel = shareRoute.slice(shareRoute.lastIndexOf("<AgentPanel"));

    expect(agentPanel).toContain("scope={");
    expect(agentPanel).toContain('type: "recording"');
    expect(agentPanel).toContain("id: recording.id");
  });
});
