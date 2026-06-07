import { describe, expect, it } from "vitest";

import {
  buildVisualRecapPlan,
  diffContainsSecret,
  parseDiff,
} from "./visual-recap";

describe("visual recap generator", () => {
  it("suppresses diffs that contain secret-looking lines without echoing them", () => {
    const fakeOpenAiKey = `sk-${"a".repeat(24)}`;
    const fakeGithubToken = `ghp_${"b".repeat(24)}`;
    const privateKeyHeader = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    const diffText = [
      "diff --git a/.env b/.env",
      "index 1111111..2222222 100644",
      "--- a/.env",
      "+++ b/.env",
      "@@ -1,3 +1,3 @@",
      `-OPENAI_API_KEY=${fakeOpenAiKey}`,
      `+GITHUB_TOKEN=${fakeGithubToken}`,
      `+KEY_HEADER=${privateKeyHeader}`,
      "",
    ].join("\n");

    expect(diffContainsSecret(diffText)).toBe(true);

    const result = buildVisualRecapPlan({ diffText, pr: "42" });
    expect(result).toEqual({
      suppressed: true,
      reason: "potential secret in diff",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(fakeOpenAiKey);
    expect(serialized).not.toContain(fakeGithubToken);
    expect(serialized).not.toContain(privateKeyHeader);
  });

  it("derives file-tree, data-model, and split diff blocks from real paths", () => {
    const diffText = [
      "diff --git a/templates/demo/schema.ts b/templates/demo/schema.ts",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/templates/demo/schema.ts",
      "@@ -0,0 +1,6 @@",
      '+import { pgTable, text } from "drizzle-orm/pg-core";',
      '+export const users = pgTable("users", {',
      '+  id: text("id").primaryKey(),',
      '+  email: text("email"),',
      "+});",
      "",
    ].join("\n");

    const result = buildVisualRecapPlan({
      diffText,
      statText: " templates/demo/schema.ts | 5 +++++",
      pr: "7",
      headSha: "abc1234def",
    });

    expect("planMdx" in result).toBe(true);
    if (!("planMdx" in result)) return;

    expect(result.summary).toMatchObject({
      files: 1,
      schemaFiles: 1,
      added: 5,
      removed: 0,
    });
    expect(result.planMdx).toContain("<FileTree");
    expect(result.planMdx).toContain("templates/demo/schema.ts");
    expect(result.planMdx).not.toContain("Visual recap — an aid");
    expect(result.planMdx).not.toContain("Generated for");
    expect(result.planMdx).toContain("<DataModel");
    expect(result.planMdx).toContain("users");
    expect(result.planMdx).toContain("email");
    expect(result.planMdx).toContain("<Diff");
    expect(result.planMdx).toContain('mode="split"');
    expect(result.planMdx).toContain("pgTable");
  });

  it("does not treat added source mentioning binary markers as a binary diff", () => {
    const diffText = [
      "diff --git a/scripts/example.ts b/scripts/example.ts",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/scripts/example.ts",
      "@@ -0,0 +1,2 @@",
      '+if (line.startsWith("Binary files")) return true;',
      '+if (line.includes("GIT binary patch")) return true;',
      "",
    ].join("\n");

    expect(parseDiff(diffText)[0]).toMatchObject({
      path: "scripts/example.ts",
      binary: false,
      added: 2,
    });
  });

  it("adds a visual canvas when a diff touches rendered UI files", () => {
    const diffText = [
      "diff --git a/packages/core/src/client/blocks/library/FileTreeBlock.tsx b/packages/core/src/client/blocks/library/FileTreeBlock.tsx",
      "index 1111111..2222222 100644",
      "--- a/packages/core/src/client/blocks/library/FileTreeBlock.tsx",
      "+++ b/packages/core/src/client/blocks/library/FileTreeBlock.tsx",
      "@@ -1,2 +1,3 @@",
      " export function FileTreeRead() {",
      '-  return <div className="tree">rows</div>;',
      '+  return <div className="tree compact">rows</div>;',
      "+}",
      "",
    ].join("\n");

    const result = buildVisualRecapPlan({ diffText, pr: "12" });
    expect("planMdx" in result).toBe(true);
    if (!("planMdx" in result)) return;

    expect(result.summary).toMatchObject({ uiFiles: 1 });
    expect(result.canvasMdx).toContain("<DesignBoard");
    expect(result.canvasMdx).toContain("Before UI surface");
    expect(result.canvasMdx).toContain("After UI surface");
    expect(result.canvasMdx).toContain("FileTreeBlock.tsx");
    expect(result.canvasMdx).not.toMatch(
      /<Artboard[^>]*(?:\sx=|\sy=|\swidth=|\sheight=)/,
    );
  });
});
