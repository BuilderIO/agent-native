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

const skillPath = new URL(
  "../../.agents/skills/notion-integration/SKILL.md",
  import.meta.url,
);

/**
 * Extracts every `--flag` token that appears on a `pnpm action <name> ...`
 * command line in a markdown doc, keyed by action name. Optional-bracket
 * flags like `[--autoSync true]` are included (the brackets are stripped).
 */
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
