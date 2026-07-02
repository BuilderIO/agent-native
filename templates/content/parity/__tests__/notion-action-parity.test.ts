import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const contentRoot = new URL("../../", import.meta.url);
const actionsDir = new URL("../../actions/", import.meta.url);

const notionDocumentSyncActions = [
  "connect-notion-status",
  "create-and-link-notion-page",
  "disconnect-notion",
  "link-notion-page",
  "pull-notion-page",
  "push-notion-page",
  "refresh-notion-sync-status",
  "resolve-notion-sync-conflict",
  "search-notion-pages",
  "unlink-notion-page",
] as const;

describe("Content Notion action parity", () => {
  it("keeps normal Notion document sync UI off direct app routes", () => {
    const hook = readFileSync(
      new URL("app/hooks/use-notion.ts", contentRoot),
      "utf8",
    );

    expect(hook).not.toMatch(/\/api\/documents\/[^"`']*\/notion/);
    expect(hook).not.toMatch(/\/api\/notion\/(?:status|disconnect|search)/);
    expect(hook).toContain("useActionQuery");
    expect(hook).toContain("useActionMutation");
  });

  it("exposes Notion document sync actions over the action HTTP surface", () => {
    const missingOrPrivate = notionDocumentSyncActions.flatMap((action) => {
      const file = new URL(`${action}.ts`, actionsDir);
      if (!existsSync(file)) return [`${action}: missing action file`];
      const source = readFileSync(file, "utf8");
      return /http:\s*false/.test(source)
        ? [`${action}: not HTTP exposed for UI action hooks`]
        : [];
    });

    expect(missingOrPrivate).toEqual([]);
  });
});
