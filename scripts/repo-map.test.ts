import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRepoMap } from "./repo-map";

test("buildRepoMap ranks files by internal in-degree including .js and @/ aliases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-map-test-"));
  try {
    const write = (rel: string, content: string) => {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };
    write("app/types.ts", "export interface MailItem { id: string }\n");
    write(
      "app/hooks.ts",
      'import type { MailItem } from "./types.js";\nexport function useMail(): MailItem[] { return []; }\n',
    );
    write(
      "app/page.tsx",
      'import type { MailItem } from "@/types";\nimport { useMail } from "@/hooks";\nexport function Page() { return useMail() as MailItem[]; }\n',
    );
    write(
      "app/page.spec.ts",
      'import { Page } from "./page";\nexport const check = Page;\n',
    );

    const map = buildRepoMap(root, "app", { top: 2 });
    assert.equal(map.files, 3);
    assert.equal(map.internalEdges, 3);
    assert.equal(map.entries[0]?.file, "types.ts");
    assert.equal(map.entries[0]?.inDegree, 2);
    assert.deepEqual(map.entries[0]?.exports, ["MailItem"]);
    assert.equal(map.entries[1]?.file, "hooks.ts");
    assert.equal(map.entries[1]?.inDegree, 1);

    const withTests = buildRepoMap(root, "app", {
      top: 10,
      includeTests: true,
    });
    assert.equal(withTests.files, 4);
    assert.equal(withTests.internalEdges, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
