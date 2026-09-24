import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

it("keeps home, dialog and initially empty native chat return origins distinct", () => {
  const home = readFileSync("app/pages/Index.tsx", "utf8");
  const dialog = readFileSync("app/components/editor/PromptDialog.tsx", "utf8");
  const chat = readFileSync(
    "app/components/editor/use-design-agent-composer.ts",
    "utf8",
  );
  expect(home).toContain('originScopeKey: "design:home"');
  expect(dialog).toContain("originScopeKey: draftScope ?? title");
  expect(chat).toContain('originScopeKey: `chat:${activeThreadId || "new"}`');
  const context = readFileSync(
    "app/components/editor/use-design-prompt-context.tsx",
    "utf8",
  );
  expect(context).toContain(
    "const referenceStorageKey = `design-system-composer:${contextId}`",
  );
  expect(context).toContain('localScopeKey = ""');
});
