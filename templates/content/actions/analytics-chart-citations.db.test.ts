// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect rows directly.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { registerLabs } from "@agent-native/core/labs/registry";
import { runWithRequestContext } from "@agent-native/core/server";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { documentRevisionToken } from "../server/lib/document-revision.js";
import {
  analyticsChartBlockRaw,
  type AnalyticsChartData,
} from "../shared/analytics-chart-block.js";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-analytics-chart-citations-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "citations-owner@example.test";
const VIEWER = "citations-viewer@example.test";
const STRANGER = "citations-stranger@example.test";
const ORG_ID = "citations-org";
const NO_CHARTS = "# Report\n\nNo charts now.";

type Schema = typeof import("../server/db/schema.js");
type Action = {
  run: (
    args: Record<string, unknown>,
    ctx?: Record<string, unknown>,
  ) => Promise<unknown>;
};
type CitedPages = {
  pages: Array<{ id: string; title: string; url: string; updatedAt: string }>;
  more: boolean;
};
let getDb: typeof import("../server/db/index.js").getDb;
let schema: Schema;
let syncPrivateBodyReferences: typeof import("../server/lib/private-icon-references.js").syncPrivateBodyReferences;
let syncAnalyticsChartCitations: typeof import("../server/lib/analytics-chart-citations.js").syncAnalyticsChartCitations;
let updateDocument: Action;
let editDocument: Action;
let listCitations: Action;
let count = 0;

beforeAll(async () => {
  registerLabs([CREATIVE_CONTEXT_LIBRARY_LAB]);
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  ({ syncPrivateBodyReferences } =
    await import("../server/lib/private-icon-references.js"));
  ({ syncAnalyticsChartCitations } =
    await import("../server/lib/analytics-chart-citations.js"));
  updateDocument = (await import("./update-document.js")).default as Action;
  editDocument = (await import("./edit-document.js")).default as Action;
  listCitations = (await import("./list-analytics-chart-citations.js"))
    .default as Action;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function chartTag(dashboardId: string): string {
  const data: AnalyticsChartData = {
    dashboard: {
      id: dashboardId,
      title: `Dashboard ${dashboardId}`,
      url: `https://analytics.example.test/dashboards/${dashboardId}`,
      visibility: "org",
    },
    panel: {
      id: "wau",
      title: "Weekly active users",
      type: "line",
      fingerprint: "0123456789ab",
      url: `https://analytics.example.test/dashboards/${dashboardId}?tile=wau`,
    },
    filters: {},
    columns: ["week", "Users"],
    rows: [["2026-10-05", 120]],
    chart: {},
    truncated: false,
    capturedAt: "2026-11-07T16:40:00.000Z",
  };
  return analyticsChartBlockRaw(
    `analytics-chart-${crypto.randomUUID().slice(0, 8)}`,
    data,
  );
}

function body(...dashboardIds: string[]): string {
  return ["# Report", ...dashboardIds.map(chartTag), "The end."].join("\n\n");
}

async function page(
  options: {
    content?: string;
    ownerEmail?: string;
    trashedAt?: string;
    updatedAt?: string;
  } = {},
) {
  const id = `citations-doc-${++count}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      ownerEmail: options.ownerEmail ?? OWNER,
      orgId: ORG_ID,
      parentId: null,
      title: `Page ${count}`,
      content: options.content ?? "",
      position: count,
      visibility: "private",
      trashedAt: options.trashedAt ?? null,
      createdAt: now,
      updatedAt: options.updatedAt ?? now,
    });
  return id;
}

async function share(
  documentId: string,
  email: string,
  role: "viewer" | "editor",
) {
  await getDb()
    .insert(schema.documentShares)
    .values({
      id: `share-${crypto.randomUUID()}`,
      resourceId: documentId,
      principalType: "user",
      principalId: email,
      role,
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
}

async function cite(documentId: string, dashboardId: string) {
  await getDb()
    .insert(schema.analyticsChartCitations)
    .values({ documentId, dashboardId });
}

async function citedDashboards(documentId: string): Promise<string[]> {
  const rows: Array<{ dashboardId: string }> = await getDb()
    .select({ dashboardId: schema.analyticsChartCitations.dashboardId })
    .from(schema.analyticsChartCitations)
    .where(eq(schema.analyticsChartCitations.documentId, documentId));
  return rows.map((row) => row.dashboardId).sort();
}

function as<T>(email: string | undefined, run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: email, orgId: ORG_ID }, run);
}

function save(documentId: string, before: string, after: string) {
  return syncPrivateBodyReferences(getDb(), {
    documentId,
    before,
    after,
    userEmail: OWNER,
    ownerEmail: OWNER,
    orgId: ORG_ID,
  });
}

function list(email: string | undefined, dashboardId: string) {
  return as(
    email,
    () => listCitations.run({ dashboardId }) as Promise<CitedPages>,
  );
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return {
      errorCode: (error as { errorCode?: string }).errorCode,
      statusCode: (error as { statusCode?: number }).statusCode,
    };
  }
  throw new Error("expected the action to fail");
}

describe("recording a page's chart citations as its body saves", () => {
  it("makes a page's citations match the dashboards its saved body holds charts from", async () => {
    const first = body("growth", "retention", "growth");
    const id = await page({ content: first });

    await save(id, "", first);
    expect(await citedDashboards(id)).toEqual(["growth", "retention"]);

    const second = body("retention", "revenue");
    await save(id, first, second);
    expect(await citedDashboards(id)).toEqual(["retention", "revenue"]);

    await save(id, second, NO_CHARTS);
    expect(await citedDashboards(id)).toEqual([]);
  });

  it("leaves other pages' citations alone", async () => {
    const before = body("growth");
    const saved = await page({ content: before });
    const other = await page({ content: before });
    await cite(other, "growth");

    await save(saved, before, "");

    expect(await citedDashboards(other)).toEqual(["growth"]);
  });

  it("records the charts update-document saves", async () => {
    const id = await page({ content: "# Report" });

    await as(OWNER, () => updateDocument.run({ id, content: body("growth") }));
    expect(await citedDashboards(id)).toEqual(["growth"]);

    await as(OWNER, () => updateDocument.run({ id, content: NO_CHARTS }));
    expect(await citedDashboards(id)).toEqual([]);
  });

  it("records the charts in a page edited without a revision", async () => {
    const id = await page({ content: body("retention") });
    expect(await citedDashboards(id)).toEqual([]);

    await as(OWNER, () =>
      editDocument.run({ id, find: "The end.", replace: "The very end." }),
    );

    expect(await citedDashboards(id)).toEqual(["retention"]);
  });

  it("records the charts in a page an agent edits against its revision", async () => {
    const content = body("revenue");
    const id = await page({ content });

    await as(OWNER, () =>
      editDocument.run(
        {
          id,
          baseRevision: documentRevisionToken(0, content),
          idempotencyKey: `cite-${id}`,
          find: "The end.",
          replace: "The very end.",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );

    expect(await citedDashboards(id)).toEqual(["revenue"]);
  });

  it("keeps a page's rows for the list to re-check when a save without its earlier body has no charts", async () => {
    const id = await page({ content: "# Report" });

    await syncAnalyticsChartCitations(getDb(), {
      documentId: id,
      after: body("growth"),
    });
    expect(await citedDashboards(id)).toEqual(["growth"]);

    await syncAnalyticsChartCitations(getDb(), {
      documentId: id,
      after: NO_CHARTS,
    });
    expect(await citedDashboards(id)).toEqual(["growth"]);
  });
});

describe("list-analytics-chart-citations", () => {
  it("lists only the pages the caller can open that still hold a chart from the dashboard", async () => {
    const at = (minutes: number) =>
      new Date(Date.UTC(2026, 10, 1, 12, minutes)).toISOString();
    const own = await page({ content: body("cited"), updatedAt: at(1) });
    const shared = await page({ content: body("cited"), updatedAt: at(2) });
    await share(shared, VIEWER, "viewer");
    const othersPrivate = await page({
      content: body("cited"),
      ownerEmail: STRANGER,
      updatedAt: at(3),
    });
    const trashed = await page({
      content: body("cited"),
      trashedAt: at(4),
      updatedAt: at(4),
    });
    await share(trashed, VIEWER, "viewer");
    const stale = await page({ content: body("elsewhere"), updatedAt: at(5) });
    await share(stale, VIEWER, "viewer");
    for (const id of [own, shared, othersPrivate, trashed, stale]) {
      await cite(id, "cited");
    }

    const forOwner = await list(OWNER, "cited");
    expect(forOwner.pages.map((cited) => cited.id)).toEqual([shared, own]);
    expect(forOwner.more).toBe(false);
    expect(forOwner.pages[0]).toEqual({
      id: shared,
      title: expect.stringMatching(/^Page /),
      url: expect.stringMatching(new RegExp(`/page/${shared}$`)),
      updatedAt: at(2),
    });

    const forViewer = await list(VIEWER, "cited");
    expect(forViewer.pages.map((cited) => cited.id)).toEqual([shared]);

    const forStranger = await list(STRANGER, "cited");
    expect(forStranger.pages.map((cited) => cited.id)).toEqual([othersPrivate]);
  });

  it("asks a signed-in person", async () => {
    await expect(failureOf(list(undefined, "cited"))).resolves.toEqual({
      errorCode: "analytics_chart_signed_out",
      statusCode: 401,
    });
  });

  it("lists at most 50 pages, most recently edited first, and says there are more", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 52; index += 1) {
      const id = await page({
        content: body("busy"),
        updatedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
      });
      await cite(id, "busy");
      ids.push(id);
    }

    const cited = await list(OWNER, "busy");
    expect(cited.pages).toHaveLength(50);
    expect(cited.pages.map((entry) => entry.id)).toEqual(
      ids.slice(2).reverse(),
    );
    expect(cited.more).toBe(true);
  });

  it("finds a page the caller can open behind 200 newer pages they can't", async () => {
    const at = (minutes: number) =>
      new Date(Date.UTC(2026, 8, 1, 0, minutes)).toISOString();
    const own = await page({ content: body("crowded"), updatedAt: at(0) });
    await cite(own, "crowded");
    for (let index = 1; index <= 201; index += 1) {
      const id = await page({
        content: body("crowded"),
        ownerEmail: STRANGER,
        updatedAt: at(index),
      });
      await cite(id, "crowded");
    }

    const cited = await list(OWNER, "crowded");
    expect(cited.pages.map((entry) => entry.id)).toEqual([own]);
    expect(cited.more).toBe(false);
  }, 60_000);

  it("shortens a very long title without splitting a character", async () => {
    const long = await page({ content: body("titled") });
    const emoji = await page({ content: body("titled") });
    for (const [id, title] of [
      [long, "x".repeat(2_001)],
      [emoji, `${"a".repeat(499)}😀 and more`],
    ] as const) {
      await getDb()
        .update(schema.documents)
        .set({ title })
        .where(eq(schema.documents.id, id));
      await cite(id, "titled");
    }

    const cited = await list(OWNER, "titled");
    const titles = new Map(cited.pages.map((entry) => [entry.id, entry.title]));
    expect(titles.get(long)).toHaveLength(500);
    expect(titles.get(emoji)).toBe("a".repeat(499));
  });

  it("finds a page once it's saved with a chart", async () => {
    const id = await page({ content: "# Report" });
    await expect(list(OWNER, "fresh")).resolves.toEqual({
      pages: [],
      more: false,
    });

    await as(OWNER, () => updateDocument.run({ id, content: body("fresh") }));

    const cited = await list(OWNER, "fresh");
    expect(cited.pages.map((entry) => entry.id)).toEqual([id]);
  });
});
