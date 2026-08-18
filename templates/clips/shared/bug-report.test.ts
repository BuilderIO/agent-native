import { describe, expect, it } from "vitest";

import {
  BUG_REPORT_AGENT_ACCESS_TTL_SECONDS,
  BUG_REPORT_POPUP_RESPONSE_HEADERS,
  BUG_REPORT_SUBMITTED_MESSAGE_TYPE,
  bugReportSubmissionTargetOrigins,
  createBugReportSubmissionMessage,
  isBugReportSubmissionMessage,
} from "./bug-report";

describe("bug-report submission messages", () => {
  it("keeps scoped support access available for async ticket triage", () => {
    expect(BUG_REPORT_AGENT_ACCESS_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it("builds an agent-ready completion with scoped URLs", () => {
    const message = createBugReportSubmissionMessage({
      recordingId: "rec-1",
      recordingUrl: "https://clips.example/r/rec-1",
      embedUrl: "https://clips.example/embed/rec-1",
      agentLink: {
        url: "https://clips.example/share/rec-1?agent_access=scoped-token",
        contextUrl:
          "https://clips.example/api/agent-context.json?id=rec-1&agent_access=scoped-token",
        expiresAt: "2026-07-29T22:00:00.000Z",
      },
    });

    expect(message).toEqual({
      type: BUG_REPORT_SUBMITTED_MESSAGE_TYPE,
      recordingId: "rec-1",
      recordingUrl: "https://clips.example/r/rec-1",
      embedUrl: "https://clips.example/embed/rec-1",
      agentShareUrl:
        "https://clips.example/share/rec-1?agent_access=scoped-token",
      agentContextUrl:
        "https://clips.example/api/agent-context.json?id=rec-1&agent_access=scoped-token",
      agentAccessExpiresAt: "2026-07-29T22:00:00.000Z",
      agentAccessStatus: "ready",
    });
    expect(isBugReportSubmissionMessage(message)).toBe(true);
  });

  it("keeps incomplete agent access explicitly unavailable", () => {
    const message = createBugReportSubmissionMessage({
      recordingId: "rec-1",
      recordingUrl: "https://clips.example/r/rec-1",
      embedUrl: "https://clips.example/embed/rec-1",
      agentLink: {
        url: "https://clips.example/share/rec-1?agent_access=scoped-token",
        contextUrl: "",
        expiresAt: "2026-07-29T22:00:00.000Z",
      },
    });

    expect(message).toMatchObject({
      agentShareUrl: null,
      agentContextUrl: null,
      agentAccessExpiresAt: null,
      agentAccessStatus: "unavailable",
    });
    expect(isBugReportSubmissionMessage(message)).toBe(true);
  });

  it("rejects inconsistent agent access states", () => {
    expect(
      isBugReportSubmissionMessage({
        type: BUG_REPORT_SUBMITTED_MESSAGE_TYPE,
        recordingId: "rec-1",
        recordingUrl: "https://clips.example/r/rec-1",
        embedUrl: "https://clips.example/embed/rec-1",
        agentShareUrl:
          "https://clips.example/share/rec-1?agent_access=scoped-token",
        agentContextUrl:
          "https://clips.example/api/agent-context.json?id=rec-1&agent_access=scoped-token",
        agentAccessExpiresAt: "2026-07-29T22:00:00.000Z",
        agentAccessStatus: "unavailable",
      }),
    ).toBe(false);
  });

  it("targets Clips and the exact return origin without a wildcard", () => {
    expect(
      bugReportSubmissionTargetOrigins(
        "https://clips.example",
        "https://builder.example/path?private=value",
      ),
    ).toEqual(["https://clips.example", "https://builder.example"]);
    expect(
      bugReportSubmissionTargetOrigins("https://clips.example", "not a URL"),
    ).toEqual(["https://clips.example"]);
    expect(
      bugReportSubmissionTargetOrigins(
        "https://clips.example",
        "data:text/plain,private",
      ),
    ).toEqual(["https://clips.example"]);
  });

  it("keeps opener messaging enabled on the capture response", () => {
    expect(BUG_REPORT_POPUP_RESPONSE_HEADERS).toEqual({
      "Cross-Origin-Opener-Policy": "unsafe-none",
    });
  });
});
