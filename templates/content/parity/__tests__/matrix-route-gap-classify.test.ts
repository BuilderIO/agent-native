import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parityMatrix } from "../matrix";

const scannedFiles = [
  "app/hooks/use-notion.ts",
  "app/components/editor/DocumentToolbar.tsx",
  "app/components/editor/NotionSyncBar.tsx",
  "app/components/editor/DocumentEditor.tsx",
];

const documentSyncRoutePattern =
  /\/api\/notion\/(?:status|disconnect|search)|\/api\/documents\/\$\{documentId\}\/notion\/(?:refresh|link|unlink|pull|push|resolve|create-and-link)/g;

function readContentFile(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("Content parity matrix Notion route-backed gaps", () => {
  it("keeps Notion document sync UI off direct app routes", () => {
    const detected = new Set<string>();
    for (const file of scannedFiles) {
      const source = readContentFile(file);
      for (const match of source.matchAll(documentSyncRoutePattern)) {
        detected.add(match[0]);
      }
    }

    expect([...detected].sort()).toEqual([]);
  });

  it("keeps Notion OAuth routes as the only documented route-shaped exception", () => {
    const routeBackedRows = parityMatrix.filter(
      (row) => row.status === "route-backed-gap",
    );
    const notionRow = parityMatrix.find(
      (row) => row.id === "notion.route-backed-document-sync",
    );

    expect(routeBackedRows.map((row) => row.id)).toEqual([]);
    expect(notionRow?.status).toBe("action-backed");
    expect(notionRow?.routePatterns).toEqual([
      "/api/notion/auth-url",
      "/api/notion/callback",
    ]);
  });
});
