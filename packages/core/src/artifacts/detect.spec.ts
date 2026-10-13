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
