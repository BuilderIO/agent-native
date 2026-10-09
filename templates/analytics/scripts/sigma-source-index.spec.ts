import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSigmaSourceIndex,
  extractSigmaTableReferences,
  parseSigmaReviewManifest,
} from "./sigma-source-index";

const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "analytics-sigma-index-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("parseSigmaReviewManifest", () => {
  it("accepts a private allowlist of explicitly reviewed elements", () => {
    expect(
      parseSigmaReviewManifest({
        schemaVersion: 1,
        items: [{ workbookId: "workbook-1", elementIds: ["element-1"] }],
      }),
    ).toEqual({
      schemaVersion: 1,
      items: [{ workbookId: "workbook-1", elementIds: ["element-1"] }],
    });
  });

  it("rejects duplicate element and workbook references", () => {
    expect(() =>
      parseSigmaReviewManifest({
        schemaVersion: 1,
        items: [
          { workbookId: "workbook-1", elementIds: ["element-1"] },
          { workbookId: "workbook-1", elementIds: ["element-2"] },
        ],
      }),
    ).toThrow(/invalid workbook/);
    expect(() =>
      parseSigmaReviewManifest({
        schemaVersion: 1,
        items: [
          {
            workbookId: "workbook-1",
            elementIds: ["element-1", "element-1"],
          },
        ],
      }),
    ).toThrow(/invalid element/);
  });
});

describe("buildSigmaSourceIndex", () => {
  it("indexes only allowlisted Sigma metadata and never stores SQL or row literals", async () => {
    const root = await temporaryDirectory();
    const manifestPath = path.join(root, "review.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        items: [{ workbookId: "workbook-1", elementIds: ["element-1"] }],
      }),
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/auth/token") {
        return jsonResponse({ access_token: "fake-access-token" });
      }
      if (url.pathname === "/v2/workbooks") {
        return jsonResponse({
          entries: [
            {
              workbookId: "workbook-1",
              name: "Reviewed product metrics",
              updatedAt: "2026-10-08T00:00:00.000Z",
            },
          ],
          nextPage: null,
        });
      }
      if (url.pathname.endsWith("/elements")) {
        return jsonResponse({
          entries: [
            {
              elementId: "element-1",
              name: "Events by source",
              type: "table",
              columns: ["event_name", "event_at", "channel"],
            },
            {
              elementId: "element-not-reviewed",
              name: "Unreviewed element",
              type: "table",
              columns: ["secret_value"],
            },
          ],
          nextPage: null,
        });
      }
      if (url.pathname.endsWith("/queries")) {
        return jsonResponse({
          entries: [
            {
              elementId: "element-1",
              sql: "SELECT event_name FROM `warehouse.synthetic.events` WHERE email = 'person@example.test' -- FROM hidden.fake_table",
            },
          ],
          nextPage: null,
        });
      }
      return new Response("unexpected route", { status: 404 });
    }) as unknown as typeof fetch;

    const index = await buildSigmaSourceIndex({
      manifestPath,
      baseUrl: "https://aws-api.sigmacomputing.com",
      clientId: "fake-client-id",
      clientSecret: "fake-client-secret",
      fetcher,
    });

    expect(index.source).toMatchObject({
      id: "sigma",
      contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]).toMatchObject({
      metric: "Reviewed product metrics: Events by source",
      table: "warehouse.synthetic.events",
      columnsUsed: "event_name, event_at, channel",
      source: "sigma",
    });
    const serialized = JSON.stringify(index);
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("person@example.test");
    expect(serialized).not.toContain("hidden.fake_table");
    expect(serialized).not.toContain("fake-access-token");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not accept a non-Sigma or non-HTTPS API origin", async () => {
    const root = await temporaryDirectory();
    const manifestPath = path.join(root, "review.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        items: [{ workbookId: "workbook-1", elementIds: ["element-1"] }],
      }),
    );

    await expect(
      buildSigmaSourceIndex({
        manifestPath,
        baseUrl: "http://example.test",
        clientId: "fake-client-id",
        clientSecret: "fake-client-secret",
      }),
    ).rejects.toThrow(/HTTPS Sigma API origin/);
  });
});

describe("extractSigmaTableReferences", () => {
  it("keeps referenced tables and ignores literals and SQL comments", () => {
    expect(
      extractSigmaTableReferences(
        "SELECT * FROM `warehouse.analytics.events` JOIN source.users u ON true WHERE note = 'FROM fake.private'; /* JOIN ignored.table */",
      ),
    ).toEqual(["source.users", "warehouse.analytics.events"]);
  });
});
