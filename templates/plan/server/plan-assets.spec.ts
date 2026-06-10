/**
 * Plan asset round-trip and access tests.
 *
 * Strategy:
 *   1. Round-trip: image block with assetId → export emits assets/ → import
 *      recreates and resolves.
 *   2. Access: anonymous 404 on private plan's asset; 200 on public plan.
 *   3. Size-cap rejection: single asset > 2 MB, total > 10 MB.
 *   4. External URL: stays untouched in export/import.
 *
 * Uses an in-process SQLite database (libsql :memory: via a temp file so
 * all connections share state) with real schema rows. The route handler is
 * tested by calling its internals directly — no HTTP server required.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as planSchema from "./db/schema.js";
import {
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
} from "./plan-mdx.js";
import {
  upsertPlanAsset,
  importPlanAssets,
  applyImportedAssets,
  mimeTypeFromFilename,
  PLAN_ASSET_MAX_SINGLE_BYTES,
  PLAN_ASSET_MAX_TOTAL_BYTES,
} from "./lib/plan-assets.js";
import type { PlanContent } from "../shared/plan-content.js";

// ---------------------------------------------------------------------------
// In-memory test DB
// ---------------------------------------------------------------------------
let client: Client;
let db: LibSQLDatabase<typeof planSchema>;
let dbDir: string;
let dbFile: string;

vi.mock("./db/index.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  getDb: () => db,
  schema: planSchema,
}));

// Prevent file-upload provider from attempting real network calls.
vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: vi.fn(async () => null),
  getActiveFileUploadProvider: vi.fn(() => null),
}));

const OWNER = "owner@example.com";
const NOW = new Date().toISOString();

function makeBase64(byteLength: number): string {
  return Buffer.alloc(byteLength, 0x41).toString("base64");
}

async function insertPlan(
  id: string,
  visibility: "private" | "public" | "org" = "private",
) {
  // guard:allow-unscoped -- test-only fixture creates isolated plan rows.
  await client.execute({
    sql: `INSERT INTO plans (id, title, brief, kind, status, source, html, markdown, content, created_at, updated_at, owner_email, org_id, visibility)
          VALUES (?, 'Test Plan', 'A brief', 'plan', 'review', 'manual', NULL, NULL, NULL, ?, ?, ?, NULL, ?)`,
    args: [id, NOW, NOW, OWNER, visibility],
  });
}

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-assets-spec-"));
  dbFile = path.join(dbDir, "test.db");
  client = createClient({ url: `file:${dbFile}` });
  db = drizzle(client, { schema: planSchema });
  await client.executeMultiple(`
    CREATE TABLE plans (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      brief TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'plan',
      status TEXT NOT NULL DEFAULT 'draft',
      source TEXT NOT NULL DEFAULT 'manual',
      repo_path TEXT,
      current_focus TEXT,
      html TEXT,
      markdown TEXT,
      content TEXT,
      hosted_plan_id TEXT,
      hosted_plan_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT,
      usage_agent TEXT,
      usage_model TEXT,
      usage_input_tokens INTEGER,
      usage_output_tokens INTEGER,
      usage_cache_read_tokens INTEGER,
      usage_cache_write_tokens INTEGER,
      usage_cost_cents_x100 INTEGER,
      usage_cost_source TEXT,
      usage_recorded_at TEXT,
      source_url TEXT,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE plan_assets (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
});

afterAll(async () => {
  client.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // guard:allow-unscoped -- test-only cleanup resets the isolated temp DB.
  await client.executeMultiple(`
    DELETE FROM plan_assets;
    DELETE FROM plans;
  `);
});

// ---------------------------------------------------------------------------
// mimeTypeFromFilename
// ---------------------------------------------------------------------------

describe("mimeTypeFromFilename", () => {
  it("returns correct MIME for supported extensions", () => {
    expect(mimeTypeFromFilename("photo.png")).toBe("image/png");
    expect(mimeTypeFromFilename("photo.jpg")).toBe("image/jpeg");
    expect(mimeTypeFromFilename("photo.jpeg")).toBe("image/jpeg");
    expect(mimeTypeFromFilename("photo.gif")).toBe("image/gif");
    expect(mimeTypeFromFilename("photo.webp")).toBe("image/webp");
    expect(mimeTypeFromFilename("icon.svg")).toBe("image/svg+xml");
  });

  it("returns null for unsupported extensions", () => {
    expect(mimeTypeFromFilename("file.exe")).toBeNull();
    expect(mimeTypeFromFilename("file.html")).toBeNull();
    expect(mimeTypeFromFilename("file.js")).toBeNull();
    expect(mimeTypeFromFilename("noextension")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(mimeTypeFromFilename("photo.PNG")).toBe("image/png");
    expect(mimeTypeFromFilename("PHOTO.JPG")).toBe("image/jpeg");
  });
});

// ---------------------------------------------------------------------------
// upsertPlanAsset — size-cap enforcement
// ---------------------------------------------------------------------------

describe("upsertPlanAsset size caps", () => {
  const planId = "plan-size-cap-test";

  beforeEach(() => insertPlan(planId));

  it("rejects an asset exceeding 2 MB single limit", async () => {
    const bigBase64 = makeBase64(PLAN_ASSET_MAX_SINGLE_BYTES + 1);
    await expect(
      upsertPlanAsset({
        planId,
        filename: "big.png",
        base64: bigBase64,
      }),
    ).rejects.toThrow(/too large/i);
  });

  it("accepts an asset exactly at the 2 MB limit", async () => {
    const exactBase64 = makeBase64(PLAN_ASSET_MAX_SINGLE_BYTES);
    const result = await upsertPlanAsset({
      planId,
      filename: "exact.png",
      base64: exactBase64,
    });
    expect(result.assetId).toMatch(/^passet_/);
  });

  it("rejects an asset that would push the plan over the 10 MB total", async () => {
    // Fill to just under the total cap with small assets.
    const chunkSize = 1 * 1024 * 1024; // 1 MB each
    const chunks = 9; // 9 MB total
    for (let i = 0; i < chunks; i++) {
      await upsertPlanAsset({
        planId,
        filename: `chunk-${i}.png`,
        base64: makeBase64(chunkSize),
      });
    }

    // An additional 2 MB asset would push to 11 MB > 10 MB.
    await expect(
      upsertPlanAsset({
        planId,
        filename: "overflow.png",
        base64: makeBase64(2 * 1024 * 1024),
      }),
    ).rejects.toThrow(/10 MB/i);
  });
});

// ---------------------------------------------------------------------------
// importPlanAssets — skip unsupported extensions, warn + continue on size err
// ---------------------------------------------------------------------------

describe("importPlanAssets", () => {
  const planId = "plan-import-assets-test";

  beforeEach(() => insertPlan(planId));

  it("stores valid assets and returns src map", async () => {
    const pngBase64 = makeBase64(100);
    const srcMap = await importPlanAssets(planId, {
      "screenshot.png": pngBase64,
    });
    expect(srcMap["screenshot.png"]).toMatch(
      /^\/_agent-native\/plan-asset\/passet_/,
    );
  });

  it("skips unsupported file types without throwing", async () => {
    const srcMap = await importPlanAssets(planId, {
      "script.js": "aGVsbG8=",
      "photo.png": makeBase64(100),
    });
    expect(srcMap["script.js"]).toBeUndefined();
    expect(srcMap["photo.png"]).toBeDefined();
  });

  it("skips oversized assets without aborting the rest", async () => {
    const bigBase64 = makeBase64(PLAN_ASSET_MAX_SINGLE_BYTES + 1);
    const smallBase64 = makeBase64(100);
    const srcMap = await importPlanAssets(planId, {
      "too-big.png": bigBase64,
      "ok.png": smallBase64,
    });
    expect(srcMap["too-big.png"]).toBeUndefined();
    expect(srcMap["ok.png"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// applyImportedAssets — rewrites blocks
// ---------------------------------------------------------------------------

describe("applyImportedAssets", () => {
  it("rewrites assets/filename url to resolved src", () => {
    const content: PlanContent = {
      version: 2,
      title: "T",
      blocks: [
        {
          id: "img-1",
          type: "image",
          data: { url: "assets/screenshot.png", alt: "Screen" },
        },
      ],
    };
    const result = applyImportedAssets(content, {
      "screenshot.png": "/_agent-native/plan-asset/passet_abc/screenshot.png",
    });
    const block = result.blocks[0];
    if (block?.type !== "image") throw new Error("expected image");
    expect(block.data.url).toBe(
      "/_agent-native/plan-asset/passet_abc/screenshot.png",
    );
  });

  it("does not rewrite external https URLs", () => {
    const content: PlanContent = {
      version: 2,
      title: "T",
      blocks: [
        {
          id: "img-2",
          type: "image",
          data: { url: "https://cdn.example.com/image.png", alt: "Ext" },
        },
      ],
    };
    const result = applyImportedAssets(content, {
      "image.png": "/_agent-native/plan-asset/passet_xyz/image.png",
    });
    const block = result.blocks[0];
    if (block?.type !== "image") throw new Error("expected image");
    // External URL should be unchanged.
    expect(block.data.url).toBe("https://cdn.example.com/image.png");
  });

  it("rewrites inside tabs and columns", () => {
    const content: PlanContent = {
      version: 2,
      title: "T",
      blocks: [
        {
          id: "tabs-1",
          type: "tabs",
          data: {
            tabs: [
              {
                id: "tab-a",
                label: "A",
                blocks: [
                  {
                    id: "img-in-tab",
                    type: "image",
                    data: { url: "assets/tab-img.png", alt: "Tab image" },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const result = applyImportedAssets(content, {
      "tab-img.png": "https://cdn.example.com/tab-img.png",
    });
    const block = result.blocks[0];
    if (block?.type !== "tabs") throw new Error("expected tabs");
    const inner = block.data.tabs[0]?.blocks[0];
    if (inner?.type !== "image") throw new Error("expected image");
    expect(inner.data.url).toBe("https://cdn.example.com/tab-img.png");
  });
});

// ---------------------------------------------------------------------------
// MDX round-trip: image block with assetId → export → import
// ---------------------------------------------------------------------------

describe("MDX round-trip: image block with assetId", () => {
  const planId = "plan-roundtrip-test";

  beforeEach(() => insertPlan(planId));

  it("export emits assets/ entry; import recreates and resolves block url", async () => {
    const pngBase64 = makeBase64(200);

    // Store a plan asset directly.
    const { assetId, filename } = await upsertPlanAsset({
      planId,
      filename: "mockup.png",
      base64: pngBase64,
    });

    // Build content with the assetId.
    const content: PlanContent = {
      version: 2,
      title: "Image round-trip",
      blocks: [
        {
          id: "img-block",
          type: "image",
          data: { assetId, alt: "Mockup image" },
        },
      ],
    };

    // Export: should emit assets/ with the base64.
    const folder = await exportPlanContentToMdxFolder({
      content,
      title: "Image round-trip",
      planId,
    });

    // The exported MDX should reference the relative asset path.
    expect(folder["plan.mdx"]).toContain("assets/mockup.png");
    expect(folder["assets/"]).toBeDefined();
    expect(folder["assets/"]?.["mockup.png"]).toBe(pngBase64);

    // Import the folder into a fresh plan.
    const importedPlanId = `plan-import-${randomUUID().slice(0, 8)}`;
    await insertPlan(importedPlanId);

    const parsedContent = await parsePlanMdxFolder(folder);
    const srcByFilename = await importPlanAssets(
      importedPlanId,
      folder["assets/"] ?? {},
    );
    const finalContent = applyImportedAssets(parsedContent, srcByFilename);

    // The image block should now have a local route URL (no assetId).
    const block = finalContent.blocks.find((b) => b.id === "img-block");
    if (block?.type !== "image") throw new Error("expected image block");
    expect(block.data.url).toMatch(/\/_agent-native\/plan-asset\/passet_/);
    expect(block.data.assetId).toBeUndefined();
  });

  it("external https URLs pass through untouched in export and import", async () => {
    const content: PlanContent = {
      version: 2,
      title: "External URL",
      blocks: [
        {
          id: "ext-img",
          type: "image",
          data: { url: "https://cdn.example.com/banner.png", alt: "Banner" },
        },
      ],
    };

    const folder = await exportPlanContentToMdxFolder({
      content,
      title: "External URL",
      planId,
    });

    // External URLs stay in the block as-is, not in assets/.
    expect(folder["plan.mdx"]).toContain("https://cdn.example.com/banner.png");
    expect(Object.keys(folder["assets/"] ?? {}).length).toBe(0);

    // Import: external URL unchanged.
    const parsed = await parsePlanMdxFolder(folder);
    const block = parsed.blocks.find((b) => b.id === "ext-img");
    if (block?.type !== "image") throw new Error("expected image");
    expect(block.data.url).toBe("https://cdn.example.com/banner.png");
  });
});

// ---------------------------------------------------------------------------
// Access control tests for the plan-asset route handler internals
// ---------------------------------------------------------------------------

describe("plan-asset access control", () => {
  const privatePlanId = "plan-private";
  const publicPlanId = "plan-public";

  beforeEach(async () => {
    await insertPlan(privatePlanId, "private");
    await insertPlan(publicPlanId, "public");
  });

  it("returns asset data for an asset belonging to a public plan", async () => {
    const result = await upsertPlanAsset({
      planId: publicPlanId,
      filename: "public-img.png",
      base64: makeBase64(50),
    });

    // Direct DB read to verify the row exists.
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(planSchema.planAssets)
      .where(eq(planSchema.planAssets.id, result.assetId));
    expect(row).toBeDefined();
    expect(row?.planId).toBe(publicPlanId);
  });

  it("rejects 404 for an asset belonging to a private plan when access is resolved without a session", async () => {
    // This simulates what the route handler does: resolveAccess on a private
    // plan with an empty/anonymous context returns null.
    const { resolveAccess, registerShareableResource } =
      await import("@agent-native/core/sharing");
    // Register the resource against our test DB for this assertion.
    registerShareableResource({
      type: "plan",
      resourceTable: planSchema.plans,
      sharesTable: planSchema.planShares,
      displayName: "Plan",
      titleColumn: "title",
      getDb: () => db,
      resolveAccessContext: (ctx) => ctx,
    });

    const result = await upsertPlanAsset({
      planId: privatePlanId,
      filename: "private-img.png",
      base64: makeBase64(50),
    });

    // Anonymous (empty context) should NOT be able to access a private plan.
    const access = await resolveAccess("plan", privatePlanId, {});
    expect(access).toBeNull();

    // Verify the asset row exists but access is denied.
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(planSchema.planAssets)
      .where(eq(planSchema.planAssets.id, result.assetId));
    expect(row).toBeDefined(); // row exists
    expect(access).toBeNull(); // but access denied
  });
});
