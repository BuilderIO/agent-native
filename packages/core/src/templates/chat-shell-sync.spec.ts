/**
 * Guard: the scaffold template (packages/core/src/templates/default) and
 * templates/chat must ship byte-identical shell files so that scaffolded apps
 * start from exactly the same code as the reference chat template.
 *
 * When you update entry.server.tsx or entry.client.tsx in either location,
 * update the other copy to match (copy in either direction — the content is
 * canonical, not the direction).
 *
 * Sync commands:
 *   # scaffold → chat
 *   cp packages/core/src/templates/default/app/entry.server.tsx \
 *      templates/chat/app/entry.server.tsx
 *   cp packages/core/src/templates/default/app/entry.client.tsx \
 *      templates/chat/app/entry.client.tsx
 *
 *   # chat → scaffold
 *   cp templates/chat/app/entry.server.tsx \
 *      packages/core/src/templates/default/app/entry.server.tsx
 *   cp templates/chat/app/entry.client.tsx \
 *      packages/core/src/templates/default/app/entry.client.tsx
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function workspaceRoot(): string {
  let current = process.cwd();
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Could not locate workspace root (pnpm-workspace.yaml).");
}

const ROOT = workspaceRoot();

const SCAFFOLD_DIR = path.join(ROOT, "packages/core/src/templates/default/app");
const CHAT_TEMPLATE_DIR = path.join(ROOT, "templates/chat/app");

function md5(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

function readFile(dir: string, filename: string): string {
  return fs.readFileSync(path.join(dir, filename), "utf-8");
}

/**
 * Shell files that must be byte-identical between scaffold and chat template.
 * Each entry is [filename, reason]:
 *   entry.server.tsx — both import the app-local React Router ServerRouter
 *     and pass it into the shared core handler; any future change to the
 *     pattern must land in both places at once.
 *   entry.client.tsx — lightweight hydration entry that sets basename from
 *     APP_BASE_PATH; must stay in sync for workspace-mount correctness.
 */
const SHELL_FILES: Array<[string, string]> = [
  [
    "entry.server.tsx",
    "uses app-local ServerRouter with core entry-server; must be identical",
  ],
  [
    "entry.client.tsx",
    "basename hydration from APP_BASE_PATH; must be identical",
  ],
];

describe("chat-shell sync guard", () => {
  it("keeps scaffold and chat shell files byte-identical", () => {
    const violations: string[] = [];

    for (const [filename] of SHELL_FILES) {
      const scaffoldContent = readFile(SCAFFOLD_DIR, filename);
      const chatContent = readFile(CHAT_TEMPLATE_DIR, filename);

      const scaffoldHash = md5(scaffoldContent);
      const chatHash = md5(chatContent);

      if (scaffoldHash !== chatHash) {
        violations.push(
          `${filename}: scaffold (packages/core/src/templates/default/app) and chat (templates/chat/app) differ.\n` +
            `  Update both to match or copy one to the other.`,
        );
      }
    }

    expect(
      violations,
      [
        "Scaffold/chat shell files have drifted.",
        "Copy the updated file to the other location to fix.",
        "",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });

  it("every listed shell file exists in both scaffold and chat template", () => {
    for (const [filename, reason] of SHELL_FILES) {
      const scaffoldPath = path.join(SCAFFOLD_DIR, filename);
      const chatPath = path.join(CHAT_TEMPLATE_DIR, filename);

      expect(
        fs.existsSync(scaffoldPath),
        `${filename} missing from scaffold (${reason})`,
      ).toBe(true);

      expect(
        fs.existsSync(chatPath),
        `${filename} missing from chat template (${reason})`,
      ).toBe(true);
    }
  });
});
