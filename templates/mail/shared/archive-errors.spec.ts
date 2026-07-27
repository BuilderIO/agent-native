import { describe, expect, it } from "vitest";

import {
  archiveFailureToastMessage,
  summarizeArchiveFailures,
} from "./archive-errors";

describe("summarizeArchiveFailures", () => {
  it("surfaces Gmail reconnect failures without raw OAuth details", () => {
    const summary = summarizeArchiveFailures({
      succeeded: 0,
      total: 1,
      failures: [
        "OAuth token refresh failed: invalid_grant: Token has been expired or revoked",
      ],
    });

    expect(summary).toEqual({
      message: "Archive failed because Gmail needs to be reconnected.",
      statusCode: 409,
    });
  });

  it("surfaces missing Gmail modify scope as a reconnect-permission issue", () => {
    const summary = summarizeArchiveFailures({
      succeeded: 0,
      total: 1,
      failures: [
        "Google API error (403): Request had insufficient authentication scopes.",
      ],
    });

    expect(summary.message).toContain(
      "does not have permission to modify Gmail",
    );
    expect(summary.statusCode).toBe(409);
  });

  it("keeps quota wait time without leaking agent-only wording", () => {
    const summary = summarizeArchiveFailures({
      succeeded: 0,
      total: 1,
      failures: [
        "Email service is briefly busy and will be ready again in about 90s. Ask the user for the missing info if you need it now.",
      ],
    });

    expect(summary).toEqual({
      message:
        "Archive failed because Gmail is briefly busy and will be ready again in about 90s.",
      statusCode: 429,
    });
  });

  it("summarizes partial bulk archive failures", () => {
    const summary = summarizeArchiveFailures({
      succeeded: 2,
      total: 3,
      failures: ["Google API error (404): Requested entity was not found."],
    });

    expect(summary.message).toBe(
      "Archived 2/3 conversations. Could not archive 1 because Gmail no longer has that conversation. Refresh Mail and try again.",
    );
    expect(summary.statusCode).toBe(409);
  });
});

describe("archiveFailureToastMessage", () => {
  it("uses the server-provided safe action message", () => {
    expect(
      archiveFailureToastMessage(
        new Error(
          "Action archive-email failed: Archive failed because Gmail needs to be reconnected.",
        ),
        "Archive failed. The conversation was restored.",
      ),
    ).toBe("Archive failed because Gmail needs to be reconnected.");
  });

  it("falls back when the route masks the server error", () => {
    expect(
      archiveFailureToastMessage(
        new Error("Action archive-email failed: Internal server error"),
        "Archive failed. The conversation was restored.",
      ),
    ).toBe("Archive failed. The conversation was restored.");
  });
});
