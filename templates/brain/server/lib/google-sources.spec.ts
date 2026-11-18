import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn<(request: ProviderApiRequestArgs) => Promise<unknown>>(),
  connection: vi.fn(),
  email: "qa-fleet@builder.io",
}));
vi.mock("./provider-api.js", () => ({
  executeProviderApiRequest: mocks.request,
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionForApp: mocks.connection,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.email,
}));

import { parseGoogleSourceConfig } from "../../shared/google-source-config.js";
import type { schema } from "../db/index.js";
import { requirePersonalGoogleConnection } from "./google-source-connection.js";
import {
  GoogleSourceTransientError,
  readGoogleSourcePage,
} from "./google-sources.js";
import type { ProviderApiRequestArgs } from "./provider-api.js";

type Source = typeof schema.brainSources.$inferSelect;
function source(
  provider: Source["provider"],
  google = {},
  cursor = {},
): Source {
  return {
    id: "source-qa",
    provider,
    title: "QA Google source",
    ownerEmail: "qa-fleet@builder.io",
    visibility: "private",
    orgId: null,
    configJson: JSON.stringify({ workspaceConnectionId: "qa-google", google }),
    cursorJson: JSON.stringify(cursor),
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    status: "active",
    sourceKey: null,
    ingestTokenHash: null,
    lastSyncedAt: null,
    lastError: null,
  };
}
function requestAt(index: number) {
  const call = mocks.request.mock.calls.find(
    (_, position) => position === index,
  );
  if (!call) throw new Error(`Expected provider request ${index}`);
  return call[0];
}

function respond(json: unknown, status = 200) {
  return { response: { json, status, ok: status < 400, truncated: false } };
}

describe("personal Google source indexing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.email = "qa-fleet@builder.io";
    mocks.connection.mockResolvedValue({
      available: true,
      connection: {
        id: "qa-google",
        accountId: "qa-fleet@builder.io",
        ownerEmail: "qa-fleet@builder.io",
      },
    });
  });

  it("imports calendar attendees and resumes a bounded page with an owner-only audience", async () => {
    mocks.request.mockResolvedValueOnce(
      respond({
        items: [
          {
            id: "planning",
            summary: "Release planning",
            start: { dateTime: "2026-11-18T18:00:00Z" },
            attendees: [{ displayName: "QA colleague" }],
          },
          { id: "cancelled", status: "cancelled" },
        ],
        nextPageToken: "page-two",
      }),
    );
    const first = await readGoogleSourcePage(source("google_calendar"));
    expect(first.captures).toMatchObject([
      {
        externalId: "google_calendar:primary:planning",
        content: expect.stringContaining("QA colleague"),
        audience: { kind: "restricted", memberEmails: ["qa-fleet@builder.io"] },
      },
    ]);
    expect(first.inaccessibleExternalIds).toEqual([
      "google_calendar:primary:cancelled",
    ]);
    expect(first.hasMore).toBe(true);
    expect(first.startsCycle).toBe(true);
    mocks.request.mockResolvedValueOnce(respond({ items: [] }));
    const next = await readGoogleSourcePage(
      source("google_calendar", {}, first.cursor),
    );
    expect(requestAt(1)).toMatchObject({
      provider: "google_calendar",
      connectionId: "qa-google",
      accountId: "qa-fleet@builder.io",
      query: {
        pageToken: "page-two",
        timeMin: first.cursor.windowStart,
        timeMax: first.cursor.windowEnd,
        maxResults: 10,
      },
    });
    expect(next.hasMore).toBe(false);
    expect(next.startsCycle).toBe(false);
    expect(next.cursor).not.toHaveProperty("pageToken");
  });

  it("reads Gmail MIME text and excludes attachment bodies", async () => {
    mocks.request.mockResolvedValueOnce(
      respond({ messages: [{ id: "message-1" }] }),
    );
    mocks.request.mockResolvedValueOnce(
      respond({
        id: "message-1",
        internalDate: "1795000000000",
        payload: {
          headers: [{ name: "Subject", value: "Plan update" }],
          mimeType: "multipart/mixed",
          parts: [
            {
              mimeType: "text/plain",
              body: {
                data: Buffer.from("Ship the next release Friday").toString(
                  "base64url",
                ),
              },
            },
            {
              mimeType: "text/plain",
              filename: "private.txt",
              body: {
                data: Buffer.from("Attachment text").toString("base64url"),
              },
            },
          ],
        },
      }),
    );
    const result = await readGoogleSourcePage(
      source("gmail", { query: "label:work" }),
    );
    expect(result.captures[0]).toMatchObject({
      kind: "message",
      title: "Plan update",
      content: "Plan update\n\nShip the next release Friday",
      metadata: { snippetOnly: false },
      audience: { kind: "restricted", memberEmails: ["qa-fleet@builder.io"] },
    });
    expect(requestAt(0)).toMatchObject({
      query: { q: "label:work", maxResults: 10 },
    });
    expect(requestAt(1)).toMatchObject({
      path: "/users/me/messages/message-1",
      query: { format: "full" },
    });
  });

  it("marks HTML-only Gmail imports as snippet-only", async () => {
    mocks.request.mockResolvedValueOnce(
      respond({ messages: [{ id: "html" }] }),
    );
    mocks.request.mockResolvedValueOnce(
      respond({
        id: "html",
        snippet: "Partial preview",
        payload: {
          mimeType: "text/html",
          body: { data: Buffer.from("<p>Full HTML</p>").toString("base64url") },
        },
      }),
    );
    const result = await readGoogleSourcePage(source("gmail"));
    expect(result.captures[0]).toMatchObject({
      content:
        "Email\n\n[Partial email preview; full message body unavailable.]\n\nPartial preview",
      metadata: { snippetOnly: true },
    });
  });

  it("exports only approved Drive text files and retires missing records", async () => {
    mocks.request.mockResolvedValueOnce(
      respond({
        id: "doc-1",
        name: "Launch plan",
        mimeType: "application/vnd.google-apps.document",
      }),
    );
    mocks.request.mockResolvedValueOnce({
      response: {
        text: "Prepare launch checklist",
        status: 200,
        ok: true,
        truncated: false,
      },
    });
    mocks.request.mockResolvedValueOnce(
      respond({ error: { message: "not found" } }, 404),
    );
    const result = await readGoogleSourcePage(
      source("google_drive", { fileIds: ["doc-1", "gone-1"] }),
    );
    expect(result.captures[0]).toMatchObject({
      kind: "document",
      content: "Prepare launch checklist",
      audience: { kind: "restricted", memberEmails: ["qa-fleet@builder.io"] },
    });
    expect(requestAt(1)).toMatchObject({
      path: "/files/doc-1/export",
      query: { mimeType: "text/plain" },
    });
    expect(result.inaccessibleExternalIds).toEqual(["google_drive:gone-1"]);
    expect(result.captures[0]?.audience?.upstreamRefHash).toContain(
      "google_drive:doc-1",
    );
  });

  it("skips an oversized Gmail item while retaining healthy sibling captures and page progress", async () => {
    mocks.request.mockResolvedValueOnce(
      respond({
        messages: [{ id: "oversized" }, { id: "healthy" }],
        nextPageToken: "next-page",
      }),
    );
    mocks.request.mockResolvedValueOnce({
      response: { status: 200, ok: true, truncated: true },
    });
    mocks.request.mockResolvedValueOnce(
      respond({ id: "healthy", snippet: "Healthy preview" }),
    );
    const result = await readGoogleSourcePage(source("gmail"));
    expect(result.skippedItems).toEqual([
      { externalId: "gmail:oversized", reason: "response_truncated" },
    ]);
    expect(result.captures).toHaveLength(1);
    expect(result.captures[0]?.externalId).toBe("gmail:healthy");
    expect(result.hasMore).toBe(true);
    expect(result.cursor.pageToken).toBe("next-page");
  });

  it("skips oversized Drive text while retaining healthy sibling files", async () => {
    mocks.request.mockResolvedValueOnce(
      respond({
        id: "oversized",
        name: "Large document",
        mimeType: "text/plain",
      }),
    );
    mocks.request.mockResolvedValueOnce({
      response: {
        status: 200,
        ok: true,
        truncated: true,
        text: "incomplete body",
      },
    });
    mocks.request.mockResolvedValueOnce(
      respond({
        id: "healthy",
        name: "Healthy document",
        mimeType: "text/plain",
      }),
    );
    mocks.request.mockResolvedValueOnce({
      response: {
        status: 200,
        ok: true,
        truncated: false,
        text: "Complete body",
      },
    });
    const result = await readGoogleSourcePage(
      source("google_drive", { fileIds: ["oversized", "healthy"] }),
    );
    expect(result.skippedItems).toEqual([
      { externalId: "google_drive:oversized", reason: "response_truncated" },
    ]);
    expect(result.captures).toHaveLength(1);
    expect(result.captures[0]).toMatchObject({
      externalId: "google_drive:healthy",
      content: "Complete body",
    });
  });

  it("refuses binary Drive content before downloading it", async () => {
    mocks.request.mockResolvedValueOnce(
      respond({ id: "photo", name: "Photo", mimeType: "image/png" }),
    );
    await expect(
      readGoogleSourcePage(source("google_drive", { fileIds: ["photo"] })),
    ).rejects.toThrow("support Google Docs");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("fails loudly on an incomplete provider response", async () => {
    mocks.request.mockResolvedValueOnce({
      response: { status: 200, ok: true, truncated: true, json: { items: [] } },
    });
    await expect(
      readGoogleSourcePage(source("google_calendar")),
    ).rejects.toThrow("truncated");
  });

  it("does not downgrade a truncated permission error to an oversized item skip", async () => {
    mocks.request.mockResolvedValueOnce(
      respond({ messages: [{ id: "denied" }] }),
    );
    mocks.request.mockResolvedValueOnce({
      response: { status: 403, ok: false, truncated: true },
    });
    await expect(readGoogleSourcePage(source("gmail"))).rejects.toThrow("403");
  });

  it("rejects syncing as another editor before making a provider request", async () => {
    mocks.email = "different-editor@example.test";
    await expect(readGoogleSourcePage(source("gmail"))).rejects.toMatchObject({
      errorCode: "google_source_owner_required",
    });
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("rejects somebody else's granted connection", async () => {
    mocks.connection.mockResolvedValue({
      available: true,
      connection: {
        id: "qa-google",
        accountId: "other",
        ownerEmail: "other@example.test",
      },
    });
    await expect(readGoogleSourcePage(source("gmail"))).rejects.toMatchObject({
      errorCode: "google_source_connection_unavailable",
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("restarts verification after a query or account binding changes", async () => {
    mocks.request.mockResolvedValueOnce(
      respond({ messages: [], nextPageToken: "old-page" }),
    );
    const first = await readGoogleSourcePage(
      source("gmail", { query: "label:old" }),
    );
    mocks.request.mockResolvedValueOnce(respond({ messages: [] }));
    const changed = await readGoogleSourcePage(
      source("gmail", { query: "label:new" }, first.cursor),
    );
    expect(changed.startsCycle).toBe(true);
    expect(requestAt(1).query).not.toHaveProperty("pageToken");
    mocks.connection.mockResolvedValue({
      available: true,
      connection: {
        id: "qa-google",
        accountId: "qa-secondary@example.test",
        ownerEmail: "qa-fleet@builder.io",
      },
    });
    mocks.request.mockResolvedValueOnce(respond({ messages: [] }));
    const accountChanged = await readGoogleSourcePage(
      source("gmail", { query: "label:old" }, first.cursor),
    );
    expect(accountChanged.startsCycle).toBe(true);
    expect(requestAt(2)).toMatchObject({
      accountId: "qa-secondary@example.test",
    });
    expect(requestAt(2).query).not.toHaveProperty("pageToken");
  });

  it("reports a Drive permission denial without importing the inaccessible file", async () => {
    mocks.request.mockResolvedValueOnce(
      respond(
        { error: { errors: [{ reason: "insufficientFilePermissions" }] } },
        403,
      ),
    );
    const result = await readGoogleSourcePage(
      source("google_drive", { fileIds: ["revoked-doc"] }),
    );
    expect(result.captures).toEqual([]);
    expect(result.inaccessibleExternalIds).toEqual([
      "google_drive:revoked-doc",
    ]);
  });

  it.each([
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "dailyLimitExceeded",
    "quotaExceeded",
  ])(
    "fails visibly and retryably for Drive quota reason %s",
    async (reason) => {
      mocks.request.mockResolvedValueOnce(
        respond({ error: { errors: [{ reason }] } }, 403),
      );
      await expect(
        readGoogleSourcePage(
          source("google_drive", { fileIds: ["approved-doc"] }),
        ),
      ).rejects.toBeInstanceOf(GoogleSourceTransientError);
    },
  );

  it("treats HTTP 429 as a retryable failed request", async () => {
    mocks.request.mockResolvedValueOnce(respond({}, 429));
    await expect(
      readGoogleSourcePage(
        source("google_drive", { fileIds: ["approved-doc"] }),
      ),
    ).rejects.toBeInstanceOf(GoogleSourceTransientError);
  });

  it("does not convert an unknown Drive 403 into a successful inaccessible file", async () => {
    mocks.request.mockResolvedValueOnce(
      respond({ error: { errors: [{ reason: "unknown" }] } }, 403),
    );
    await expect(
      readGoogleSourcePage(
        source("google_drive", { fileIds: ["approved-doc"] }),
      ),
    ).rejects.toThrow("403");
  });

  it("requires an explicit connection and valid approved file IDs", async () => {
    await expect(
      requirePersonalGoogleConnection("gmail", {}),
    ).rejects.toMatchObject({ errorCode: "google_source_connection_required" });
    expect(() => parseGoogleSourceConfig("google_drive", {})).toThrow(
      "approved file IDs",
    );
    expect(() =>
      parseGoogleSourceConfig("google_drive", {
        google: { fileIds: ["../not-a-file"] },
      }),
    ).toThrow();
  });
});
