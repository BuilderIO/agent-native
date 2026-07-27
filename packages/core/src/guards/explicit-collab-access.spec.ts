import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanExplicitCollabAccess } from "./explicit-collab-access.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempAppRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-collab-guard-"));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe("scanExplicitCollabAccess", () => {
  it("reports an object-literal call with implicit deployment-wide access", () => {
    const root = makeTempAppRoot({
      "server/plugins/collab.ts": [
        "export default createCollabPlugin({",
        '  table: "todos",',
        '  contentColumn: "content",',
        "});",
        "",
      ].join("\n"),
    });

    expect(scanExplicitCollabAccess({ root })).toEqual({
      name: "explicit-collab-access",
      findings: [
        expect.objectContaining({
          file: "server/plugins/collab.ts",
          line: 1,
          message: expect.stringContaining("all-authenticated"),
        }),
      ],
    });
  });

  it("reports a no-argument call with implicit deployment-wide access", () => {
    const root = makeTempAppRoot({
      "server/plugins/collab.ts": "export default createCollabPlugin();\n",
    });

    expect(scanExplicitCollabAccess({ root }).findings).toEqual([
      expect.objectContaining({
        file: "server/plugins/collab.ts",
        line: 1,
      }),
    ]);
  });

  it("accepts the new access option and the legacy resourceType option", () => {
    const root = makeTempAppRoot({
      "server/plugins/global-collab.ts": [
        "export default createCollabPlugin({",
        '  access: { mode: "all-authenticated" },',
        '  table: "todos",',
        "});",
      ].join("\n"),
      "server/plugins/resource-collab.js": [
        "export default createCollabPlugin({",
        '  "resourceType": "document",',
        '  table: "documents",',
        "});",
      ].join("\n"),
    });

    expect(scanExplicitCollabAccess({ root }).findings).toEqual([]);
  });

  it("requires access at the top level rather than inside another option", () => {
    const root = makeTempAppRoot({
      "server/plugins/collab.ts": [
        "export default createCollabPlugin({",
        '  metadata: { access: "internal" },',
        '  table: "todos",',
        "});",
      ].join("\n"),
    });

    expect(scanExplicitCollabAccess({ root }).findings).toHaveLength(1);
  });

  it("ignores non-literal configs and occurrences in comments or strings", () => {
    const root = makeTempAppRoot({
      "server/plugins/collab.ts": [
        'const example = "createCollabPlugin({ table: \\"todos\\" })";',
        '// createCollabPlugin({ table: "todos" });',
        "const config = getCollabConfig();",
        "export default createCollabPlugin(config);",
      ].join("\n"),
    });

    expect(scanExplicitCollabAccess({ root }).findings).toEqual([]);
  });
});
