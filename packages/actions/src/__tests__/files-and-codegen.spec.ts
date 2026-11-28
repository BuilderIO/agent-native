import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { generateActionArtifacts, scanActionsDirectory } from "../codegen.js";
import {
  ActionNameCollisionError,
  actionNameFromRelPath,
  scanActionDir,
} from "../files.js";

const tmpDirs: string[] = [];

function makeTempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-actions-files-"));
  tmpDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("@agent-native/actions/files scanner", () => {
  it("derives hyphen-joined names across nested directories and Windows separators", () => {
    expect(actionNameFromRelPath("create-todo.ts")).toBe("create-todo");
    expect(actionNameFromRelPath("billing/create-invoice.ts")).toBe(
      "billing-create-invoice",
    );
    expect(actionNameFromRelPath("a\\b\\c.mjs")).toBe("a-b-c");
  });

  it("recursively discovers nested actions while skipping helpers, tests, declarations, and hidden dirs", () => {
    const dir = makeTempProject({
      "actions/ping.ts": "export default {};",
      "actions/billing/create-invoice.ts": "export default {};",
      "actions/billing/helpers.ts": "export default {};",
      "actions/helpers.ts": "export default {};",
      "actions/_private.ts": "export default {};",
      "actions/_shared/util.ts": "export default {};",
      "actions/.hidden/secret.ts": "export default {};",
      "actions/node_modules/pkg/index.ts": "export default {};",
      "actions/types.d.ts": "export type Foo = string;",
      "actions/ping.spec.ts": "export {};",
      "actions/ping.test.js": "export {};",
      "actions/README.md": "# readme",
    });

    const found = scanActionDir(
      path.join(dir, "actions"),
      new Set(["helpers"]),
    );
    expect(found).toEqual([
      { relPath: "billing/create-invoice.ts", name: "billing-create-invoice" },
      { relPath: "billing/helpers.ts", name: "billing-helpers" },
      { relPath: "ping.ts", name: "ping" },
    ]);
  });

  it("throws ActionNameCollisionError marked as actionDefinitionError on flat vs nested collision", () => {
    const dir = makeTempProject({
      "actions/billing-create-invoice.ts": "export default {};",
      "actions/billing/create-invoice.ts": "export default {};",
    });

    let caught: unknown;
    try {
      scanActionDir(path.join(dir, "actions"));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ActionNameCollisionError);
    expect(caught).toMatchObject({
      actionDefinitionError: true,
      name: "ActionDefinitionError",
      message: expect.stringContaining('"billing-create-invoice"'),
    });
  });

  it("returns an empty list for a missing directory", () => {
    expect(scanActionDir("/nonexistent/actions-directory-xyz")).toEqual([]);
  });
});

describe("codegen with nested actions and context.ts", () => {
  it("generates static imports for nested actions and actions/context.ts deterministically", () => {
    const dir = makeTempProject({
      "actions/context.ts":
        "export async function createContext() { return { role: 'admin' }; }\n",
      "actions/ping.ts": "export default {};\n",
      "actions/billing/create-invoice.ts": "export default {};\n",
      "actions/context.spec.ts": "export {};\n",
    });

    const scan = scanActionsDirectory(dir);
    expect(scan.contextFile).toBe(path.join(dir, "actions/context.ts"));
    expect(scan.actions.map((a) => a.name)).toEqual([
      "billing-create-invoice",
      "ping",
    ]);

    const first = generateActionArtifacts({ projectRoot: dir });
    expect(first.actionCount).toBe(2);
    expect(first.hasContextFile).toBe(true);

    const manifest = fs.readFileSync(first.manifestPath, "utf8");
    expect(manifest).toContain('"../actions/billing/create-invoice"');
    expect(manifest).toContain('"billing-create-invoice"');
    expect(manifest).toContain('"../actions/context"');
    expect(manifest).toContain(
      "createContext: actionContextModule.createContext",
    );

    const types = fs.readFileSync(first.typesPath, "utf8");
    expect(types).toContain('"billing-create-invoice"');
    expect(types).toContain('declare module "@agent-native/actions/client"');

    const mtimeBefore = fs.statSync(first.manifestPath).mtimeMs;
    const second = generateActionArtifacts({ projectRoot: dir });
    expect(second.actionCount).toBe(2);
    expect(fs.statSync(first.manifestPath).mtimeMs).toBe(mtimeBefore);
  });
});
