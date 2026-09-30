import { createHash } from "node:crypto";

import { sanitizeIconSvg } from "@agent-native/core/icon-assets";
import { describe, expect, it, vi } from "vitest";

import {
  fetchBoundedBuilderImage,
  verifyBuilderSpaceAssetUrl,
} from "./historical-icon-builder";
import { listCurrentScalarIconReferences } from "./historical-icon-cli";
import {
  migrateHistoricalIconUrls,
  findLiveCalloutIconOccurrences,
  nextCalloutContentRaw,
  normalizedBuilderAssetUrl,
  type IconReference,
  type RehostDependencies,
  type RehostReceipt,
} from "./migrate-historical-icon-urls";

const url = "https://cdn.builder.io/api/v1/image/assets%2Fexample%2Ficon";
const raw = JSON.stringify({
  version: 1,
  kind: "image",
  authority: "url",
  assetId: url,
  alt: "Logo",
});
const reference: IconReference = {
  table: "documents",
  rowId: "d1",
  path: "icon",
  raw,
  ownerEmail: "owner@example.com",
  orgId: "org-example",
};
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const hash = createHash("sha256").update(bytes).digest("hex");

function dependencies(): RehostDependencies & {
  replaceIfUnchanged: ReturnType<typeof vi.fn>;
  uploadPrivate: ReturnType<typeof vi.fn>;
} {
  const receipts = new Map<string, RehostReceipt>();
  return {
    listReferences: async () => [reference],
    verifyBuilderOwnership: async () => "owned",
    fetchImage: async () => ({ data: bytes, mimeType: "image/png" }),
    uploadPrivate: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      sha256: hash,
    })),
    readPrivate: async () => ({ data: bytes, sha256: hash }),
    readReceipt: async (fingerprint) => receipts.get(fingerprint) ?? null,
    saveReceipt: async (receipt) => {
      receipts.set(receipt.sourceFingerprint, receipt);
    },
    replaceIfUnchanged: vi.fn(async () => true),
  };
}

describe("historical icon rehost", () => {
  it("normalizes only canonical Builder asset URLs", () => {
    expect(normalizedBuilderAssetUrl(url)).toBe(url);
    expect(normalizedBuilderAssetUrl(`${url}?width=32#fragment`)).toBeNull();
    expect(
      normalizedBuilderAssetUrl(
        "https://cdn.builder.io.example/api/v1/image/a",
      ),
    ).toBeNull();
    expect(
      normalizedBuilderAssetUrl("https://cdn.builder.io/other/a"),
    ).toBeNull();
  });

  it("defaults to dry-run and never uploads or writes", async () => {
    const deps = dependencies();
    const report = await migrateHistoricalIconUrls(deps);
    expect(report).toMatchObject({
      dryRun: true,
      scanned: 1,
      candidates: 1,
      ownershipVerified: 1,
      migrated: 0,
      providerRevocationEligible: false,
    });
    expect(deps.uploadPrivate).not.toHaveBeenCalled();
    expect(deps.replaceIfUnchanged).not.toHaveBeenCalled();
  });

  it("leaves unrelated external image icons outside the Builder migration", async () => {
    const deps = dependencies();
    deps.listReferences = async () => [
      {
        ...reference,
        raw: JSON.stringify({
          version: 1,
          kind: "image",
          authority: "url",
          assetId: "https://example.org/logo.png",
        }),
      },
    ];
    deps.verifyBuilderOwnership = vi.fn(async () => "owned" as const);
    const report = await migrateHistoricalIconUrls(deps);
    expect(report).toMatchObject({
      external: 1,
      candidates: 0,
      migrated: 0,
      ambiguous: [],
      deferred: [],
    });
    expect(deps.verifyBuilderOwnership).not.toHaveBeenCalled();
  });

  it("defers transformed Builder URLs before ownership, download, or write", async () => {
    const deps = dependencies();
    deps.listReferences = async () => [
      {
        ...reference,
        raw: JSON.stringify({
          version: 1,
          kind: "image",
          authority: "url",
          assetId: `${url}?width=32`,
        }),
      },
    ];
    deps.verifyBuilderOwnership = vi.fn(async () => "owned" as const);
    deps.fetchImage = vi.fn(async () => ({
      data: bytes,
      mimeType: "image/png",
    }));
    const report = await migrateHistoricalIconUrls(deps, { apply: true });
    expect(report).toMatchObject({
      candidates: 1,
      ownershipVerified: 0,
      migrated: 0,
    });
    expect(report.deferred[0].reason).toContain("rendered variant");
    expect(deps.verifyBuilderOwnership).not.toHaveBeenCalled();
    expect(deps.fetchImage).not.toHaveBeenCalled();
    expect(deps.uploadPrivate).not.toHaveBeenCalled();
    expect(deps.replaceIfUnchanged).not.toHaveBeenCalled();
  });

  it("verifies readback, saves a receipt, and CAS-replaces without losing alt text", async () => {
    const deps = dependencies();
    const report = await migrateHistoricalIconUrls(deps, { apply: true });
    expect(report.migrated).toBe(1);
    const next = JSON.parse(deps.replaceIfUnchanged.mock.calls[0][1]);
    expect(next).toMatchObject({
      authority: "private-icon",
      assetId: "00000000-0000-4000-8000-000000000001",
      alt: "Logo",
    });
    await migrateHistoricalIconUrls(deps, { apply: true });
    expect(deps.uploadPrivate).toHaveBeenCalledTimes(1);
  });

  it("defers a stale CAS and a failed readback", async () => {
    const stale = dependencies();
    stale.replaceIfUnchanged.mockResolvedValue(false);
    expect(
      (await migrateHistoricalIconUrls(stale, { apply: true })).deferred[0]
        .reason,
    ).toContain("compare-and-swap");
    const unreadable = dependencies();
    unreadable.readPrivate = async () => null;
    const report = await migrateHistoricalIconUrls(unreadable, { apply: true });
    expect(report.migrated).toBe(0);
    expect(unreadable.replaceIfUnchanged).not.toHaveBeenCalled();
  });

  it("rejects internally consistent upload bytes that differ from the fetched source", async () => {
    const deps = dependencies();
    const wrong = Uint8Array.of(1, 2, 3);
    const wrongHash = createHash("sha256").update(wrong).digest("hex");
    deps.uploadPrivate.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      sha256: wrongHash,
    });
    deps.readPrivate = async () => ({ data: wrong, sha256: wrongHash });
    deps.saveReceipt = vi.fn();
    const report = await migrateHistoricalIconUrls(deps, { apply: true });
    expect(report.deferred[0].reason).toBe(
      "private image does not match fetched source",
    );
    expect(deps.saveReceipt).not.toHaveBeenCalled();
    expect(deps.replaceIfUnchanged).not.toHaveBeenCalled();
  });

  it("rejects changed readback bytes even when the upload and readback metadata match the source", async () => {
    const deps = dependencies();
    deps.readPrivate = async () => ({
      data: Uint8Array.of(1, 2, 3),
      sha256: hash,
    });
    const report = await migrateHistoricalIconUrls(deps, { apply: true });
    expect(report.deferred[0].reason).toBe(
      "private image readback failed integrity check",
    );
    expect(deps.replaceIfUnchanged).not.toHaveBeenCalled();
  });

  it("revalidates legacy receipts against the fetched raw source and expected private bytes", async () => {
    for (const corrupt of ["sourceSha256", "privateSha256"] as const) {
      const deps = dependencies();
      deps.readReceipt = async (sourceFingerprint, ownerEmail, orgId) => ({
        sourceFingerprint,
        ownerEmail,
        orgId,
        sourceSha256: hash,
        privateSha256: hash,
        privateAssetId: "00000000-0000-4000-8000-000000000001",
        [corrupt]: "old-unbound-hash",
      });
      const report = await migrateHistoricalIconUrls(deps, { apply: true });
      expect(report.deferred[0].reason).toBe(
        "private receipt does not match fetched source",
      );
      expect(deps.uploadPrivate).not.toHaveBeenCalled();
      expect(deps.replaceIfUnchanged).not.toHaveBeenCalled();
    }
  });

  it("binds valid SVG readback to canonical sanitization without requiring unchanged raw bytes", async () => {
    const deps = dependencies();
    const data = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" /></svg>',
    );
    const normalized = sanitizeIconSvg(data);
    const normalizedHash = createHash("sha256")
      .update(normalized)
      .digest("hex");
    const rawHash = createHash("sha256").update(data).digest("hex");
    expect(rawHash).not.toBe(normalizedHash);
    deps.fetchImage = async () => ({ data, mimeType: "image/svg+xml" });
    deps.uploadPrivate.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      sha256: normalizedHash,
    });
    deps.readPrivate = async () => ({
      data: normalized,
      sha256: normalizedHash,
    });
    const save = deps.saveReceipt;
    deps.saveReceipt = vi.fn(save);
    expect(
      (await migrateHistoricalIconUrls(deps, { apply: true })).migrated,
    ).toBe(1);
    expect(deps.saveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSha256: rawHash,
        privateSha256: normalizedHash,
      }),
    );
    expect(
      (await migrateHistoricalIconUrls(deps, { apply: true })).migrated,
    ).toBe(1);
    expect(deps.uploadPrivate).toHaveBeenCalledTimes(1);
  });

  it("locates exact live callouts while excluding code fences and inline lookalikes", () => {
    expect(
      findLiveCalloutIconOccurrences('<callout icon="">\n\tPlain\n</callout>'),
    ).toEqual([]);
    const tag = `<callout icon="${raw.replace(/"/g, "&quot;")}">`;
    const body = `${tag}\n\tOne\n\t${tag}\n\t\tNested\n\t</callout>\n</callout>`;
    const content = `\`\`\`md\n${body}\n\`\`\`\n${body}\nInline ${tag}\n`;
    const occurrences = findLiveCalloutIconOccurrences(content);
    expect(occurrences.map((item) => item.raw)).toEqual([raw, raw]);
    expect(occurrences[0].start).toBeGreaterThan(content.indexOf("```", 3));
    const changed = nextCalloutContentRaw(
      {
        ...reference,
        path: "content.callouts[1].icon",
        contentRaw: content,
        calloutIndex: 1,
      },
      '"replacement"',
    );
    expect(changed).toBe(
      content.slice(0, occurrences[1].start) +
        "&quot;replacement&quot;" +
        content.slice(occurrences[1].end),
    );
  });

  it("requires an exact authenticated Space asset match", async () => {
    const fetcher = vi.fn(async (_request: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer example-key",
      );
      expect(JSON.parse(String(init.body)).variables.input.query.url.$eq).toBe(
        url,
      );
      return Response.json({ data: { assets: [{ id: "owned-asset", url }] } });
    });
    expect(
      await verifyBuilderSpaceAssetUrl(
        url,
        { source: "legacy", authorization: "Bearer example-key" },
        fetcher,
      ),
    ).toBe("owned");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      verifyBuilderSpaceAssetUrl(
        url,
        { source: "oauth", authorization: "Bearer example-oauth" },
        fetcher,
      ),
    ).rejects.toThrow("Space private key");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      await verifyBuilderSpaceAssetUrl(
        url,
        { source: "legacy", authorization: "Bearer example-key" },
        async () =>
          Response.json({
            data: {
              assets: [
                {
                  id: "other",
                  url: "https://cdn.builder.io/api/v1/image/other",
                },
              ],
            },
          }),
      ),
    ).toBe("ambiguous");
  });

  it("rejects an oversized body even when content length is absent", async () => {
    await expect(
      fetchBoundedBuilderImage(
        url,
        async () =>
          new Response(new Uint8Array(5 * 1024 * 1024 + 1), {
            headers: { "content-type": "image/png" },
          }),
      ),
    ).rejects.toThrow("5 MiB");
  });

  it("scans only the selected owner and retains the view CAS source", async () => {
    const config = JSON.stringify({
      views: [{ id: "view-1", icon: JSON.parse(raw), name: "Table" }],
    });
    const query = vi.fn(async (sql: string, args: unknown[]) => {
      expect(args.slice(0, 2)).toEqual(["owner@example.com", "org-example"]);
      if (sql.includes("FROM documents "))
        return [{ id: "d1", icon: raw, content: "" }];
      if (sql.includes("FROM document_property_definitions ")) return [];
      if (sql.includes("FROM content_databases "))
        return [{ id: "db1", view_config_json: config }];
      throw new Error("Unexpected query");
    });
    const rows = await listCurrentScalarIconReferences(query, {
      ownerEmail: "owner@example.com",
      orgId: "org-example",
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      table: "content_databases",
      rowId: "db1",
      path: "views[0].icon",
      viewId: "view-1",
      viewConfigRaw: config,
    });
  });

  it("includes every live callout occurrence and fails closed on unreadable bodies", async () => {
    const callout = `<callout icon="${raw.replace(/"/g, "&quot;")}">\n\tBody\n</callout>`;
    const content = `\`\`\`md\n${callout}\n\`\`\`\n${callout}\n${callout}`;
    const rows = await listCurrentScalarIconReferences(
      async (sql) =>
        sql.includes("FROM documents ")
          ? [{ id: "d1", icon: null, content }]
          : [],
      { ownerEmail: reference.ownerEmail, orgId: reference.orgId },
    );
    expect(rows).toEqual(
      [0, 1].map((calloutIndex) => ({
        ...reference,
        path: `content.callouts[${calloutIndex}].icon`,
        calloutIndex,
        contentRaw: content,
      })),
    );
    await expect(
      listCurrentScalarIconReferences(
        async (sql) =>
          sql.includes("FROM documents ")
            ? [{ id: "d1", icon: null, content: null }]
            : [],
        { ownerEmail: reference.ownerEmail, orgId: reference.orgId },
      ),
    ).rejects.toThrow("scan is incomplete");
  });
});
