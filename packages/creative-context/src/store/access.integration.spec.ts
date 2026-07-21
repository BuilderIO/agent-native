import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeContextItem } from "../connectors/normalize.js";

vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "creative-context-access-"));
  process.env.DATABASE_URL = `file:${path.join(tempDir, "app.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  vi.resetModules();
});

afterEach(async () => {
  const { closeDbExec } = await import("@agent-native/core/db");
  await closeDbExec();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function setup() {
  const [{ getDbExec, runMigrations }, { runWithRequestContext }] =
    await Promise.all([
      import("@agent-native/core/db"),
      import("@agent-native/core/server"),
    ]);
  const [{ creativeContextMigrations }, server, store] = await Promise.all([
    import("../schema/migrations.js"),
    import("../server/index.js"),
    import("./index.js"),
  ]);
  server.configureCreativeContext();
  await runMigrations(creativeContextMigrations, {
    table: "creative_context_test_migrations",
  })({});
  const exec = getDbExec();
  await exec.execute(`
    CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
      role TEXT NOT NULL, joined_at INTEGER NOT NULL
    )
  `);
  await exec.execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    args: [
      "member-alice",
      "org-1",
      "alice@example.test",
      "owner",
      0,
      "member-bob",
      "org-1",
      "bob@example.test",
      "member",
      0,
    ],
  });
  await exec.execute({
    sql: `INSERT INTO creative_context_sources
      (id, name, kind, config, upstream_access, status, health_status,
       item_count, restricted_item_count, owner_email, org_id, visibility,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "source-1",
      "Brand corpus",
      "website",
      "{}",
      "available",
      "active",
      "healthy",
      2,
      1,
      "alice@example.test",
      "org-1",
      "private",
      "2026-07-16T00:00:00.000Z",
      "2026-07-16T00:00:00.000Z",
    ],
  });
  for (const item of [
    { id: "allowed", access: "available", curation: "included" },
    { id: "restricted", access: "restricted", curation: "review" },
  ]) {
    await exec.execute({
      sql: `INSERT INTO creative_context_items
        (id, source_id, external_id, kind, title, current_version_id,
         current_content_hash, status, upstream_access, curation_status,
         curation_rank, inventory_state, index_state, tags, colors, provenance,
         metadata, created_at, updated_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        item.id,
        "source-1",
        item.id,
        "slide",
        `${item.id} title`,
        `${item.id}-v2`,
        `${item.id}-hash-v2`,
        "active",
        item.access,
        item.curation,
        "normal",
        "available",
        "pending",
        "[]",
        "[]",
        "{}",
        "{}",
        "2026-07-16T00:00:00.000Z",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    for (const version of [1, 2]) {
      await exec.execute({
        sql: `INSERT INTO creative_context_item_versions
          (id, item_id, version_number, content_hash, title, content,
           parse_status, metadata, created_at, owner_email, org_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `${item.id}-v${version}`,
          item.id,
          version,
          `${item.id}-hash-v${version}`,
          `${item.id} title`,
          `${item.id} canonical version ${version}`,
          "parsed",
          "{}",
          `2026-07-1${version}T00:00:00.000Z`,
          "alice@example.test",
          "org-1",
        ],
      });
      await exec.execute({
        sql: `INSERT INTO creative_context_chunks
          (id, item_id, item_version_id, ordinal, kind, text, metadata,
           created_at, owner_email, org_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `${item.id}-chunk-v${version}`,
          item.id,
          `${item.id}-v${version}`,
          0,
          "text",
          `${item.id} canonical version ${version}`,
          "{}",
          `2026-07-1${version}T00:00:00.000Z`,
          "alice@example.test",
          "org-1",
        ],
      });
    }
  }
  return { exec, runWithRequestContext, store };
}

describe("creative context access and revocation", () => {
  it("promotes the exact compiled Slides layout instead of a supplied snapshot", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const server = await import("../server/index.js");
    const promote = vi.fn(async () => {});
    server.configureCreativeContext({
      projections: {
        layoutTemplate: {
          promote,
          demote: vi.fn(async () => {}),
        },
      },
    });
    const html =
      '<div class="fmd-slide google-slides-native" data-slide-id="slide-1"><p>Exact layout</p></div>';
    const nativeArtifact = {
      schemaVersion: 1,
      app: "slides",
      format: "slides-html",
      rootExternalId: "presentation-1:slide-1",
      fidelityReport: {
        exact: { count: 1 },
        approximated: { count: 0, reasons: [] },
        imageFallback: { count: 0, reasons: [] },
      },
    };
    await exec.execute({
      sql: `UPDATE creative_context_items
        SET mime_type = ?, provenance = ? WHERE id = ?`,
      args: [
        "text/html",
        JSON.stringify({
          compiler: "@agent-native/creative-context:google-slides-native",
        }),
        "allowed",
      ],
    });
    await exec.execute({
      sql: `UPDATE creative_context_item_versions
        SET content = ?, mime_type = ?, metadata = ? WHERE id = ?`,
      args: [
        html,
        "text/html",
        JSON.stringify({ nativeArtifact }),
        "allowed-v2",
      ],
    });

    const suggestion = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        store.proposeCreativeContextSuggestion({
          kind: "layout-template",
          itemId: "allowed",
          itemVersionId: "allowed-v2",
          payload: { htmlSnapshot: "<p>Untrusted supplied snapshot</p>" },
        }),
    );
    await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        store.applyLayoutTemplateSuggestion({
          suggestionId: suggestion.id,
          operation: "promote",
        }),
    );

    expect(promote).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "allowed",
        itemVersionId: "allowed-v2",
        htmlSnapshot: html,
      }),
    );
    const projection = await exec.execute({
      sql: `SELECT i.mime_type, i.provenance, v.content, v.metadata
        FROM creative_context_items i
        JOIN creative_context_item_versions v ON v.id = i.current_version_id
        WHERE i.kind = 'layout_template'`,
      args: [],
    });
    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0]).toMatchObject({
      mime_type: "text/html",
      content: html,
    });
    expect(String(projection.rows[0]?.content)).not.toContain(
      "Untrusted supplied snapshot",
    );
    expect(JSON.parse(String(projection.rows[0]?.provenance))).toMatchObject({
      compiler: "@agent-native/creative-context:google-slides-native",
      promotedFromItemId: "allowed",
      promotedFromItemVersionId: "allowed-v2",
    });
    expect(JSON.parse(String(projection.rows[0]?.metadata))).toMatchObject({
      nativeArtifact: {
        app: "slides",
        format: "slides-html",
      },
    });
  });

  it("rejects an oversized compiled layout before creating its projection", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const server = await import("../server/index.js");
    const promote = vi.fn(async () => {});
    server.configureCreativeContext({
      projections: {
        layoutTemplate: { promote, demote: vi.fn(async () => {}) },
      },
    });
    const html = `<div class="fmd-slide google-slides-native" data-slide-id="slide-1"><p>${"界".repeat(44_000)}</p></div>`;
    await exec.execute({
      sql: `UPDATE creative_context_items
        SET mime_type = ?, provenance = ? WHERE id = ?`,
      args: [
        "text/html",
        JSON.stringify({
          compiler: "@agent-native/creative-context:google-slides-native",
        }),
        "allowed",
      ],
    });
    await exec.execute({
      sql: `UPDATE creative_context_item_versions
        SET content = ?, mime_type = ?, metadata = ? WHERE id = ?`,
      args: [
        html,
        "text/html",
        JSON.stringify({
          nativeArtifact: {
            schemaVersion: 1,
            app: "slides",
            format: "slides-html",
            rootExternalId: "presentation-1:slide-1",
            fidelityReport: {
              exact: { count: 1 },
              approximated: { count: 0, reasons: [] },
              imageFallback: { count: 0, reasons: [] },
            },
          },
        }),
        "allowed-v2",
      ],
    });
    const suggestion = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        store.proposeCreativeContextSuggestion({
          kind: "layout-template",
          itemId: "allowed",
          itemVersionId: "allowed-v2",
        }),
    );

    await expect(
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        () =>
          store.applyLayoutTemplateSuggestion({
            suggestionId: suggestion.id,
            operation: "promote",
          }),
      ),
    ).rejects.toThrow(/native content.*exceeds.*split the artifact/i);
    expect(promote).not.toHaveBeenCalled();
    const projectionCount = await exec.execute({
      sql: "SELECT COUNT(*) AS count FROM creative_context_items WHERE kind = 'layout_template'",
      args: [],
    });
    expect(Number(projectionCount.rows[0]?.count)).toBe(0);
  });

  it("never trusts a caller-supplied layout projection item id", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const server = await import("../server/index.js");
    const demote = vi.fn(async () => {});
    server.configureCreativeContext({
      projections: {
        layoutTemplate: { promote: vi.fn(async () => {}), demote },
      },
    });
    const proposed = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        store.proposeCreativeContextSuggestion({
          kind: "layout-template",
          itemId: "allowed",
          itemVersionId: "allowed-v2",
          payload: { projectionItemId: "guessed-item", note: "keep" },
        }),
    );
    expect(proposed.payload).toEqual({ note: "keep" });

    await exec.execute({
      sql: `INSERT INTO creative_context_sources
        (id, name, kind, config, upstream_access, status, health_status,
         item_count, restricted_item_count, owner_email, org_id, visibility,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "outside-source",
        "Outside tenant",
        "manual",
        "{}",
        "available",
        "active",
        "healthy",
        1,
        0,
        "mallory@example.test",
        "org-2",
        "private",
        "2026-07-16T00:00:00.000Z",
        "2026-07-16T00:00:00.000Z",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_items
        (id, source_id, external_id, kind, title, current_version_id,
         current_content_hash, status, upstream_access, curation_status,
         curation_rank, inventory_state, index_state, tags, colors, provenance,
         metadata, created_at, updated_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "outside-projection",
        "outside-source",
        "outside-projection",
        "layout_template",
        "Outside projection",
        "outside-version",
        "outside-hash",
        "active",
        "available",
        "included",
        "canonical",
        "available",
        "indexed",
        "[]",
        "[]",
        JSON.stringify({
          promotedFromSuggestionId: "malicious-layout-suggestion",
        }),
        "{}",
        "2026-07-16T00:00:00.000Z",
        "2026-07-16T00:00:00.000Z",
        "mallory@example.test",
        "org-2",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_suggestions
        (id, kind, status, item_id, item_version_id, payload, created_at,
         updated_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "malicious-layout-suggestion",
        "layout-template",
        "promoted",
        "allowed",
        "allowed-v2",
        JSON.stringify({ projectionItemId: "outside-projection" }),
        "2026-07-16T00:00:00.000Z",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });

    await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        store.applyLayoutTemplateSuggestion({
          suggestionId: "malicious-layout-suggestion",
          operation: "demote",
        }),
    );

    const outside = await exec.execute(
      "SELECT status FROM creative_context_items WHERE id = 'outside-projection'",
    );
    expect(outside.rows[0]?.status).toBe("active");
    expect(demote).toHaveBeenCalledWith({
      suggestionId: "malicious-layout-suggestion",
      projectionItemId: null,
    });
  });

  it("requires a host access proof before sharing generation history", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const { assertGenerationArtifactAccess } =
      await import("../server/generation-artifact-access.js");
    const asBob = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "bob@example.test", orgId: "org-1" },
        fn,
      );
    const artifact = {
      appId: "slides",
      artifactType: "deck",
      artifactId: "shared-deck",
    };
    const aliceProof = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        assertGenerationArtifactAccess(
          artifact,
          {
            resourceType: "creative-context-source",
            resourceId: "source-1",
          },
          "editor",
        ),
    );
    await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        store.recordGenerationCreativeContext(
          {
            ...artifact,
            contextMode: "auto",
            contextPackId: null,
            reuseLabels: [],
            elementProvenance: [
              { elementId: "slide-1", influence: "generated" },
            ],
          },
          { artifactAccess: aliceProof },
        ),
    );

    await expect(
      asBob(() => store.getGenerationCreativeContext(artifact)),
    ).resolves.toBeNull();
    await expect(
      asBob(() =>
        assertGenerationArtifactAccess(
          artifact,
          {
            resourceType: "creative-context-source",
            resourceId: "source-1",
          },
          "viewer",
        ),
      ),
    ).rejects.toThrow(/no access/i);
    await expect(
      asBob(() =>
        store.getGenerationCreativeContext(artifact, {
          artifactAccess: {
            identityKey: JSON.stringify([
              artifact.appId,
              artifact.artifactType,
              artifact.artifactId,
            ]),
            minRole: "viewer",
          } as never,
        }),
      ),
    ).rejects.toThrow(/verified by the host application/i);

    await asBob(() =>
      store.recordGenerationCreativeContext({
        ...artifact,
        contextMode: "auto",
        contextPackId: null,
        reuseLabels: [],
        elementProvenance: [{ elementId: "poison", influence: "generated" }],
      }),
    );
    const poison = await exec.execute(
      "SELECT org_id FROM creative_context_generation_records WHERE owner_email = 'bob@example.test'",
    );
    expect(poison.rows[0]?.org_id).toBeNull();
    await expect(
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        () =>
          store.getGenerationCreativeContext(artifact, {
            artifactAccess: aliceProof,
          }),
      ),
    ).resolves.toMatchObject({
      artifactId: "shared-deck",
      elementProvenance: [{ elementId: "slide-1" }],
    });

    await exec.execute({
      sql: `INSERT INTO creative_context_source_shares
        (id, resource_id, principal_type, principal_id, role, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "source-share-bob",
        "source-1",
        "user",
        "bob@example.test",
        "viewer",
        "alice@example.test",
        "2026-07-16T00:00:00.000Z",
      ],
    });
    const bobProof = await asBob(() =>
      assertGenerationArtifactAccess(
        artifact,
        {
          resourceType: "creative-context-source",
          resourceId: "source-1",
        },
        "viewer",
      ),
    );
    await expect(
      asBob(() =>
        store.getGenerationCreativeContext(artifact, {
          artifactAccess: bobProof,
        }),
      ),
    ).resolves.toMatchObject({
      artifactId: "shared-deck",
      elementProvenance: [{ elementId: "slide-1" }],
    });
    await expect(
      asBob(() =>
        store.getGenerationCreativeContext(
          { ...artifact, artifactId: "arbitrary-unasserted-id" },
          { artifactAccess: bobProof },
        ),
      ),
    ).rejects.toThrow(/verified by the host application/i);
  });

  it("appends media enrichment while preserving version-pinned pack evidence", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    await exec.execute({
      sql: `INSERT INTO creative_context_media
        (id, item_id, item_version_id, kind, mime_type, access_mode,
         storage_key, caption_status, palette, metadata, created_at,
         owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "media-before-enrichment",
        "allowed",
        "allowed-v2",
        "image",
        "image/png",
        "private",
        "private-blob:fixture",
        "pending",
        "[]",
        "{}",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const pack = await asAlice(() =>
      store.createContextPack({
        name: "Pinned before enrichment",
        members: [
          {
            itemId: "allowed",
            itemVersionId: "allowed-v2",
            reason: "Exact pre-enrichment evidence",
          },
        ],
      }),
    );

    const enriched = await asAlice(() =>
      store.appendMediaEnrichmentVersion({
        mediaId: "media-before-enrichment",
        palette: ["#663399", "#ffffff"],
        contentHash: "enriched-image-hash",
        caption: "Builder dashboard on a purple background",
        captionStatus: "complete",
        ocrText: "Ship faster",
      }),
    );

    expect(enriched.appended).toBe(true);
    expect(enriched.itemVersionId).not.toBe("allowed-v2");
    expect(enriched.mediaId).not.toBe("media-before-enrichment");
    const pinned = await asAlice(() =>
      store.getCreativeContextItem("allowed", "allowed-v2"),
    );
    expect(pinned?.media).toEqual([
      expect.objectContaining({
        id: "media-before-enrichment",
        caption: null,
        captionStatus: "pending",
        palette: [],
      }),
    ]);
    const current = await asAlice(() =>
      store.getCreativeContextItem("allowed"),
    );
    expect(current?.version.id).toBe(enriched.itemVersionId);
    expect(current?.media).toEqual([
      expect.objectContaining({
        id: enriched.mediaId,
        caption: "Builder dashboard on a purple background",
        captionStatus: "complete",
        ocrText: "Ship faster",
        palette: ["#663399", "#ffffff"],
      }),
    ]);
    const pinnedPack = await asAlice(() => store.getContextPack(pack.id));
    expect(pinnedPack?.members).toEqual([
      expect.objectContaining({
        itemId: "allowed",
        itemVersionId: "allowed-v2",
      }),
    ]);

    const resync = await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            externalId: "allowed",
            kind: "slide",
            title: "allowed title",
            content: "allowed canonical version 2",
            contentHash: "allowed-hash-v2",
            upstreamAccess: "available",
          },
        ],
      }),
    );
    expect(resync.unchanged).toBe(1);
    const afterResync = await asAlice(() =>
      store.getCreativeContextItem("allowed"),
    );
    expect(afterResync?.version.id).toBe(enriched.itemVersionId);
    expect(afterResync?.media[0]?.captionStatus).toBe("complete");

    const retried = await asAlice(() =>
      store.appendMediaEnrichmentVersion({
        mediaId: "media-before-enrichment",
        palette: ["#663399", "#ffffff"],
        contentHash: "enriched-image-hash",
        caption: "Builder dashboard on a purple background",
        captionStatus: "complete",
        ocrText: "Ship faster",
      }),
    );
    expect(retried).toEqual({
      itemId: "allowed",
      itemVersionId: enriched.itemVersionId,
      mediaId: enriched.mediaId,
      appended: false,
    });
  });

  it("reloads a concurrently inserted item instead of failing its idempotent ingest", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const ingest = () =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        () =>
          store.ingestItems({
            sourceId: "source-1",
            items: [
              {
                externalId: "concurrent-item",
                kind: "slide",
                title: "Concurrent item",
                content: "Same immutable content",
                contentHash: "concurrent-hash",
                provenance: { fixture: true },
              },
            ],
          }),
      );

    const results = await Promise.all([ingest(), ingest()]);
    expect(results.reduce((total, result) => total + result.created, 0)).toBe(
      1,
    );
    expect(results.reduce((total, result) => total + result.unchanged, 0)).toBe(
      1,
    );
    const items = await exec.execute({
      sql: "SELECT id FROM creative_context_items WHERE source_id = ? AND external_id = ?",
      args: ["source-1", "concurrent-item"],
    });
    expect(items.rows).toHaveLength(1);
    const versions = await exec.execute({
      sql: "SELECT id FROM creative_context_item_versions WHERE item_id = ?",
      args: [String(items.rows[0]!.id)],
    });
    expect(versions.rows).toHaveLength(1);
  });

  it("rejects direct ingest that bypasses normalized SQL text limits", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const ingest = (
      item: Parameters<typeof store.ingestItems>[0]["items"][0],
    ) =>
      asAlice(() => store.ingestItems({ sourceId: "source-1", items: [item] }));
    const base = {
      kind: "document",
      title: "Oversized direct ingest",
      contentHash: "oversized-direct-hash",
    };

    await expect(
      ingest({
        ...base,
        externalId: "oversized-searchable",
        content: "界".repeat(22_000),
      }),
    ).rejects.toThrow(/searchable content.*exceeds.*normalize or chunk/i);
    await expect(
      ingest({
        ...base,
        externalId: "oversized-summary",
        content: "bounded",
        summary: "🙂".repeat(2_049),
      }),
    ).rejects.toThrow(/summary.*exceeds.*normalize the summary/i);
    await expect(
      ingest({
        ...base,
        externalId: "oversized-chunks",
        content: "bounded",
        chunks: [
          { ordinal: 0, text: "a".repeat(40_000) },
          { ordinal: 1, text: "b".repeat(30_000) },
        ],
      }),
    ).rejects.toThrow(/chunks exceed.*normalize or split/i);
    await expect(
      ingest({
        ...base,
        externalId: "oversized-native",
        kind: "google-slides-slide",
        mimeType: "text/html",
        content: `<div>${"🙂".repeat(32_768)}</div>`,
        metadata: {
          nativeArtifact: { app: "slides", format: "slides-html" },
        },
      }),
    ).rejects.toThrow(/native content.*exceeds.*private blob storage/i);

    const rows = await exec.execute({
      sql: "SELECT id FROM creative_context_items WHERE external_id LIKE 'oversized-%'",
      args: [],
    });
    expect(rows.rows).toHaveLength(0);
  });

  it("keeps prior native code immutable across resync and resolves hierarchical children by source version", async () => {
    const { runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const firstHtml =
      "<!doctype html><html><head></head><body><div>Version one</div></body></html>";
    const secondHtml =
      "<!doctype html><html><head></head><body><div>Version two</div></body></html>";
    const first = await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            externalId: "figma-file:frame-1",
            kind: "figma-frame",
            title: "Native frame",
            mimeType: "text/html",
            content: firstHtml,
            contentHash: "native-code-v1",
            sourceVersion: "figma-v1",
            provenance: {
              compiler: "@agent-native/core/ingestion:figma-node-to-html",
            },
          },
        ],
      }),
    );
    const itemId = first.itemIds[0]!;
    const firstDetail = await asAlice(() =>
      store.getCreativeContextItem(itemId),
    );
    const firstVersionId = firstDetail!.version.id;

    const second = await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            externalId: "figma-file:frame-1",
            kind: "figma-frame",
            title: "Native frame",
            mimeType: "text/html",
            content: secondHtml,
            contentHash: "native-code-v2",
            sourceVersion: "figma-v2",
            provenance: {
              compiler: "@agent-native/core/ingestion:figma-node-to-html",
            },
          },
        ],
      }),
    );
    expect(second.versioned).toBe(1);
    await expect(
      asAlice(() => store.getCreativeContextItem(itemId, firstVersionId)),
    ).resolves.toMatchObject({ version: { content: firstHtml } });
    await expect(
      asAlice(() => store.getCreativeContextItem(itemId)),
    ).resolves.toMatchObject({ version: { content: secondHtml } });
    await expect(
      asAlice(() =>
        store.getCreativeContextItemByExternalId({
          sourceId: "source-1",
          externalId: "figma-file:frame-1",
          sourceVersion: "figma-v1",
        }),
      ),
    ).resolves.toMatchObject({
      version: { id: firstVersionId, content: firstHtml },
    });
  });

  it("versions notes-only changes while packs retain the prior immutable evidence", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const slide = (notes: string) =>
      normalizeContextItem({
        externalId: "notes-deck:slide-1",
        kind: "google-slides-slide",
        title: "Launch plan",
        mimeType: "text/html",
        content: '<div class="fmd-slide">Unchanged slide</div>',
        summary: `Speaker notes: ${notes}`,
        sourceVersion: "same-provider-revision",
        metadata: {
          speakerNotes: notes,
          nativeArtifact: {
            schemaVersion: 1,
            app: "slides",
            format: "slides-html",
          },
        },
        chunks: [
          {
            ordinal: 0,
            kind: "slides-native-lexical",
            text: `Unchanged slide Speaker notes ${notes}`,
          },
        ],
      });

    const first = await asAlice(() =>
      store.ingestItems({ sourceId: "source-1", items: [slide("Draft")] }),
    );
    const itemId = first.itemIds[0]!;
    const firstDetail = await asAlice(() =>
      store.getCreativeContextItem(itemId),
    );
    const firstVersionId = firstDetail!.version.id;
    const pack = await asAlice(() =>
      store.createContextPack({
        name: "Notes evidence",
        members: [{ itemId }],
      }),
    );

    const second = await asAlice(() =>
      store.ingestItems({ sourceId: "source-1", items: [slide("Approved")] }),
    );
    expect(second).toMatchObject({ versioned: 1, unchanged: 0 });
    await expect(
      asAlice(() => store.getCreativeContextItem(itemId, firstVersionId)),
    ).resolves.toMatchObject({
      version: { versionNumber: 1, summary: "Speaker notes: Draft" },
      chunks: [
        expect.objectContaining({ text: expect.stringContaining("Draft") }),
      ],
    });
    await expect(
      asAlice(() => store.getCreativeContextItem(itemId)),
    ).resolves.toMatchObject({
      version: { versionNumber: 2, summary: "Speaker notes: Approved" },
      chunks: [
        expect.objectContaining({ text: expect.stringContaining("Approved") }),
      ],
    });
    await expect(
      asAlice(() => store.getContextPack(pack.id)),
    ).resolves.toMatchObject({
      members: [expect.objectContaining({ itemVersionId: firstVersionId })],
    });
    const versions = await exec.execute({
      sql: "SELECT version_number FROM creative_context_item_versions WHERE item_id = ? ORDER BY version_number",
      args: [itemId],
    });
    expect(versions.rows).toEqual([
      expect.objectContaining({ version_number: 1 }),
      expect.objectContaining({ version_number: 2 }),
    ]);
  });

  it("dedupes reordered evidence but versions metadata and media-only changes", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const item = (input: { reversed: boolean; assetRole: string }) => {
      const chunks = [
        { ordinal: 0, kind: "text", text: "Stable body" },
        { ordinal: 1, kind: "code", text: "font-family: Inter" },
      ];
      const media = [
        {
          kind: "image" as const,
          accessMode: "public" as const,
          url: "https://cdn.example.test/a.png",
          contentHash: "asset-a",
          metadata: { role: input.assetRole },
        },
        {
          kind: "image" as const,
          accessMode: "public" as const,
          url: "https://cdn.example.test/b.png",
          contentHash: "asset-b",
          metadata: { role: "supporting" },
        },
      ];
      const edges = [
        { relation: "uses-asset", toExternalId: "asset-a" },
        { relation: "uses-asset", toExternalId: "asset-b" },
      ];
      return normalizeContextItem({
        externalId: "media-evidence",
        kind: "design-artifact",
        title: "Media evidence",
        content: "Stable body",
        sourceVersion: "stable-source-version",
        metadata: { fidelity: { exact: 2 }, provider: "fixture" },
        chunks: input.reversed ? [...chunks].reverse() : chunks,
        media: input.reversed ? [...media].reverse() : media,
        edges: input.reversed ? [...edges].reverse() : edges,
      });
    };

    const original = item({ reversed: false, assetRole: "hero" });
    const reordered = item({ reversed: true, assetRole: "hero" });
    expect(reordered.contentHash).toBe(original.contentHash);
    const first = await asAlice(() =>
      store.ingestItems({ sourceId: "source-1", items: [original] }),
    );
    const itemId = first.itemIds[0]!;
    const firstVersionId = (await asAlice(() =>
      store.getCreativeContextItem(itemId),
    ))!.version.id;
    const pack = await asAlice(() =>
      store.createContextPack({
        name: "Media evidence",
        members: [{ itemId }],
      }),
    );
    const unchanged = await asAlice(() =>
      store.ingestItems({ sourceId: "source-1", items: [reordered] }),
    );
    expect(unchanged).toMatchObject({ versioned: 0, unchanged: 1 });

    const changed = await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [item({ reversed: true, assetRole: "canonical-logo" })],
      }),
    );
    expect(changed).toMatchObject({ versioned: 1, unchanged: 0 });
    await expect(
      asAlice(() => store.getCreativeContextItem(itemId, firstVersionId)),
    ).resolves.toMatchObject({
      version: { versionNumber: 1 },
      media: [
        expect.objectContaining({ metadata: { role: "hero" } }),
        expect.objectContaining({ metadata: { role: "supporting" } }),
      ],
    });
    await expect(
      asAlice(() => store.getCreativeContextItem(itemId)),
    ).resolves.toMatchObject({
      version: { versionNumber: 2 },
      media: expect.arrayContaining([
        expect.objectContaining({ metadata: { role: "canonical-logo" } }),
      ]),
    });
    await expect(
      asAlice(() => store.getContextPack(pack.id)),
    ).resolves.toMatchObject({
      members: [expect.objectContaining({ itemVersionId: firstVersionId })],
    });
    const versions = await exec.execute({
      sql: "SELECT version_number FROM creative_context_item_versions WHERE item_id = ? ORDER BY version_number",
      args: [itemId],
    });
    expect(versions.rows).toHaveLength(2);
  });

  it("pins hierarchical parent versions to exact child versions across later resyncs and access loss", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const { reassembleNativeCreativeArtifact } =
      await import("../native-artifact-reassembly.js");
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const fidelityReport = {
      exact: { count: 1 },
      approximated: { count: 0, reasons: [] },
      imageFallback: { count: 0, reasons: [] },
    };
    const parentExternalId = "figma-file:parent";
    const childExternalId = "figma-file:child";
    const parentHtml = (label: string) =>
      `<!doctype html><html><head></head><body><div data-label="${label}"><div data-creative-context-child="${childExternalId}"></div></div></body></html>`;
    const childHtml = (label: string) =>
      `<!doctype html><html><head></head><body><div>${label}</div></body></html>`;
    const nativeMetadata = (externalId: string, child = false) => ({
      nativeArtifact: {
        schemaVersion: 1,
        app: "design",
        format: "design-html",
        rootExternalId: externalId,
        ...(child
          ? {}
          : {
              childExternalIds: [childExternalId],
              manifest: {
                kind: "hierarchical-artboard",
                children: [
                  {
                    externalId: childExternalId,
                    sourceNodeId: "2:1",
                    bounds: { x: 10, y: 20, width: 200, height: 100 },
                    zOrder: 0,
                  },
                ],
              },
            }),
        fidelityReport,
      },
    });
    const provenance = {
      compiler: "@agent-native/core/ingestion:figma-node-to-html",
    };
    const parentEdges = [
      {
        relation: "contains-native-child",
        toExternalId: childExternalId,
      },
    ];

    const first = await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            externalId: parentExternalId,
            kind: "figma-artboard-manifest",
            title: "Parent",
            mimeType: "text/html",
            content: parentHtml("parent-v1"),
            contentHash: "parent-v1",
            sourceVersion: "figma-v1",
            provenance,
            metadata: nativeMetadata(parentExternalId),
            edges: parentEdges,
          },
          {
            externalId: childExternalId,
            kind: "figma-frame",
            title: "Child",
            mimeType: "text/html",
            content: childHtml("Child v1"),
            contentHash: "child-v1",
            sourceVersion: "figma-v1",
            provenance,
            metadata: nativeMetadata(childExternalId, true),
          },
        ],
      }),
    );
    const parentId = first.itemIds[0]!;
    const childId = first.itemIds[1]!;
    const childV1 = await asAlice(() => store.getCreativeContextItem(childId));

    await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            externalId: parentExternalId,
            kind: "figma-artboard-manifest",
            title: "Parent",
            mimeType: "text/html",
            content: parentHtml("parent-v2"),
            contentHash: "parent-v2",
            sourceVersion: "figma-v2",
            provenance,
            metadata: nativeMetadata(parentExternalId),
            edges: parentEdges,
          },
          {
            externalId: childExternalId,
            kind: "figma-frame",
            title: "Child",
            mimeType: "text/html",
            content: childHtml("Child v1"),
            contentHash: "child-v1",
            sourceVersion: "figma-v2",
            provenance,
            metadata: nativeMetadata(childExternalId, true),
          },
        ],
      }),
    );
    const parentV2 = await asAlice(() =>
      store.getCreativeContextItem(parentId),
    );
    expect(parentV2?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "contains-native-child",
          toItemId: childId,
          toItemVersionId: childV1!.version.id,
        }),
      ]),
    );

    await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            externalId: childExternalId,
            kind: "figma-frame",
            title: "Child",
            mimeType: "text/html",
            content: childHtml("Child v2"),
            contentHash: "child-v2",
            sourceVersion: "figma-v3",
            provenance,
            metadata: nativeMetadata(childExternalId, true),
          },
        ],
      }),
    );
    const pinnedParent = await asAlice(() =>
      store.getCreativeContextItem(parentId, parentV2!.version.id),
    );
    const reassembled = await asAlice(() =>
      reassembleNativeCreativeArtifact({
        root: pinnedParent!,
        app: "design",
        format: "design-html",
        resolveChild: store.getCreativeContextItemByExternalId,
      }),
    );
    expect(reassembled.html).toContain("Child v1");
    expect(reassembled.html).not.toContain("Child v2");

    await exec.execute({
      sql: "UPDATE creative_context_items SET status = 'unavailable' WHERE id = ?",
      args: [childId],
    });
    await expect(
      asAlice(() =>
        reassembleNativeCreativeArtifact({
          root: pinnedParent!,
          app: "design",
          format: "design-html",
          resolveChild: store.getCreativeContextItemByExternalId,
        }),
      ),
    ).rejects.toThrow("unavailable at the pinned source version");
  });

  it("publishes trusted Slides and Figma hierarchies without losing compiler metadata or child pins", async () => {
    const { runWithRequestContext, store } = await setup();
    const { reassembleNativeCreativeArtifact } =
      await import("../native-artifact-reassembly.js");
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const asBob = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "bob@example.test", orgId: "org-1" },
        fn,
      );
    const fidelityReport = {
      exact: { count: 1 },
      approximated: { count: 0, reasons: [] },
      imageFallback: { count: 0, reasons: [] },
    };
    for (const fixture of [
      {
        app: "slides" as const,
        format: "slides-html" as const,
        compiler: "@agent-native/creative-context:google-slides-native",
      },
      {
        app: "design" as const,
        format: "design-html" as const,
        compiler: "@agent-native/core/ingestion:figma-node-to-html",
      },
    ]) {
      const rootExternalId = `${fixture.app}:published-root`;
      const childExternalId = `${fixture.app}:published-child`;
      const rootHtml = `<!doctype html><html><head></head><body><div data-creative-context-child="${childExternalId}"></div></body></html>`;
      const childHtml = `<!doctype html><html><head></head><body><div>${fixture.app} child</div></body></html>`;
      const ingested = await asAlice(() =>
        store.ingestItems({
          sourceId: "source-1",
          items: [
            {
              externalId: rootExternalId,
              kind: "native-manifest",
              title: `${fixture.app} root`,
              mimeType: "text/html",
              content: rootHtml,
              contentHash: `${fixture.app}-root-v1`,
              provenance: { compiler: fixture.compiler },
              metadata: {
                nativeArtifact: {
                  schemaVersion: 1,
                  app: fixture.app,
                  format: fixture.format,
                  rootExternalId,
                  childExternalIds: [childExternalId],
                  manifest: {
                    kind: "hierarchical-artboard",
                    children: [
                      {
                        externalId: childExternalId,
                        sourceNodeId: "child-1",
                        bounds: { x: 0, y: 0, width: 10, height: 10 },
                        zOrder: 0,
                      },
                    ],
                  },
                  fidelityReport,
                },
              },
              edges: [
                {
                  relation: "contains-native-child",
                  toExternalId: childExternalId,
                },
              ],
            },
            {
              externalId: childExternalId,
              kind: "native-child",
              title: `${fixture.app} child`,
              mimeType: "text/html",
              content: childHtml,
              contentHash: `${fixture.app}-child-v1`,
              provenance: { compiler: fixture.compiler },
              metadata: {
                nativeArtifact: {
                  schemaVersion: 1,
                  app: fixture.app,
                  format: fixture.format,
                  rootExternalId: childExternalId,
                  fidelityReport,
                },
              },
            },
          ],
        }),
      );
      const context = await asAlice(() =>
        store.createCreativeContext({
          name: `${fixture.app} fidelity`,
          kind: "specialty",
        }),
      );
      await asAlice(() =>
        store.manageContextMembership({
          operation: "submit",
          contextId: context!.id,
          itemId: ingested.itemIds[0],
          confirmBroaderPublication: true,
        }),
      );
      const membership = (
        await asAlice(() =>
          store.listContextMemberships({ contextId: context!.id, limit: 20 }),
        )
      ).memberships.find(
        (entry) => entry.artifactKey === `source-1:${rootExternalId}`,
      )!;
      const published = await asBob(() =>
        store.getCreativeContextItem(
          membership.publishedItemId!,
          membership.publishedItemVersionId!,
        ),
      );
      expect(published?.item.provenance.compiler).toBe(fixture.compiler);
      expect(published?.version.metadata).toMatchObject({
        nativeArtifact: { app: fixture.app, format: fixture.format },
      });
      const reassembled = await asBob(() =>
        reassembleNativeCreativeArtifact({
          root: published!,
          app: fixture.app,
          format: fixture.format,
          resolveChild: store.getCreativeContextItemByExternalId,
        }),
      );
      expect(reassembled.html).toContain(`${fixture.app} child`);
      expect(reassembled.evidence).toHaveLength(2);

      const childEdge = published!.edges.find(
        (edge) => edge.relation === "contains-native-child",
      );
      expect(childEdge).toMatchObject({
        toItemId: expect.any(String),
        toItemVersionId: expect.any(String),
      });
      const pack = await asAlice(() =>
        store.createContextPack({
          name: `${fixture.app} hierarchical replay`,
          baseContextId: context!.id,
          members: [
            {
              itemId: published!.item.id,
              itemVersionId: published!.version.id,
              reason: "Explicit root",
              score: 0.91,
              scoreMetadata: { source: "test" },
            },
          ],
        }),
      );
      expect(pack.members).toEqual([
        expect.objectContaining({
          itemId: published!.item.id,
          itemVersionId: published!.version.id,
          ordinal: 0,
          reason: "Explicit root",
          score: 0.91,
          scoreMetadata: { source: "test" },
        }),
        expect.objectContaining({
          itemId: childEdge!.toItemId,
          itemVersionId: childEdge!.toItemVersionId,
          ordinal: 1,
          reason: "Native artifact dependency",
          score: null,
        }),
      ]);
      await asAlice(() =>
        store.manageContextMembership({
          operation: "remove",
          contextId: context!.id,
          membershipId: membership.id,
        }),
      );
      const removedMemberships = await asAlice(() =>
        store.listContextMemberships({ contextId: context!.id, limit: 20 }),
      );
      expect(
        removedMemberships.memberships.filter(
          (entry) =>
            entry.publishedItemId === published!.item.id ||
            entry.publishedItemId === childEdge!.toItemId,
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            publishedItemId: published!.item.id,
            status: "removed",
          }),
          expect.objectContaining({
            publishedItemId: childEdge!.toItemId,
            status: "removed",
          }),
        ]),
      );
      const replayPack = await asBob(() => store.getContextPack(pack.id));
      expect(replayPack?.members).toHaveLength(2);
      const replayRoot = await asBob(() =>
        store.getCreativeContextItem(published!.item.id, published!.version.id),
      );
      const replayChild = await asBob(() =>
        store.getCreativeContextItem(
          childEdge!.toItemId!,
          childEdge!.toItemVersionId!,
        ),
      );
      expect(replayRoot?.version.id).toBe(published!.version.id);
      expect(replayChild?.version.id).toBe(childEdge!.toItemVersionId);
      const replayed = await asBob(() =>
        reassembleNativeCreativeArtifact({
          root: replayRoot!,
          app: fixture.app,
          format: fixture.format,
          resolveChild: store.getCreativeContextItemByExternalId,
        }),
      );
      expect(replayed.html).toContain(`${fixture.app} child`);
      expect(replayed.evidence).toEqual(
        expect.arrayContaining([
          {
            itemId: published!.item.id,
            itemVersionId: published!.version.id,
          },
          {
            itemId: childEdge!.toItemId,
            itemVersionId: childEdge!.toItemVersionId,
          },
        ]),
      );
    }
  });

  it("does not turn a forged compiler id into a trusted published artifact", async () => {
    const { runWithRequestContext, store } = await setup();
    const { reassembleNativeCreativeArtifact } =
      await import("../native-artifact-reassembly.js");
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const ingested = await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            externalId: "forged-native",
            kind: "native",
            title: "Forged",
            mimeType: "text/html",
            content:
              "<!doctype html><html><head></head><body><div>forged</div></body></html>",
            contentHash: "forged-v1",
            provenance: { compiler: "attacker/compiler" },
            metadata: {
              nativeArtifact: {
                schemaVersion: 1,
                app: "design",
                format: "design-html",
                rootExternalId: "forged-native",
                fidelityReport: {
                  exact: { count: 1 },
                  approximated: { count: 0, reasons: [] },
                  imageFallback: { count: 0, reasons: [] },
                },
              },
            },
          },
        ],
      }),
    );
    const context = await asAlice(() =>
      store.createCreativeContext({ name: "forged", kind: "specialty" }),
    );
    await asAlice(() =>
      store.manageContextMembership({
        operation: "submit",
        contextId: context!.id,
        itemId: ingested.itemIds[0],
        confirmBroaderPublication: true,
      }),
    );
    const membership = (
      await asAlice(() =>
        store.listContextMemberships({ contextId: context!.id, limit: 10 }),
      )
    ).memberships[0]!;
    const published = await asAlice(() =>
      store.getCreativeContextItem(
        membership.publishedItemId!,
        membership.publishedItemVersionId!,
      ),
    );
    await expect(
      asAlice(() =>
        reassembleNativeCreativeArtifact({
          root: published!,
          app: "design",
          format: "design-html",
          resolveChild: store.getCreativeContextItemByExternalId,
        }),
      ),
    ).rejects.toThrow(/trusted native artifact compiler/i);
  });

  it("keeps pending submissions private to their submitter and context reviewers", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asUser = <T>(userEmail: string, fn: () => Promise<T>) =>
      runWithRequestContext({ userEmail, orgId: "org-1" }, fn);
    const asAlice = <T>(fn: () => Promise<T>) =>
      asUser("alice@example.test", fn);
    const asBob = <T>(fn: () => Promise<T>) => asUser("bob@example.test", fn);
    const asCarol = <T>(fn: () => Promise<T>) =>
      asUser("carol@example.test", fn);
    const asDrew = <T>(fn: () => Promise<T>) => asUser("drew@example.test", fn);
    const context = await asAlice(() =>
      store.createCreativeContext({
        name: "Review-only governance",
        kind: "specialty",
        approvalPolicy: "review",
      }),
    );
    const timestamp = "2026-07-17T00:00:00.000Z";
    await exec.execute({
      sql: `INSERT INTO creative_context_source_shares
        (id, resource_id, principal_type, principal_id, role, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "source-share-bob",
        "source-1",
        "user",
        "bob@example.test",
        "admin",
        "alice@example.test",
        timestamp,
      ],
    });
    for (const [id, email] of [
      ["context-share-bob", "bob@example.test"],
      ["context-share-drew", "drew@example.test"],
    ]) {
      await exec.execute({
        sql: `INSERT INTO creative_context_shares
          (id, resource_id, principal_type, principal_id, role, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          context!.id,
          "user",
          email,
          "editor",
          "alice@example.test",
          timestamp,
        ],
      });
    }
    await exec.execute({
      sql: "UPDATE creative_context_items SET thumbnail_blob_ref = ? WHERE id = ?",
      args: ["creative-context-blob:v1:pending-preview-opaque", "allowed"],
    });

    await expect(
      asCarol(() =>
        store.manageContextMembership({
          operation: "submit",
          contextId: context!.id,
          itemId: "allowed",
        }),
      ),
    ).rejects.toThrow();
    expect(
      (await asBob(() => store.getCreativeContextById(context!.id)))?.access,
    ).toMatchObject({ canSubmit: true, canReview: false });

    const submitted = await asBob(() =>
      store.manageContextMembership({
        operation: "submit",
        contextId: context!.id,
        itemId: "allowed",
        confirmBroaderPublication: true,
      }),
    );
    const membershipId = submitted.membershipId;
    await expect(
      asBob(() =>
        store.manageContextMembership({
          operation: "approve",
          contextId: context!.id,
          membershipId,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asDrew(() =>
        store.manageContextMembership({
          operation: "remove",
          contextId: context!.id,
          membershipId,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asBob(() =>
        store.updateCreativeContext(context!.id, { name: "Unapproved edit" }),
      ),
    ).rejects.toThrow();

    const ownPending = await asBob(() =>
      store.listContextMemberships({ contextId: context!.id, limit: 10 }),
    );
    expect(ownPending.memberships).toEqual([
      expect.objectContaining({
        id: membershipId,
        artifactKey: "source-1:allowed",
        pendingSubmission: expect.objectContaining({
          submittedBy: "bob@example.test",
          proposedItem: expect.objectContaining({
            title: "allowed title",
            itemVersionId: expect.any(String),
          }),
        }),
      }),
    ]);
    const proposedItem =
      ownPending.memberships[0]?.pendingSubmission?.proposedItem;
    expect(proposedItem).toMatchObject({
      id: expect.any(String),
      itemVersionId: expect.any(String),
    });
    expect(JSON.stringify(ownPending)).not.toContain("pending-preview-opaque");
    await expect(
      asBob(() =>
        store.readPendingCreativeContextMedia({
          itemId: proposedItem!.id,
          itemVersionId: proposedItem!.itemVersionId,
        }),
      ),
    ).resolves.toMatchObject({
      storageKey: "creative-context-blob:v1:pending-preview-opaque",
    });
    await expect(
      asAlice(() =>
        store.readPendingCreativeContextMedia({
          itemId: proposedItem!.id,
          itemVersionId: proposedItem!.itemVersionId,
        }),
      ),
    ).resolves.toMatchObject({
      storageKey: "creative-context-blob:v1:pending-preview-opaque",
    });
    await expect(
      asDrew(() =>
        store.readPendingCreativeContextMedia({
          itemId: proposedItem!.id,
          itemVersionId: proposedItem!.itemVersionId,
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      asCarol(() =>
        store.readPendingCreativeContextMedia({
          itemId: proposedItem!.id,
          itemVersionId: proposedItem!.itemVersionId,
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      asDrew(() =>
        store.listContextMemberships({ contextId: context!.id, limit: 10 }),
      ),
    ).resolves.toMatchObject({ memberships: [] });
    await expect(
      asCarol(() =>
        store.listContextMemberships({ contextId: context!.id, limit: 10 }),
      ),
    ).resolves.toMatchObject({ memberships: [] });

    const reviewerView = await asAlice(() =>
      store.listContextMemberships({ contextId: context!.id, limit: 10 }),
    );
    expect(reviewerView.memberships[0]).toMatchObject({
      id: membershipId,
      pendingSubmission: expect.objectContaining({
        submittedBy: "bob@example.test",
        proposedItem: expect.objectContaining({
          title: "allowed title",
        }),
      }),
    });
    expect(
      (await asAlice(() => store.getCreativeContextById(context!.id)))?.access,
    ).toMatchObject({ canReview: true, canAdmin: true });

    await asAlice(() =>
      store.manageContextMembership({
        operation: "approve",
        contextId: context!.id,
        membershipId,
      }),
    );
    const approvedForViewer = await asCarol(() =>
      store.listContextMemberships({ contextId: context!.id, limit: 10 }),
    );
    expect(approvedForViewer.memberships).toEqual([
      expect.objectContaining({
        id: membershipId,
        artifactKey: "source-1:allowed",
        pendingSubmissionId: null,
        pendingSubmission: null,
        publishedItem: expect.objectContaining({ id: expect.any(String) }),
      }),
    ]);

    const approvedVersionId =
      approvedForViewer.memberships[0]!.publishedItemVersionId;
    await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            externalId: "allowed",
            kind: "slide",
            title: "allowed title update",
            content: "new source version pending review",
            contentHash: "allowed-hash-v3",
            upstreamAccess: "available",
          },
        ],
      }),
    );
    await asBob(() =>
      store.manageContextMembership({
        operation: "submit",
        contextId: context!.id,
        itemId: "allowed",
        confirmBroaderPublication: true,
      }),
    );
    const viewerDuringUpdate = await asCarol(() =>
      store.listContextMemberships({ contextId: context!.id, limit: 10 }),
    );
    expect(viewerDuringUpdate.memberships[0]).toMatchObject({
      publishedItemVersionId: approvedVersionId,
      pendingSubmissionId: null,
      pendingSubmission: null,
    });
    const reviewerDuringUpdate = await asAlice(() =>
      store.listContextMemberships({ contextId: context!.id, limit: 10 }),
    );
    expect(reviewerDuringUpdate.memberships[0]).toMatchObject({
      publishedItemVersionId: approvedVersionId,
      pendingSubmission: expect.objectContaining({ status: "pending" }),
    });
  });

  it("applies open and admins-only publication policies to editor submissions", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asUser = <T>(userEmail: string, fn: () => Promise<T>) =>
      runWithRequestContext({ userEmail, orgId: "org-1" }, fn);
    const asAlice = <T>(fn: () => Promise<T>) =>
      asUser("alice@example.test", fn);
    const asBob = <T>(fn: () => Promise<T>) => asUser("bob@example.test", fn);
    await exec.execute({
      sql: "UPDATE creative_context_sources SET visibility = 'org' WHERE id = 'source-1'",
      args: [],
    });
    const [open, adminsOnly] = await Promise.all([
      asAlice(() =>
        store.createCreativeContext({
          name: "Open",
          kind: "specialty",
          approvalPolicy: "open",
        }),
      ),
      asAlice(() =>
        store.createCreativeContext({
          name: "Admin publishing",
          kind: "specialty",
          approvalPolicy: "admins-only",
        }),
      ),
    ]);
    for (const [id, contextId] of [
      ["open-editor", open!.id],
      ["admins-editor", adminsOnly!.id],
    ]) {
      await exec.execute({
        sql: `INSERT INTO creative_context_shares
          (id, resource_id, principal_type, principal_id, role, created_by, created_at)
          VALUES (?, ?, 'user', 'bob@example.test', 'editor', 'alice@example.test', ?)`,
        args: [id, contextId, "2026-07-17T00:00:00.000Z"],
      });
    }
    const openSubmission = await asBob(() =>
      store.manageContextMembership({
        operation: "submit",
        contextId: open!.id,
        itemId: "allowed",
      }),
    );
    expect(openSubmission.submission).toMatchObject({ status: "approved" });

    const governedSubmission = await asBob(() =>
      store.manageContextMembership({
        operation: "submit",
        contextId: adminsOnly!.id,
        itemId: "allowed",
      }),
    );
    expect(governedSubmission.submission).toMatchObject({ status: "pending" });
    await expect(
      asBob(() =>
        store.manageContextMembership({
          operation: "approve",
          contextId: adminsOnly!.id,
          membershipId: governedSubmission.membershipId,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asAlice(() =>
        store.manageContextMembership({
          operation: "approve",
          contextId: adminsOnly!.id,
          membershipId: governedSubmission.membershipId,
        }),
      ),
    ).resolves.toEqual({ approved: true });
  });

  it("serializes concurrent Default creation to one scope-owned context", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const createDefault = () =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        () => store.createCreativeContext({ name: "Default", kind: "default" }),
      );
    const [first, second] = await Promise.all([
      createDefault(),
      createDefault(),
    ]);
    expect(first?.id).toBe(second?.id);
    const rows = await exec.execute({
      sql: `SELECT id FROM creative_contexts
        WHERE default_scope_key = ?`,
      args: ["org:org-1"],
    });
    expect(rows.rows).toHaveLength(1);
  });

  it("keeps Default non-archivable and does not broaden private corpus during org backfill", async () => {
    const { runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const context = await asAlice(() => store.ensureDefaultCreativeContext());
    expect(context).toMatchObject({ kind: "default", visibility: "org" });
    await expect(
      asAlice(() => store.archiveCreativeContext(context!.id)),
    ).rejects.toThrow(/Default Creative Context cannot be archived/);
    const memberships = await asAlice(() =>
      store.listContextMemberships({ contextId: context!.id, limit: 10 }),
    );
    expect(memberships.memberships).toEqual([]);
  });

  it("applies each Creative Context's rank to the same item at retrieval time", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const [canonical, normal] = await Promise.all([
      asAlice(() =>
        store.createCreativeContext({
          name: "Canonical lane",
          kind: "specialty",
        }),
      ),
      asAlice(() =>
        store.createCreativeContext({ name: "Normal lane", kind: "specialty" }),
      ),
    ]);
    for (const [id, contextId, rank] of [
      ["canonical-membership", canonical!.id, "canonical"],
      ["normal-membership", normal!.id, "normal"],
    ]) {
      await exec.execute({
        sql: `INSERT INTO creative_context_memberships
          (id, context_id, artifact_key, published_item_id, published_item_version_id,
           rank, status, created_at, updated_at, owner_email, org_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          contextId,
          "source-1:allowed",
          "allowed",
          "allowed-v2",
          rank,
          "active",
          "2026-07-17T00:00:00.000Z",
          "2026-07-17T00:00:00.000Z",
          "alice@example.test",
          "org-1",
        ],
      });
    }
    const [canonicalResults, normalResults, canonicalDocuments] =
      await Promise.all([
        asAlice(() =>
          store.listAccessibleLexicalCandidates({
            query: "canonical version 2",
            contextId: canonical!.id,
            limit: 10,
          }),
        ),
        asAlice(() =>
          store.listAccessibleLexicalCandidates({
            query: "canonical version 2",
            contextId: normal!.id,
            limit: 10,
          }),
        ),
        asAlice(() =>
          store.listAccessibleSearchDocuments({
            contextId: canonical!.id,
            limit: 10,
          }),
        ),
      ]);
    expect(canonicalResults.results[0]).toMatchObject({
      itemId: "allowed",
      itemVersionId: "allowed-v2",
    });
    expect(canonicalResults.results[0]!.score).toBeGreaterThan(
      normalResults.results[0]!.score,
    );
    expect(canonicalDocuments[0]).toMatchObject({
      itemId: "allowed",
      curationRank: "canonical",
    });
  });

  it("finds native artifacts through bounded code-token chunks", async () => {
    const { runWithRequestContext, store } = await setup();
    const { performCreativeContextSearch } =
      await import("../server/retrieval.js");
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const ingested = await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            externalId: "figma-file:metric-card",
            kind: "figma-frame",
            title: "Metric card",
            mimeType: "text/html",
            content:
              '<!doctype html><html><head></head><body><div class="metric-card"></div></body></html>',
            contentHash: "metric-card-native-v1",
            chunks: [
              {
                ordinal: 0,
                kind: "code",
                text: "metric-card display-grid align-items-center",
                metadata: {
                  role: "code-tokens",
                  format: "design-html",
                },
              },
            ],
          },
        ],
      }),
    );

    const result = await asAlice(() =>
      performCreativeContextSearch({
        query: "metric-card align-items-center",
        limit: 5,
        matchMode: "allTerms",
        snapshot: false,
      }),
    );
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: ingested.itemIds[0],
          kind: "figma-frame",
        }),
      ]),
    );
  });

  it("reloads a concurrently discovered inventory item instead of duplicating it", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const upsert = () =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        () =>
          store.upsertSourceInventory({
            sourceId: "source-1",
            items: [
              {
                externalId: "concurrent-inventory",
                kind: "document",
                title: "Concurrent inventory",
              },
            ],
          }),
      );

    const results = await Promise.all([upsert(), upsert()]);
    expect(results.reduce((total, result) => total + result.created, 0)).toBe(
      1,
    );
    expect(results.reduce((total, result) => total + result.updated, 0)).toBe(
      1,
    );
    const items = await exec.execute({
      sql: "SELECT id FROM creative_context_items WHERE source_id = ? AND external_id = ?",
      args: ["source-1", "concurrent-inventory"],
    });
    expect(items.rows).toHaveLength(1);
  });

  it("reconciles removed and restored inventory without weakening source access", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const asBob = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "bob@example.test", orgId: "org-1" },
        fn,
      );

    await expect(
      asBob(() =>
        store.reconcileSourceInventory({
          sourceId: "source-1",
          presentExternalIds: ["allowed"],
        }),
      ),
    ).rejects.toThrow();

    await expect(
      asAlice(() =>
        store.reconcileSourceInventory({
          sourceId: "source-1",
          presentExternalIds: ["allowed"],
          completedAt: "2026-07-16T01:00:00.000Z",
        }),
      ),
    ).resolves.toEqual({ removed: 1, restored: 0 });
    let rows = await exec.execute(
      "SELECT id, status, inventory_state FROM creative_context_items ORDER BY id",
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({
        id: "allowed",
        status: "active",
        inventory_state: "available",
      }),
      expect.objectContaining({
        id: "restricted",
        status: "unavailable",
        inventory_state: "removed",
      }),
    ]);
    let source = await exec.execute(
      "SELECT item_count, restricted_item_count FROM creative_context_sources WHERE id = 'source-1'",
    );
    expect(source.rows[0]).toMatchObject({
      item_count: 1,
      restricted_item_count: 0,
    });

    await expect(
      asAlice(() =>
        store.reconcileSourceInventory({
          sourceId: "source-1",
          presentExternalIds: ["allowed", "restricted"],
          completedAt: "2026-07-16T02:00:00.000Z",
        }),
      ),
    ).resolves.toEqual({ removed: 0, restored: 1 });
    rows = await exec.execute(
      "SELECT status, inventory_state, upstream_access, curation_status FROM creative_context_items WHERE id = 'restricted'",
    );
    expect(rows.rows[0]).toMatchObject({
      status: "active",
      inventory_state: "available",
      upstream_access: "restricted",
      curation_status: "review",
    });
    source = await exec.execute(
      "SELECT item_count, restricted_item_count FROM creative_context_sources WHERE id = 'source-1'",
    );
    expect(source.rows[0]).toMatchObject({
      item_count: 2,
      restricted_item_count: 1,
    });
  });

  it("creates one daily maintenance job across concurrent app workers", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const create = () =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        () =>
          store.createDailyMaintenanceJob({
            sourceId: "source-1",
            scheduledAt: "2026-07-16T17:00:00.000Z",
          }),
      );
    const results = await Promise.all([create(), create(), create(), create()]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.job.id))).toHaveLength(1);
    const rows = await exec.execute({
      sql: "SELECT id FROM creative_context_jobs WHERE scoped_dedupe_key = ?",
      args: ["daily-maintenance:source-1:2026-07-16"],
    });
    expect(rows.rows).toHaveLength(1);
  });

  it("deduplicates jobs inside one tenant without colliding across scopes", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const create = (userEmail: string, orgId: string | undefined) =>
      runWithRequestContext({ userEmail, orgId }, () =>
        store.createJob({
          kind: "metadata-refresh",
          dedupeKey: "same-logical-operation",
        }),
      );

    const aliceOrgOne = await create("alice@example.test", "org-1");
    const aliceOrgOneAgain = await create("alice@example.test", "org-1");
    const bobOrgOne = await create("bob@example.test", "org-1");
    const aliceOrgTwo = await create("alice@example.test", "org-2");
    const alicePersonal = await create("alice@example.test", undefined);

    expect(aliceOrgOneAgain.id).toBe(aliceOrgOne.id);
    expect(
      new Set([aliceOrgOne.id, bobOrgOne.id, aliceOrgTwo.id, alicePersonal.id]),
    ).toHaveLength(4);
    const rows = await exec.execute(
      `SELECT dedupe_key, dedupe_scope, scoped_dedupe_key
       FROM creative_context_jobs
       WHERE scoped_dedupe_key = 'same-logical-operation'`,
    );
    expect(rows.rows).toHaveLength(4);
    expect(new Set(rows.rows.map((row) => row.dedupe_scope))).toHaveLength(4);
    expect(rows.rows.every((row) => row.dedupe_key === null)).toBe(true);
  });

  it("immediately tombstones sources when workspace connection access is removed", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    await exec.execute(
      "UPDATE creative_context_sources SET connection_id = 'connection-1' WHERE id = 'source-1'",
    );
    const result = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        store.handleWorkspaceConnectionLifecycle({
          type: "grant-revoked",
          connectionId: "connection-1",
          appId: "slides",
          ownerEmail: "alice@example.test",
          orgId: "org-1",
        }),
    );
    expect(result).toEqual({ sources: 1, jobs: 1 });
    const source = await exec.execute(
      "SELECT status, health_status FROM creative_context_sources WHERE id = 'source-1'",
    );
    expect(source.rows[0]).toMatchObject({
      status: "paused",
      health_status: "needs_setup",
    });
    const items = await exec.execute(
      "SELECT DISTINCT status, inventory_state FROM creative_context_items WHERE source_id = 'source-1'",
    );
    expect(items.rows).toEqual([
      expect.objectContaining({
        status: "unavailable",
        inventory_state: "removed",
      }),
    ]);
    const jobs = await exec.execute(
      "SELECT kind, source_id FROM creative_context_jobs",
    );
    expect(jobs.rows).toEqual([
      expect.objectContaining({ kind: "purge", source_id: "source-1" }),
    ]);
  });

  it("searches an immutable pack at its pinned historical item version", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    await exec.execute({
      sql: `INSERT INTO creative_context_packs
        (id, name, context_mode, request, created_at, owner_email, org_id, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "pack-v1",
        "Historical launch pack",
        "manual",
        "{}",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
        "private",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_pack_members
        (id, pack_id, item_id, item_version_id, ordinal, score_metadata,
         created_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "member-v1",
        "pack-v1",
        "allowed",
        "allowed-v1",
        0,
        "{}",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    const result = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        store.listAccessibleLexicalCandidates({
          query: "version 1",
          packId: "pack-v1",
          limit: 10,
        }),
    );
    expect(result.results).toEqual([
      expect.objectContaining({
        itemId: "allowed",
        itemVersionId: "allowed-v1",
        chunkId: "allowed-chunk-v1",
      }),
    ]);
  });

  it("limits pack replay bypasses to context-owned published snapshots", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const asBob = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "bob@example.test", orgId: "org-1" },
        fn,
      );

    await exec.execute({
      sql: `INSERT INTO creative_context_packs
        (id, name, context_mode, request, created_at, owner_email, org_id, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "unsafe-pack",
        "Unsafe library replay",
        "manual",
        "{}",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
        "private",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_pack_members
        (id, pack_id, item_id, item_version_id, ordinal, score_metadata,
         created_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "unsafe-member",
        "unsafe-pack",
        "allowed",
        "allowed-v1",
        0,
        "{}",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_pack_shares
        (id, resource_id, principal_type, principal_id, role, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "unsafe-pack-share",
        "unsafe-pack",
        "user",
        "bob@example.test",
        "viewer",
        "alice@example.test",
        "2026-07-16T00:00:00.000Z",
      ],
    });
    await exec.execute(
      "UPDATE creative_context_sources SET upstream_access = 'restricted' WHERE id = 'source-1'",
    );

    await expect(
      asBob(() => store.getCreativeContextItem("allowed", "allowed-v1")),
    ).resolves.toBeNull();
    await expect(
      asBob(() =>
        store.listAccessibleLexicalCandidates({
          query: "version 1",
          packId: "unsafe-pack",
          limit: 10,
        }),
      ),
    ).resolves.toEqual({ results: [], nextCursor: undefined });

    for (const source of [
      ["context-staging-source", "Context staging"],
      ["context-published-source", "Context published"],
    ]) {
      await exec.execute({
        sql: `INSERT INTO creative_context_sources
          (id, name, kind, config, upstream_access, status, health_status,
           item_count, restricted_item_count, owner_email, org_id, visibility,
           created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          source[0],
          source[1],
          "native-app",
          "{}",
          "available",
          "active",
          "healthy",
          1,
          0,
          "alice@example.test",
          "org-1",
          "private",
          "2026-07-16T00:00:00.000Z",
          "2026-07-16T00:00:00.000Z",
        ],
      });
    }
    await exec.execute({
      sql: `INSERT INTO creative_contexts
        (id, name, kind, staging_source_id, published_source_id, approval_policy,
         created_at, updated_at, owner_email, org_id, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "context-owned",
        "Governed context",
        "specialty",
        "context-staging-source",
        "context-published-source",
        "review",
        "2026-07-16T00:00:00.000Z",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
        "private",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_items
        (id, source_id, external_id, kind, title, current_version_id,
         current_content_hash, status, upstream_access, curation_status,
         curation_rank, inventory_state, index_state, tags, colors, provenance,
         metadata, created_at, updated_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "published-item",
        "context-published-source",
        "published-artifact",
        "slide",
        "Published evidence",
        "published-version",
        "published-hash",
        "active",
        "available",
        "included",
        "normal",
        "available",
        "pending",
        "[]",
        "[]",
        "{}",
        "{}",
        "2026-07-16T00:00:00.000Z",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_item_versions
        (id, item_id, version_number, content_hash, title, content, parse_status,
         metadata, created_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "published-version",
        "published-item",
        1,
        "published-hash",
        "Published evidence",
        "historical governed context evidence",
        "parsed",
        "{}",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_chunks
        (id, item_id, item_version_id, ordinal, kind, text, metadata,
         created_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "published-chunk",
        "published-item",
        "published-version",
        0,
        "text",
        "historical governed context evidence",
        "{}",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_memberships
        (id, context_id, artifact_key, published_item_id, published_item_version_id,
         rank, status, created_at, updated_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "removed-membership",
        "context-owned",
        "published-artifact",
        "published-item",
        "published-version",
        "normal",
        "removed",
        "2026-07-16T00:00:00.000Z",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_published_snapshots
        (id, context_id, source_id, membership_id, item_id, item_version_id,
         submission_id, created_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "published-snapshot",
        "context-owned",
        "context-published-source",
        "removed-membership",
        "published-item",
        "published-version",
        "approved-submission",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    const historicalPack = await asAlice(() =>
      store.createContextPack({
        name: "Historical governed replay",
        baseContextId: "context-owned",
        members: [
          { itemId: "published-item", itemVersionId: "published-version" },
        ],
      }),
    );
    await exec.execute({
      sql: `INSERT INTO creative_context_pack_shares
        (id, resource_id, principal_type, principal_id, role, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "historical-pack-share",
        historicalPack.id,
        "user",
        "bob@example.test",
        "viewer",
        "alice@example.test",
        "2026-07-16T00:00:00.000Z",
      ],
    });

    await expect(
      asBob(() => store.getContextPack(historicalPack.id)),
    ).resolves.toMatchObject({
      members: [
        expect.objectContaining({
          itemId: "published-item",
          itemVersionId: "published-version",
        }),
      ],
    });
    await expect(
      asBob(() =>
        store.getCreativeContextItem("published-item", "published-version"),
      ),
    ).resolves.toMatchObject({
      version: { id: "published-version" },
    });
    await expect(
      asBob(() =>
        store.listAccessibleLexicalCandidates({
          query: "historical governed",
          packId: historicalPack.id,
          limit: 10,
        }),
      ),
    ).resolves.toMatchObject({
      results: [
        expect.objectContaining({ itemVersionId: "published-version" }),
      ],
    });
  });

  it("legal purge follows provenance into staged and context-owned copies", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const context = await asAlice(() =>
      store.createCreativeContext({
        name: "Purge provenance",
        kind: "specialty",
        approvalPolicy: "open",
      }),
    );
    const submitted = await asAlice(() =>
      store.manageContextMembership({
        operation: "submit",
        contextId: context!.id,
        itemId: "allowed",
        confirmBroaderPublication: true,
      }),
    );
    const membership = (
      await asAlice(() =>
        store.listContextMemberships({ contextId: context!.id, limit: 10 }),
      )
    ).memberships[0]!;
    await asAlice(() =>
      store.createContextPack({
        name: "Published snapshot receipt",
        members: [
          {
            itemId: membership.publishedItemId!,
            itemVersionId: membership.publishedItemVersionId!,
          },
        ],
      }),
    );

    await expect(
      asAlice(() => store.purgeContextSourceArtifacts("source-1")),
    ).resolves.toMatchObject({ sourceId: "source-1" });

    const membershipRows = await exec.execute({
      sql: `SELECT status, published_item_id, published_item_version_id,
        pending_submission_id FROM creative_context_memberships WHERE id = ?`,
      args: [submitted.membershipId],
    });
    expect(membershipRows.rows[0]).toMatchObject({
      status: "removed",
      published_item_id: null,
      published_item_version_id: null,
      pending_submission_id: null,
    });
    for (const table of [
      "creative_context_submissions",
      "creative_context_published_snapshots",
    ]) {
      const rows = await exec.execute({
        sql: `SELECT id FROM ${table} WHERE context_id = ?`,
        args: [context!.id],
      });
      expect(rows.rows).toEqual([]);
    }
    const copiedItems = await exec.execute({
      sql: `SELECT id FROM creative_context_items
        WHERE id = ? OR source_id IN (
          SELECT staging_source_id FROM creative_contexts WHERE id = ?
          UNION
          SELECT published_source_id FROM creative_contexts WHERE id = ?
        )`,
      args: [membership.publishedItemId, context!.id, context!.id],
    });
    expect(copiedItems.rows).toEqual([]);
  });

  it("allows explicit deprecated search without making removed items retrievable", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    await exec.execute(
      "UPDATE creative_context_items SET status = 'deprecated' WHERE id = 'allowed'",
    );
    const search = (statuses: any[]) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        () =>
          store.listAccessibleLexicalCandidates({
            query: "canonical version 2",
            statuses,
            limit: 10,
          }),
      );
    await expect(search(["deprecated"])).resolves.toMatchObject({
      results: [expect.objectContaining({ itemId: "allowed" })],
    });
    await expect(search(["deleted"])).rejects.toThrow(
      "cannot include removed items",
    );
  });

  it("stops injecting published DNA immediately when its source is purged", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    await exec.execute({
      sql: `INSERT INTO creative_context_brand_profiles
        (id, name, current_dna_version_id, created_at, updated_at,
         owner_email, org_id, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "profile-1",
        "Brand",
        "dna-1",
        "2026-07-16T00:00:00.000Z",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
        "private",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_brand_dna_versions
        (id, profile_id, version_number, payload, content_hash, status,
         created_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "dna-1",
        "profile-1",
        1,
        '{"summary":"Imported brand","colors":["#112233"]}',
        "dna-hash",
        "published",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_brand_dna_evidence
        (id, dna_version_id, item_id, item_version_id, created_at,
         owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "evidence-1",
        "dna-1",
        "allowed",
        "allowed-v1",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });

    const result = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () => store.purgeContextSourceArtifacts("source-1"),
    );

    expect(result).toMatchObject({
      invalidatedBrandProfiles: 1,
      dnaRecomputeJobs: 0,
    });
    const profile = await exec.execute(
      "SELECT current_dna_version_id FROM creative_context_brand_profiles WHERE id = 'profile-1'",
    );
    expect(profile.rows[0]?.current_dna_version_id).toBeNull();
    const jobs = await exec.execute(
      "SELECT id FROM creative_context_jobs WHERE kind = 'brand-dna'",
    );
    expect(jobs.rows).toEqual([]);
  });

  it("publishes only the exact human-reviewed DNA proposal", async () => {
    const { runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const proposed = await asAlice(() =>
      store.saveBrandDnaCandidate({
        name: "Reviewed brand",
        status: "proposed",
        dna: { summary: "Warm and direct" },
        evidenceItemIds: ["allowed"],
      }),
    );
    await expect(
      asAlice(() =>
        store.publishBrandDna({
          profileId: proposed.profile.id,
          proposalVersionId: proposed.dna.id,
          confirmation: {
            proposalVersionId: proposed.dna.id,
            contentHash: "0".repeat(64),
          },
        }),
      ),
    ).rejects.toThrow("changed after review");
    await expect(
      asAlice(() =>
        store.publishBrandDna({
          profileId: proposed.profile.id,
          proposalVersionId: proposed.dna.id,
          confirmation: {
            proposalVersionId: proposed.dna.id,
            contentHash: proposed.dna.contentHash,
          },
        }),
      ),
    ).resolves.toMatchObject({
      profile: { currentDnaVersionId: proposed.dna.id },
      dna: { id: proposed.dna.id, status: "published" },
    });
  });

  it("executes every advertised enrichment worker idempotently", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const jobs = await import("../jobs/index.js");
    const dispatch = vi.fn(async () => {});
    const unregister =
      jobs.registerCreativeContextImportContinuationDispatcher(dispatch);
    await exec.execute(
      "UPDATE creative_context_items SET title = 'Primary brand logo', curation_rank = 'canonical' WHERE id = 'allowed'",
    );
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    const run = async (kind: any) => {
      const job = await asAlice(() =>
        store.createJob({
          sourceId: "source-1",
          kind,
          request: {},
        }),
      );
      return jobs.processCreativeContextBackgroundJob({
        jobId: job.id,
        ownerEmail: "alice@example.test",
        orgId: "org-1",
        appId: "slides",
        workerId: `worker:${kind}`,
      });
    };

    await run("canonical-logo");
    await run("canonical-logo");
    await run("layout-suggestion");
    const refresh = await run("metadata-refresh");

    const suggestions = await exec.execute(
      "SELECT kind, item_id, item_version_id FROM creative_context_suggestions ORDER BY kind",
    );
    expect(suggestions.rows).toEqual([
      expect.objectContaining({
        kind: "canonical-logo",
        item_id: "allowed",
        item_version_id: "allowed-v2",
      }),
      expect.objectContaining({
        kind: "layout-template",
        item_id: "allowed",
        item_version_id: "allowed-v2",
      }),
    ]);
    expect(refresh).toMatchObject({
      status: "completed",
      result: { importJobId: expect.any(String) },
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const importJobs = await exec.execute(
      "SELECT id FROM creative_context_jobs WHERE kind = 'import' AND scoped_dedupe_key IS NOT NULL",
    );
    expect(importJobs.rows).toHaveLength(1);
    unregister();
  });

  it("enforces review, source access, revocation, exact current versions, and org vectors", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asBob = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "bob@example.test", orgId: "org-1" },
        fn,
      );
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );

    await expect(
      asBob(() => store.listAccessibleSearchDocuments({ limit: 20 })),
    ).resolves.toEqual([]);
    await exec.execute({
      sql: `INSERT INTO creative_context_source_shares
        (id, resource_id, principal_type, principal_id, role, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "share-1",
        "source-1",
        "user",
        "bob@example.test",
        "viewer",
        "alice@example.test",
        "2026-07-16T00:00:00.000Z",
      ],
    });
    const initial = await asBob(() =>
      store.listAccessibleSearchDocuments({ limit: 20 }),
    );
    expect(initial.map((document) => document.itemId)).toEqual(["allowed"]);
    expect(initial[0]?.itemVersionId).toBe("allowed-v2");
    expect(initial[0]?.body).toContain("version 2");

    const privatePack = await asAlice(() =>
      store.createContextPack({
        name: "Private generation intent",
        members: [{ itemId: "allowed", itemVersionId: "allowed-v2" }],
      }),
    );
    await expect(
      asBob(() => store.getContextPack(privatePack.id)),
    ).resolves.toBeNull();
    await exec.execute({
      sql: `INSERT INTO creative_context_pack_shares
        (id, resource_id, principal_type, principal_id, role, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "pack-share-1",
        privatePack.id,
        "user",
        "bob@example.test",
        "viewer",
        "alice@example.test",
        "2026-07-16T00:00:00.000Z",
      ],
    });
    await expect(
      asBob(() => store.getContextPack(privatePack.id)),
    ).resolves.toMatchObject({
      id: privatePack.id,
      members: [
        expect.objectContaining({
          itemId: "allowed",
          itemVersionId: "allowed-v2",
        }),
      ],
    });

    await expect(
      asAlice(() =>
        store.createContextPack({
          name: "Bypass attempt",
          members: [{ itemId: "restricted" }],
        }),
      ),
    ).rejects.toThrow(/must be accessible/);

    await exec.execute(
      "UPDATE creative_context_items SET curation_status = 'included' WHERE id = 'restricted'",
    );
    const approved = await asBob(() =>
      store.listAccessibleSearchDocuments({ limit: 20 }),
    );
    expect(new Set(approved.map((document) => document.itemId))).toEqual(
      new Set(["allowed", "restricted"]),
    );

    await exec.execute(
      "UPDATE creative_context_sources SET upstream_access = 'restricted' WHERE id = 'source-1'",
    );
    await expect(
      asBob(() => store.listAccessibleSearchDocuments({ limit: 20 })),
    ).resolves.toEqual([]);
    await expect(
      asBob(() => store.getCreativeContextItem("allowed")),
    ).resolves.toBeNull();

    await exec.execute(
      "UPDATE creative_context_sources SET upstream_access = 'available' WHERE id = 'source-1'",
    );
    await exec.execute("DELETE FROM creative_context_source_shares");
    await expect(
      asBob(() => store.listAccessibleSearchDocuments({ limit: 20 })),
    ).resolves.toEqual([]);

    await exec.execute(
      "UPDATE creative_context_sources SET visibility = 'org' WHERE id = 'source-1'",
    );
    const set = await asAlice(() =>
      store.createEmbeddingSet({
        name: "Approved winner",
        provider: "test",
        family: "test:family",
        model: "test-model",
        version: "1",
        dimensions: 3,
      }),
    );
    await asAlice(() =>
      store.recordEmbeddingMetadata({
        embeddingSetId: set.id,
        itemId: "allowed",
        itemVersionId: "allowed-v2",
        chunkId: "allowed-chunk-v2",
        targetType: "chunk",
        targetId: "allowed-chunk-v2",
        vectorKey: "vector-allowed",
        dimensions: 3,
      }),
    );
    await expect(
      asBob(() => store.getActiveEmbeddingSet()),
    ).resolves.toMatchObject({ id: set.id });
    await expect(
      asBob(() =>
        store.listEmbeddingMetadata({
          embeddingSetId: set.id,
          itemVersionIds: ["allowed-v2"],
        }),
      ),
    ).resolves.toMatchObject([{ vectorKey: "vector-allowed" }]);
    await expect(
      asBob(() =>
        store.createEmbeddingSet({
          name: "Unauthorized rotation",
          provider: "test",
          family: "other",
          model: "other",
          version: "1",
          dimensions: 2,
        }),
      ),
    ).rejects.toThrow(/owners or admins/);
    await exec.execute(
      "UPDATE creative_context_sources SET upstream_access = 'restricted' WHERE id = 'source-1'",
    );
    await expect(
      asBob(() =>
        store.listEmbeddingMetadata({
          embeddingSetId: set.id,
          itemVersionIds: ["allowed-v2"],
        }),
      ),
    ).resolves.toEqual([]);
  });

  it("revokes newly restricted unchanged items but preserves explicit approvals across resync", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        fn,
      );
    await exec.execute(
      "UPDATE creative_context_items SET curation_status = 'included' WHERE id = 'restricted'",
    );
    const base = {
      externalId: "restricted",
      kind: "slide",
      title: "restricted title",
      content: "restricted canonical version 2",
      contentHash: "restricted-hash-v2",
      upstreamAccess: "restricted" as const,
      curationStatus: "review" as const,
    };
    await asAlice(() =>
      store.ingestItems({ sourceId: "source-1", items: [base] }),
    );
    let row = await exec.execute(
      "SELECT curation_status FROM creative_context_items WHERE id = 'restricted'",
    );
    expect(row.rows[0]?.curation_status).toBe("included");

    await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            ...base,
            content: "restricted canonical version 3",
            contentHash: "restricted-hash-v3",
          },
        ],
      }),
    );
    row = await exec.execute(
      "SELECT curation_status FROM creative_context_items WHERE id = 'restricted'",
    );
    expect(row.rows[0]?.curation_status).toBe("included");

    await exec.execute(
      "UPDATE creative_context_items SET upstream_access = 'available', curation_status = 'included' WHERE id = 'allowed'",
    );
    await asAlice(() =>
      store.ingestItems({
        sourceId: "source-1",
        items: [
          {
            externalId: "allowed",
            kind: "slide",
            title: "allowed title",
            content: "allowed canonical version 2",
            contentHash: "allowed-hash-v2",
            upstreamAccess: "restricted",
            curationStatus: "review",
          },
        ],
      }),
    );
    row = await exec.execute(
      "SELECT upstream_access, curation_status FROM creative_context_items WHERE id = 'allowed'",
    );
    expect(row.rows[0]).toMatchObject({
      upstream_access: "restricted",
      curation_status: "review",
    });
  });

  it("purges dependent references and invalidates affected published DNA", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    const statements: Array<{ sql: string; args: unknown[] }> = [
      {
        sql: `INSERT INTO creative_context_packs
          (id, name, context_mode, request, created_at, owner_email, org_id, visibility)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "pack-purge",
          "Purge pack",
          "manual",
          "{}",
          "2026-07-16T00:00:00.000Z",
          "alice@example.test",
          "org-1",
          "private",
        ],
      },
      {
        sql: `INSERT INTO creative_context_pack_members
          (id, pack_id, item_id, item_version_id, ordinal, score_metadata,
           created_at, owner_email, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "member-purge",
          "pack-purge",
          "allowed",
          "allowed-v2",
          0,
          "{}",
          "2026-07-16T00:00:00.000Z",
          "alice@example.test",
          "org-1",
        ],
      },
      {
        sql: `INSERT INTO creative_context_brand_profiles
          (id, name, current_dna_version_id, created_at, updated_at,
           owner_email, org_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "profile-purge",
          "Purge profile",
          "dna-purge",
          "2026-07-16T00:00:00.000Z",
          "2026-07-16T00:00:00.000Z",
          "alice@example.test",
          "org-1",
          "private",
        ],
      },
      {
        sql: `INSERT INTO creative_context_brand_dna_versions
          (id, profile_id, version_number, payload, content_hash, status,
           created_at, owner_email, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "dna-purge",
          "profile-purge",
          1,
          "{}",
          "dna-hash",
          "published",
          "2026-07-16T00:00:00.000Z",
          "alice@example.test",
          "org-1",
        ],
      },
      {
        sql: `INSERT INTO creative_context_brand_dna_evidence
          (id, dna_version_id, item_id, item_version_id, created_at,
           owner_email, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "evidence-purge",
          "dna-purge",
          "allowed",
          "allowed-v2",
          "2026-07-16T00:00:00.000Z",
          "alice@example.test",
          "org-1",
        ],
      },
      {
        sql: `INSERT INTO creative_context_edges
          (id, from_item_id, from_item_version_id, to_item_id,
           to_item_version_id, relation, metadata, created_at, owner_email, org_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "edge-to-purge",
          "outside-item",
          "outside-version",
          "allowed",
          "allowed-v2",
          "derived-from",
          "{}",
          "2026-07-16T00:00:00.000Z",
          "alice@example.test",
          "org-1",
        ],
      },
      {
        sql: `INSERT INTO creative_context_suggestions
          (id, kind, status, item_id, item_version_id, payload, created_at,
           updated_at, owner_email, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "suggestion-purge",
          "layout-template",
          "promoted",
          "allowed",
          "allowed-v2",
          '{"projectionItemId":"outside-item"}',
          "2026-07-16T00:00:00.000Z",
          "2026-07-16T00:00:00.000Z",
          "alice@example.test",
          "org-1",
        ],
      },
      {
        sql: `INSERT INTO creative_context_generation_records
          (id, app_id, artifact_type, artifact_id, context_mode,
           context_pack_id, element_provenance, created_at, owner_email, org_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "generation-purge",
          "slides",
          "deck",
          "deck-1",
          "pinned",
          "pack-purge",
          '[{"elementId":"title","itemId":"allowed","itemVersionId":"allowed-v2","influence":"adapted","label":"Brand title"}]',
          "2026-07-16T00:00:00.000Z",
          "alice@example.test",
          "org-1",
        ],
      },
    ];
    for (const statement of statements) await exec.execute(statement);

    const result = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () => store.purgeContextSourceArtifacts("source-1"),
    );
    expect(result).toMatchObject({
      purgedItems: 2,
      demotedLayouts: 1,
      invalidatedBrandProfiles: 1,
      dnaRecomputeJobs: 0,
    });
    for (const table of [
      "creative_context_pack_members",
      "creative_context_brand_dna_evidence",
      "creative_context_edges",
      "creative_context_suggestions",
      "creative_context_items",
    ]) {
      const rows = await exec.execute(`SELECT id FROM ${table}`);
      expect(rows.rows, table).toHaveLength(0);
    }
    const generation = await exec.execute(
      "SELECT element_provenance FROM creative_context_generation_records WHERE id = 'generation-purge'",
    );
    expect(JSON.parse(String(generation.rows[0]?.element_provenance))).toEqual([
      expect.objectContaining({
        elementId: "title",
        referenceUnavailable: true,
      }),
    ]);
    expect(String(generation.rows[0]?.element_provenance)).not.toContain(
      "allowed-v2",
    );
    const pack = await exec.execute(
      "SELECT archived_at FROM creative_context_packs WHERE id = 'pack-purge'",
    );
    expect(pack.rows[0]?.archived_at).toEqual(expect.any(String));
    const jobs = await exec.execute(
      "SELECT kind FROM creative_context_jobs WHERE kind = 'brand-dna'",
    );
    expect(jobs.rows).toEqual([]);
    const profile = await exec.execute(
      "SELECT current_dna_version_id FROM creative_context_brand_profiles WHERE id = 'profile-purge'",
    );
    expect(profile.rows[0]?.current_dna_version_id).toBeNull();
  });

  it("scans beyond early rows and preserves exact lexical mode semantics", async () => {
    const { exec, runWithRequestContext, store } = await setup();
    await exec.execute({
      sql: `INSERT INTO creative_context_items
        (id, source_id, external_id, kind, title, current_version_id,
         current_content_hash, status, upstream_access, curation_status,
         curation_rank, inventory_state, index_state, tags, colors, provenance,
         metadata, created_at, updated_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "tagged-late",
        "source-1",
        "tagged-late",
        "slide",
        "Tagged late",
        "tagged-late-v1",
        "tagged-late-hash",
        "active",
        "available",
        "included",
        "normal",
        "available",
        "indexed",
        '["late-tag"]',
        '["#123456"]',
        "{}",
        "{}",
        "2026-07-16T00:00:00.000Z",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_item_versions
        (id, item_id, version_number, content_hash, title, content,
         parse_status, metadata, created_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "tagged-late-v1",
        "tagged-late",
        1,
        "tagged-late-hash",
        "Tagged late",
        "late filtered content",
        "parsed",
        "{}",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    const values: string[] = [];
    const args: unknown[] = [];
    const addChunk = (id: string, ordinal: number, text: string) => {
      values.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      args.push(
        id,
        "allowed",
        "allowed-v2",
        ordinal,
        "text",
        text,
        "{}",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      );
    };
    for (let index = 1; index <= 1_005; index += 1) {
      addChunk(
        `a-irrelevant-${String(index).padStart(4, "0")}`,
        index,
        "irrelevant corpus row",
      );
    }
    addChunk("x-separated", 1_006, "needle middle alpha");
    addChunk("y-decoy", 1_007, "alpha only");
    addChunk("z-later-match", 1_008, "needle alpha literal 100%_match");
    values.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    args.push(
      "zz-tagged-late",
      "tagged-late",
      "tagged-late-v1",
      0,
      "text",
      "late filtered content",
      "{}",
      "2026-07-16T00:00:00.000Z",
      "alice@example.test",
      "org-1",
    );
    await exec.execute({
      sql: `INSERT INTO creative_context_chunks
        (id, item_id, item_version_id, ordinal, kind, text, metadata,
         created_at, owner_email, org_id) VALUES ${values.join(",")}`,
      args,
    });
    const search = (query: string, matchMode: any) =>
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        () =>
          store.listAccessibleLexicalCandidates({
            query,
            matchMode,
            limit: 20,
          }),
      );
    const allTerms = await search("needle alpha", "allTerms");
    expect(allTerms.results.map((result) => result.chunkId)).toEqual(
      expect.arrayContaining(["x-separated", "z-later-match"]),
    );
    expect(allTerms.results.map((result) => result.chunkId)).not.toContain(
      "y-decoy",
    );
    const anyTerm = await search("needle alpha", "anyTerm");
    expect(anyTerm.results.map((result) => result.chunkId)).toContain(
      "y-decoy",
    );
    const phrase = await search("needle alpha", "phrase");
    expect(phrase.results.map((result) => result.chunkId)).toContain(
      "z-later-match",
    );
    expect(phrase.results.map((result) => result.chunkId)).not.toContain(
      "x-separated",
    );
    const regex = await search("needle\\s+alpha", "regex");
    expect(regex.results.map((result) => result.chunkId)).toContain(
      "z-later-match",
    );
    const escaped = await search("100%_match", "phrase");
    expect(escaped.results.map((result) => result.chunkId)).toEqual([
      "z-later-match",
    ]);
    const filtered = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        store.listAccessibleSearchDocuments({
          tags: ["late-tag"],
          colors: ["#123456"],
          limit: 1,
        }),
    );
    expect(filtered.map((document) => document.itemId)).toEqual([
      "tagged-late",
    ]);

    await exec.execute({
      sql: `INSERT INTO creative_context_embedding_sets
        (id, name, provider, family, model, version, dimensions, metric,
         status, metadata, created_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "set-late",
        "Late vector set",
        "test",
        "test-family",
        "test-model",
        "v1",
        2,
        "cosine",
        "active",
        "{}",
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    await exec.execute({
      sql: `INSERT INTO creative_context_embeddings
        (id, embedding_set_id, family, model, version, item_id,
         item_version_id, target_type, target_id, vector_key, dimensions,
         created_at, owner_email, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "embedding-late",
        "set-late",
        "test-family",
        "test-model",
        "v1",
        "tagged-late",
        "tagged-late-v1",
        "item",
        "tagged-late-v1",
        "vector-late",
        2,
        "2026-07-16T00:00:00.000Z",
        "alice@example.test",
        "org-1",
      ],
    });
    const vectorCandidates = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        store.listEmbeddingMetadata({
          embeddingSetId: "set-late",
          tags: ["late-tag"],
        }),
    );
    expect(vectorCandidates.map((candidate) => candidate.vectorKey)).toEqual([
      "vector-late",
    ]);
  });
});
