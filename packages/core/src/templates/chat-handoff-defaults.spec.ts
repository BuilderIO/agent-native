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

const PAGE_CHAT_TEMPLATES = [
  "chat",
  "assets",
  "analytics",
  "brain",
  "forms",
  "plan",
] as const;

const REQUIRE_ACTIVE_HANDOFF: Record<
  (typeof PAGE_CHAT_TEMPLATES)[number],
  boolean
> = {
  chat: false,
  assets: false,
  analytics: false,
  brain: false,
  forms: true,
  plan: false,
};

function readTemplateFile(template: string, relativePath: string): string {
  return fs.readFileSync(
    path.join(ROOT, "templates", template, relativePath),
    "utf-8",
  );
}

describe("page-chat handoff defaults", () => {
  it.each(PAGE_CHAT_TEMPLATES)(
    "%s keeps full-page chat and AgentSidebar on the shared morph contract",
    (template) => {
      const layout = readTemplateFile(
        template,
        "app/components/layout/Layout.tsx",
      );

      expect(layout).toContain("useAgentChatHomeHandoff");
      expect(layout).toContain("useAgentChatHomeHandoffLinks");
      expect(layout).toContain("chatViewTransition");
      expect(layout).toContain(
        `requireActiveHandoff: ${REQUIRE_ACTIVE_HANDOFF[template]}`,
      );
    },
  );

  it("lets Chat and Assets restore the shared active thread at chat home", () => {
    for (const template of ["chat", "assets"] as const) {
      const route = readTemplateFile(template, "app/routes/_index.tsx");
      expect(route).toContain("const threadUrlSync = threadId");
      expect(route).toContain("threadUrlSync={threadUrlSync}");
      expect(route).not.toContain("routeThreadId: threadId ?? null");
    }
  });

  it("does not force Plan's page chat to start a fresh thread", () => {
    const page = readTemplateFile("plan", "app/pages/PlanChatPage.tsx");
    expect(page).not.toContain("restoreActiveThread={false}");
  });
});
