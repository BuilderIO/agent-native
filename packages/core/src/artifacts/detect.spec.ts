import { describe, expect, it } from "vitest";

import { detectArtifactReceipts, parseArtifactReferenceUrl } from "./detect.js";

describe("detectArtifactReceipts", () => {
  it.each([
    [
      "document",
      "create-document",
      { id: "doc_1", title: "Brief", url: "/page/doc_1" },
      { kind: "document", id: "doc_1", title: "Brief", url: "/page/doc_1" },
    ],
    [
      "deck",
      "create-deck",
      { id: "deck_1", url: "/deck/deck_1" },
      { kind: "deck", id: "deck_1", url: "/deck/deck_1" },
    ],
    [
      "dashboard",
      "update-dashboard",
      { id: "dash_1", name: "Funnel", url: "/adhoc/dash_1" },
      {
        kind: "dashboard",
        id: "dash_1",
        title: "Funnel",
        url: "/adhoc/dash_1",
      },
    ],
    [
      "analysis",
      "save-analysis",
      { id: "analysis_1", name: "Pipeline", url: "/analyses/analysis_1" },
      {
        kind: "analysis",
        id: "analysis_1",
        title: "Pipeline",
        url: "/analyses/analysis_1",
      },
    ],
    [
      "image",
      "generate-asset",
      {
        id: "asset_1",
        artifactType: "image",
        url: "/asset/asset_1",
        runId: "run_1",
      },
      { kind: "image", id: "asset_1", url: "/asset/asset_1", runId: "run_1" },
    ],
    [
      "design",
      "generate-design",
      { designId: "design_1", fileCount: 2, url: "/design/design_1" },
      {
        kind: "design",
        id: "design_1",
        url: "/design/design_1",
        fileCount: 2,
      },
    ],
    [
      "monitor",
      "save-monitor",
      {
        id: "monitor_1",
        name: "Uptime",
        monitorAppUrl: "/monitoring?monitor=monitor_1",
      },
      {
        kind: "monitor",
        id: "monitor_1",
        title: "Uptime",
        url: "/monitoring?monitor=monitor_1",
      },
    ],
    [
      "form",
      "create-form",
      {
        id: "form_1",
        title: "Feedback",
        status: "published",
        publicUrl: "/f/feedback",
      },
      { kind: "form", id: "form_1", title: "Feedback", url: "/f/feedback" },
    ],
  ])("detects a %s receipt", (_kind, tool, result, expected) => {
    expect(detectArtifactReceipts(result, tool)).toContainEqual(expected);
  });

  it("detects the row an add-database-item receipt created", () => {
    expect(
      detectArtifactReceipts(
        {
          receipt: {
            receiptId: "receipt-create-1",
            operation: "create",
            outcome: "created",
            target: {
              databaseId: "design-asks-db",
              databaseDocumentId: "design-asks-db-document",
            },
            row: {
              itemId: "item_789",
              documentId: "row_doc_789",
              urlPath: "/page/row_doc_789",
              rowRevision: "row-after",
            },
            readback: { verified: true, title: "Homepage refresh" },
          },
          createdItem: {
            id: "item_789",
            databaseId: "design-asks-db",
            document: { id: "row_doc_789", title: "Homepage refresh" },
          },
        },
        "add-database-item",
      ),
    ).toEqual([
      {
        kind: "document",
        id: "row_doc_789",
        title: "Homepage refresh",
        url: "/page/row_doc_789",
      },
    ]);
  });

  it.each([
    [
      "its target and row link",
      "upsert-database-item-by-key",
      {
        receipt: {
          target: { rowDocumentId: "row_doc_1" },
          rowLink: { urlPath: "/page/row_doc_1?db=db_1" },
        },
      },
      [{ kind: "document", id: "row_doc_1", url: "/page/row_doc_1?db=db_1" }],
    ],
    [
      "a row with no link or read-back",
      "add-database-item",
      { receipt: { row: { documentId: "row_doc_2" } } },
      [{ kind: "document", id: "row_doc_2" }],
    ],
    [
      "a row whose read-back is another page",
      "add-database-item",
      {
        receipt: { row: { documentId: "row_doc_3" } },
        createdItem: { document: { id: "other_doc", title: "Other page" } },
      },
      [{ kind: "document", id: "row_doc_3" }],
    ],
    [
      "the older created-page fields",
      "add-database-item",
      { createdDocumentId: "doc_4", createdDocumentTitle: "Intake" },
      [{ kind: "document", id: "doc_4", title: "Intake" }],
    ],
    [
      "a row link naming another page",
      "add-database-item",
      {
        receipt: {
          row: { documentId: "row_doc_6", urlPath: "/page/other_doc" },
          rowLink: { urlPath: "/page/row_doc_6?db=db_1" },
        },
      },
      [{ kind: "document", id: "row_doc_6", url: "/page/row_doc_6?db=db_1" }],
    ],
    [
      "receipt and result links that name another page",
      "upsert-database-item-by-key",
      {
        receipt: { row: { documentId: "row_doc_7", urlPath: "/page/other" } },
        url: "/page/other_doc",
      },
      [{ kind: "document", id: "row_doc_7" }],
    ],
    [
      "a row link to another kind of page",
      "add-database-item",
      {
        receipt: {
          row: { documentId: "row_doc_9", urlPath: "/deck/row_doc_9" },
        },
      },
      [{ kind: "document", id: "row_doc_9" }],
    ],
    [
      "a result link naming the row",
      "add-database-item",
      { receipt: { row: { documentId: "row_doc_8" } }, url: "/page/row_doc_8" },
      [{ kind: "document", id: "row_doc_8", url: "/page/row_doc_8" }],
    ],
    ["no receipt", "add-database-item", { createdItem: { id: "item_5" } }, []],
    ["a receipt with no row", "add-database-item", { receipt: {} }, []],
  ])("reads a database row from %s", (_case, tool, result, expected) => {
    expect(detectArtifactReceipts(result, tool)).toEqual(expected);
  });

  it("fans out successful image batch slots and rejects mismatched URLs", () => {
    expect(
      detectArtifactReceipts(
        {
          images: [
            {
              ok: true,
              id: "asset_ok",
              artifactType: "image",
              url: "/asset/asset_ok",
            },
            {
              ok: false,
              id: "asset_failed",
              artifactType: "image",
              url: "/asset/asset_failed",
            },
            {
              ok: true,
              id: "asset_mismatch",
              artifactType: "image",
              url: "/asset/another_asset",
            },
          ],
        },
        "generate-image-batch",
      ),
    ).toEqual([
      {
        kind: "image",
        id: "asset_ok",
        url: "/asset/asset_ok",
      },
    ]);
  });

  it("recognizes legacy plural Assets detail URLs", () => {
    expect(parseArtifactReferenceUrl("/assets/asset_legacy")).toEqual({
      kind: "image",
      id: "asset_legacy",
    });
    expect(
      detectArtifactReceipts(
        { id: "asset_legacy", pageUrl: "/assets/asset_legacy" },
        "generate-asset",
      ),
    ).toEqual([
      {
        kind: "image",
        id: "asset_legacy",
        url: "/assets/asset_legacy",
      },
    ]);
  });

  it("does not classify Assets API collection routes as artifacts", () => {
    expect(parseArtifactReferenceUrl("/api/assets/search")).toBeNull();
    expect(parseArtifactReferenceUrl("/api/assets/list")).toBeNull();
  });

  it("does not retain off-origin document URLs from read actions", () => {
    expect(
      detectArtifactReceipts(
        {
          id: "doc_generic",
          url: "https://attacker.example/page/doc_generic",
        },
        "read-workspace-document",
      ),
    ).toEqual([]);
    expect(
      detectArtifactReceipts(
        {
          id: "doc_known",
          url: "https://attacker.example/page/doc_known",
        },
        "get-document",
      ),
    ).toEqual([{ kind: "document", id: "doc_known" }]);
  });

  it("retains real design file counts and distinguishes empty shells", () => {
    expect(
      detectArtifactReceipts(
        { designId: "design_ready", fileCount: 2 },
        "generate-design",
      ),
    ).toEqual([{ kind: "design", id: "design_ready", fileCount: 2 }]);
    expect(
      detectArtifactReceipts(
        { id: "design_shell", title: "Draft" },
        "create-design",
      ),
    ).toEqual([{ kind: "design", id: "design_shell", title: "Draft" }]);
  });
});
