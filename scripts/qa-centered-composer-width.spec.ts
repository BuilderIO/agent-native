import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const composerWidthContracts = [
  {
    app: "Analytics",
    file: "templates/analytics/app/global.css",
    rule: /\.analytics-chat-panel[\s\S]*?\.agent-composer-area,[\s\S]*?\.agent-plan-mode-callout\s*\{[\s\S]*?max-width: min\(750px, 100%\);/,
  },
  {
    app: "Brain",
    file: "templates/brain/app/global.css",
    rule: /\.brain-chat-panel[\s\S]*?\.agent-composer-area\s*\{[\s\S]*?max-width: min\(750px, 100%\);/,
  },
  {
    app: "Assets",
    file: "templates/assets/app/global.css",
    rule: /\.assets-create-chat-panel[\s\S]*?\.agent-composer-area\s*\{[\s\S]*?max-width: min\(750px, 100%\);/,
  },
  {
    app: "CRM",
    file: "templates/crm/app/global.css",
    rule: /\.crm-chat-panel[\s\S]*?\.agent-composer-area\s*\{[\s\S]*?max-width: min\(750px, 100%\);/,
  },
  {
    app: "Forms",
    file: "templates/forms/app/global.css",
    rule: /\.forms-ask-chat-panel[\s\S]*?\.agent-composer-area--hero\s*\{[\s\S]*?max-width: min\(750px, 100%\);/,
  },
] as const;

describe("centered full-page composer width", () => {
  for (const contract of composerWidthContracts) {
    it(`${contract.app} keeps the composer at the shared 750px max`, () => {
      const stylesheet = readFileSync(
        path.join(repoRoot, contract.file),
        "utf8",
      );

      expect(stylesheet).toMatch(contract.rule);
    });
  }
});
