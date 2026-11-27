import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const actionsDir = new URL("../../actions/", import.meta.url);

const notionDocumentSyncActions = [
  "connect-notion-status",
  "create-and-link-notion-page",
  "disconnect-notion",
  "link-notion-page",
  "list-notion-database-sources",
  "pull-notion-page",
  "push-notion-page",
  "refresh-notion-sync-status",
  "resolve-notion-sync-conflict",
  "search-notion-pages",
  "unlink-notion-page",
] as const;

const skillPath = new URL(
  "../../.agents/skills/notion-integration/SKILL.md",
  import.meta.url,
);

function extractDocumentedFlagsByAction(
  markdown: string,
): Record<string, string[]> {
  const byAction: Record<string, string[]> = {};
  const commandLineRegex = /pnpm action ([a-z][a-z0-9-]*)([^\n]*)/g;
  let match: RegExpExecArray | null;
  while ((match = commandLineRegex.exec(markdown))) {
    const [, action, rest] = match;
    const flags = Array.from(rest.matchAll(/--([a-zA-Z][a-zA-Z0-9]*)/g)).map(
      (m) => m[1],
    );
    if (flags.length === 0) continue;
    byAction[action] = Array.from(
      new Set([...(byAction[action] ?? []), ...flags]),
    );
  }
  return byAction;
}

// oracle-change: removed the use-notion.ts source check; "keeps Notion document sync UI off direct app routes" in matrix-route-gap-classify.test.ts scans the same hook for direct Notion sync routes, and which query hooks it calls is not observable. HTTP exposure is now read from the loaded action definitions.
describe("Content Notion action parity", () => {
  it("only documents --flags that the action's zod schema actually accepts (n31)", async () => {
    const skillMarkdown = readFileSync(skillPath, "utf8");
    const documentedFlagsByAction =
      extractDocumentedFlagsByAction(skillMarkdown);

    const problems: string[] = [];
    for (const [action, flags] of Object.entries(documentedFlagsByAction)) {
      const file = new URL(`${action}.ts`, actionsDir);
      if (!existsSync(file)) {
        problems.push(
          `${action}: documented in SKILL.md but action file is missing`,
        );
        continue;
      }
      const mod = await import(file.href);
      const schemaShape = mod.default?.schema?.shape;
      if (!schemaShape) {
        problems.push(`${action}: could not read zod schema shape`);
        continue;
      }
      for (const flag of flags) {
        if (!(flag in schemaShape)) {
          problems.push(
            `${action}: SKILL.md documents --${flag}, but it is not a key in the action's zod schema`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("exposes Notion document sync actions over the action HTTP surface", async () => {
    const missingOrPrivate: string[] = [];
    for (const action of notionDocumentSyncActions) {
      const file = new URL(`${action}.ts`, actionsDir);
      if (!existsSync(file)) {
        missingOrPrivate.push(`${action}: missing action file`);
        continue;
      }
      const mod = await import(file.href);
      if (mod.default?.http === false) {
        missingOrPrivate.push(
          `${action}: not HTTP exposed for UI action hooks`,
        );
      }
    }

    expect(missingOrPrivate).toEqual([]);
  });
});
