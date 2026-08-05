// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip.js";
import { AgentsSection } from "./AgentsSection.js";

vi.mock("../api-path.js", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
}));

function renderSection(root: Root) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AgentsSection />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
}

// A migrated remote agent keeps its legacy `agents/` row alongside the
// canonical `remote-agents/` one, so the list has to collapse them.
const resources = [
  { id: "legacy-mail", path: "agents/mail.json" },
  { id: "canonical-mail", path: "remote-agents/mail.json" },
  { id: "canonical-analytics", path: "remote-agents/analytics.json" },
  { id: "skill-row", path: "skills/writing/SKILL.md" },
];

const contentById: Record<string, string> = {
  "legacy-mail": JSON.stringify({
    id: "mail",
    name: "Mail",
    url: "http://localhost:8088",
  }),
  "canonical-mail": JSON.stringify({
    id: "mail",
    name: "Mail",
    url: "http://localhost:8088",
  }),
  "canonical-analytics": JSON.stringify({
    id: "analytics",
    name: "Analytics",
    url: "http://localhost:8085",
  }),
};

describe("AgentsSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const detail = url.match(/\/resources\/([^?]+)$/);
        if (detail) return Response.json({ content: contentById[detail[1]] });
        return Response.json({ resources });
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("lists a migrated agent once instead of twice", async () => {
    await renderSection(root);

    const names = Array.from(container.querySelectorAll("span")).map((span) =>
      span.textContent?.trim(),
    );
    expect(names.filter((name) => name === "Mail")).toHaveLength(1);
    expect(names.filter((name) => name === "Analytics")).toHaveLength(1);
  });

  it("never claims the shared secret is unset when the caller can't see it", async () => {
    // A member (not owner/admin) gets `a2aSecretSet` omitted entirely by the
    // server — the client must read that as "can't see it," never coerce the
    // absence into a false "not set" claim it has no basis for.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/_agent-native/org/me")) {
          return Response.json({
            email: "member@acme.com",
            orgId: "org-1",
            orgName: "Acme",
            role: "member",
            orgs: [],
            pendingInvitations: [],
            domainMatches: [],
            allowedDomain: "acme.com",
            // a2aSecretSet intentionally omitted (member, not owner/admin).
          });
        }
        if (url.includes("/_agent-native/agents/probe")) {
          return Response.json({ results: [] });
        }
        const detail = url.match(/\/resources\/([^?]+)$/);
        if (detail) return Response.json({ content: contentById[detail[1]] });
        return Response.json({ resources });
      }),
    );

    await renderSection(root);

    const text = container.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("not set");
    expect(text.toLowerCase()).toContain("workspace owner");
  });
});
