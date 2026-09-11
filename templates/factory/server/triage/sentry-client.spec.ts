import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveConnectorSecret } from "../connectors/credentials.js";
import { createSentryClient } from "./sentry-client.js";

vi.mock("../connectors/credentials.js", () => ({
  resolveConnectorSecret: vi.fn(),
}));

const mockedResolveConnectorSecret = vi.mocked(resolveConnectorSecret);

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mockedResolveConnectorSecret.mockImplementation(async (key) => {
    if (key === "SENTRY_SERVER_TOKEN") return "sentry-test-token";
    if (key === "SENTRY_ORG_SLUG") return "builder";
    return undefined;
  });
});

describe("Sentry triage client", () => {
  it("lists typed issues and events with bounded requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/events/")) {
        return response([
          {
            eventID: "event-1",
            title: "Error",
            message: "failed",
            dateCreated: "2026-08-04T00:00:00Z",
            tags: [{ key: "env", value: "production" }],
            context: { route: "/triage" },
          },
        ]);
      }
      return response([
        {
          id: "issue-1",
          shortId: "FACTORY-1",
          title: "Error",
          culprit: "triage",
          permalink: "https://sentry.test/1",
          level: "error",
          status: "unresolved",
          project: { slug: "factory" },
          count: "2",
          firstSeen: "2026-08-03T00:00:00Z",
          lastSeen: "2026-08-04T00:00:00Z",
        },
      ]);
    });
    const client = createSentryClient({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      fetchImpl,
    });

    await expect(client.listIssues("is:unresolved")).resolves.toMatchObject([
      { id: "issue-1", projectSlug: "factory" },
    ]);
    await expect(client.listEvents("issue-1")).resolves.toMatchObject([
      { eventId: "event-1" },
    ]);
    expect(
      new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams.get("limit"),
    ).toBe("100");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer sentry-test-token" },
    });
    expect(mockedResolveConnectorSecret).toHaveBeenCalledWith(
      "SENTRY_SERVER_TOKEN",
      "owner@example.com",
      { orgId: "org-1" },
    );
  });

  it("fails loudly on missing credentials, malformed responses, and oversized limits", async () => {
    mockedResolveConnectorSecret.mockResolvedValue(undefined);
    const client = createSentryClient({
      ownerEmail: "owner@example.com",
      orgSlug: "builder",
      fetchImpl: vi.fn<typeof fetch>(),
    });
    await expect(client.listIssues()).rejects.toThrow(
      "SENTRY_SERVER_TOKEN or SENTRY_AUTH_TOKEN",
    );

    mockedResolveConnectorSecret.mockImplementation(async (key) =>
      key === "SENTRY_SERVER_TOKEN" ? "sentry-test-token" : "builder",
    );
    await expect(client.listIssues(undefined, 101)).rejects.toThrow(
      "limit must be an integer from 1 to 100",
    );
    const malformed = createSentryClient({
      ownerEmail: "owner@example.com",
      fetchImpl: vi.fn<typeof fetch>(async () => response({ issues: [] })),
    });
    await expect(malformed.listIssues()).rejects.toThrow(
      "issue response was not an array",
    );
  });
});
