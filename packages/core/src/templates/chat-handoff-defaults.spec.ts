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
  "assets",
  "analytics",
  "brain",
  "forms",
  "plan",
  "crm",
] as const;

const REQUIRE_ACTIVE_HANDOFF: Record<
  (typeof PAGE_CHAT_TEMPLATES)[number],
  boolean
> = {
  chat: true,
  assets: true,
  analytics: true,
  brain: true,
  forms: true,
  plan: true,
  crm: false,
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
        template === "crm"
          ? "app/components/layout/CrmLayout.tsx"
          : "app/components/layout/Layout.tsx",
      );

      expect(layout).toContain("useAgentChatHomeHandoff");
      expect(layout).toContain("useAgentChatHomeHandoffLinks");
      expect(layout).toContain("isAgentChatHomeHandoffActive");
      expect(layout).toContain("chatViewTransition");
      expect(layout).toContain("chatViewTransitionHandoff");
      expect(layout).toContain(
        `requireActiveHandoff: ${REQUIRE_ACTIVE_HANDOFF[template]}`,
      );
    },
  );

  it("lets Assets restore the shared active thread at chat home", () => {
    const route = readTemplateFile("assets", "app/routes/home.tsx");
    expect(route).toContain("const threadUrlSync = threadId");
    expect(route).toContain("threadUrlSync={threadUrlSync}");
    expect(route).not.toContain("routeThreadId: threadId ?? null");
  });

  it("keeps the starter home and routes the new-chat entry to AgentKit Chat", () => {
    const route = readTemplateFile("chat", "app/routes/home.tsx");
    // source-read-ok: verifies the exported template keeps the new-chat route wired to its durable handoff.
    const newChatRoute = readTemplateFile("chat", "app/routes/chat._index.tsx");
    // source-read-ok: verifies the production route's durable handoff wiring.
    const redirect = readTemplateFile(
      "chat",
      "app/components/chat/ChatHomeRedirect.tsx",
    );
    const chatSurface = readTemplateFile(
      "chat",
      "app/components/chat/ChatRouteContent.tsx",
    );
    expect(route).toContain("<HomePage />");
    expect(newChatRoute).toContain("ChatHomeRedirect");
    expect(redirect).toContain('markAgentChatHomeHandoff("chat")');
    expect(redirect).toContain("getChatHomeThreadId");
    const usesClientNavigate =
      redirect.includes("useNavigate") &&
      /navigate\(\s*`\/chat\/\$\{encodeURIComponent\(threadId\)\}`,\s*\{\s*replace:\s*true,?\s*\}\s*\)/s.test(
        redirect,
      );
    const usesDurableHardNavigation =
      redirect.includes(
        'import { appPath } from "@agent-native/core/client/api-path";',
      ) &&
      redirect.includes(
        "window.location.replace(appPath(chatThreadPath(threadId)));",
      );
    expect(usesClientNavigate || usesDurableHardNavigation).toBe(true);
    expect(redirect).toContain("return null;");
    expect(redirect).toContain("useState(");
    expect(chatSurface).toContain("AgentKitRoot");
    expect(chatSurface).toContain("AgentKitChat");
  });

  it("does not force Plan's page chat to start a fresh thread", () => {
    const page = readTemplateFile("plan", "app/pages/PlanChatPage.tsx");
    expect(page).not.toContain("restoreActiveThread={false}");
  });
});
