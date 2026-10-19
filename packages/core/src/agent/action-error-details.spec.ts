import { describe, expect, it } from "vitest";

import { fail } from "../action.js";
import {
  agentErrorDetails,
  MAX_AGENT_ERROR_DETAILS_CHARS,
} from "./action-error-details.js";

function thrown(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("agentErrorDetails", () => {
  it("returns the details a fail() attached as the browser receives them", () => {
    const error = thrown(() =>
      fail("Import is running", {
        details: {
          importId: "imp_1",
          startedAt: new Date("2026-10-16T12:00:00.000Z"),
          skipped: undefined,
        },
      }),
    );

    expect(agentErrorDetails(error)).toEqual({
      details: { importId: "imp_1", startedAt: "2026-10-16T12:00:00.000Z" },
      line: 'Error details: {"importId":"imp_1","startedAt":"2026-10-16T12:00:00.000Z"}',
    });
  });

  it("has nothing for errors that are not contract errors or carry no details", () => {
    expect(agentErrorDetails(new Error("boom"))).toBeUndefined();
    expect(agentErrorDetails(thrown(() => fail("No details")))).toBeUndefined();
    expect(
      agentErrorDetails(thrown(() => fail("Empty", { details: {} }))),
    ).toBeUndefined();
  });

  it("redacts credential keys and credential-looking text", () => {
    const error = thrown(() =>
      fail("Upstream refused", {
        details: {
          provider: { name: "gong", accessToken: "SENSITIVE_VALUE" },
          hint: "retry with Bearer SENSITIVE_VALUE",
        },
      }),
    );

    const result = agentErrorDetails(error);
    expect(result?.details).toEqual({
      provider: { name: "gong", accessToken: "[REDACTED]" },
      hint: "retry with Bearer [REDACTED]",
    });
    expect(result?.line).not.toContain("SENSITIVE_VALUE");
  });

  it("redacts compound credential names and embed tickets but keeps a retry cursor", () => {
    const error = thrown(() =>
      fail("Upstream refused", {
        details: {
          clientSecret: "SENSITIVE_VALUE",
          "x-api-key": "SENSITIVE_VALUE",
          oauth: {
            auth_token: "SENSITIVE_VALUE",
            privateKey: "SENSITIVE_VALUE",
          },
          githubToken: "SENSITIVE_VALUE",
          oauth_token: "SENSITIVE_VALUE",
          embed: {
            embedTicket: "SENSITIVE_VALUE",
            embedExpiresAt: "2026-10-19T00:00:00Z",
          },
          nextPageToken: "page_2",
          sync_token: "sync_2",
          deltaToken: "delta_2",
          skipToken: "skip_2",
          maxTokens: 4000,
        },
      }),
    );

    expect(agentErrorDetails(error)?.details).toEqual({
      clientSecret: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      oauth: { auth_token: "[REDACTED]", privateKey: "[REDACTED]" },
      githubToken: "[REDACTED]",
      oauth_token: "[REDACTED]",
      embed: { embedTicket: "[REDACTED]", embedExpiresAt: "[REDACTED]" },
      nextPageToken: "page_2",
      sync_token: "sync_2",
      deltaToken: "delta_2",
      skipToken: "skip_2",
      maxTokens: 4000,
    });
  });

  it("keeps small entries and names the rest when the whole object is too long", () => {
    const error = thrown(() =>
      fail("Too many rows", {
        details: {
          importId: "imp_1",
          rows: Array.from({ length: 500 }, (_, i) => ({ i })),
          limit: 100,
        },
      }),
    );

    const result = agentErrorDetails(error);
    expect(result).toEqual({
      details: { importId: "imp_1", limit: 100 },
      omittedKeys: ["rows"],
      omittedKeyCount: 1,
      line: 'Error details (omitted: rows): {"importId":"imp_1","limit":100}',
    });
  });

  it("stays within the bound when many small entries add up", () => {
    const details = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`key${i}`, "x".repeat(100)]),
    );
    const result = agentErrorDetails(thrown(() => fail("Wide", { details })));

    expect(JSON.stringify(result?.details).length).toBeLessThanOrEqual(
      MAX_AGENT_ERROR_DETAILS_CHARS,
    );
    expect(result?.omittedKeyCount).toBe(
      40 - Object.keys(result?.details ?? {}).length,
    );
    expect(result?.omittedKeys).toHaveLength(10);
    expect(result?.line).toMatch(
      /^Error details \(omitted: key\d+, .*, and \d+ more\): \{/,
    );
  });

  it("names an entry that cannot be serialized instead of dropping it silently", () => {
    const error = thrown(() =>
      fail("Odd value", { details: { importId: "imp_1", size: 10n } }),
    );

    expect(agentErrorDetails(error)).toEqual({
      details: { importId: "imp_1" },
      omittedKeys: ["size"],
      omittedKeyCount: 1,
      line: 'Error details (omitted: size): {"importId":"imp_1"}',
    });
  });

  it("names an entry whose getter throws instead of losing the action's error", () => {
    const details: Record<string, unknown> = { importId: "imp_1" };
    Object.defineProperty(details, "size", {
      enumerable: true,
      get() {
        throw new Error("unreadable");
      },
    });
    const error = thrown(() => fail("Odd value", { details }));

    expect(agentErrorDetails(error)).toEqual({
      details: { importId: "imp_1" },
      omittedKeys: ["size"],
      omittedKeyCount: 1,
      line: 'Error details (omitted: size): {"importId":"imp_1"}',
    });
  });
});
