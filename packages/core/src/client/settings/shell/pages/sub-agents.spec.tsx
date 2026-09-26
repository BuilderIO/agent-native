// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orgState = vi.hoisted(() => ({
  value: {
    orgId: "org-1",
    orgName: "Acme",
    role: "member" as string,
    a2aSecretSet: undefined as boolean | undefined,
  },
}));

vi.mock("../../../org/hooks.js", () => ({
  useOrg: () => ({ data: orgState.value, isLoading: false, isError: false }),
  useSyncA2ASecret: () => ({
    mutate: () => {},
    isPending: false,
    data: undefined,
    error: null,
  }),
}));
vi.mock("../../../org/workspace-app-links.js", () => ({
  useOrgSwitcherAppLinks: () => ({ isWorkspace: false }),
}));
vi.mock("../../../api-path.js", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
  appMountedPath: (path: string) => path,
}));

import { TooltipProvider } from "../../../components/ui/tooltip.js";
import type { RemoteAgentInfo } from "../../AgentsSection.js";
import { SettingsShellProvider, type SettingsPageHeader } from "../context.js";
import SubAgentsSettingsPage, { groupSubAgents } from "./sub-agents.js";

// Seeded first-party apps and a connected external agent. `mail` also keeps
// its pre-migration `agents/` row, which must not list it twice.
const resources = [
  { id: "legacy-mail", path: "agents/mail.json" },
  { id: "mail", path: "remote-agents/mail.json" },
  { id: "calendar", path: "remote-agents/calendar.json" },
  { id: "foundry", path: "remote-agents/foundry-support.json" },
  { id: "skill-row", path: "skills/writing/SKILL.md" },
];

const contentById: Record<string, unknown> = {
  "legacy-mail": { id: "mail", name: "Mail", url: "https://mail.example.test" },
  mail: { id: "mail", name: "Mail", url: "https://mail.example.test" },
  calendar: {
    id: "calendar",
    name: "Calendar",
    url: "https://calendar.example.test",
  },
  foundry: {
    id: "foundry-support",
    name: "Foundry support",
    url: "https://foundry.example.test",
  },
};

const probeResults = [
  { id: "mail", url: "https://mail.example.test", reachable: true },
  { id: "calendar", url: "https://calendar.example.test", reachable: false },
  {
    id: "foundry-support",
    url: "https://foundry.example.test",
    reachable: true,
    authorized: false,
  },
];

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  let body: unknown = {};
  if (url.startsWith("/_agent-native/agents/probe")) {
    body = { results: probeResults };
  } else if (url.startsWith("/_agent-native/resources/tree")) {
    body = { tree: [] };
  } else if (url.startsWith("/_agent-native/resources?")) {
    body = { resources };
  } else if (url.startsWith("/_agent-native/resources/")) {
    const id = url.slice("/_agent-native/resources/".length);
    body = { content: JSON.stringify(contentById[id]) };
  } else if (url.startsWith("/_agent-native/secrets")) {
    body = [];
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

let container: HTMLDivElement;
let root: Root;
let header: SettingsPageHeader | null;

async function settle() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (
      !container.querySelector('[role="status"][aria-busy="true"]') &&
      container.querySelector("[data-sub-agent-row]")
    ) {
      break;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

async function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  header = null;
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SettingsShellProvider
            value={{
              route: { page: "sub-agents", sub: null },
              navigate: () => {},
              setHeader: (next) => {
                header = next;
              },
            }}
          >
            <SubAgentsSettingsPage />
          </SettingsShellProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

function group(id: string) {
  const section = container.querySelector<HTMLElement>(`[id="${id}"]`);
  if (!section) throw new Error(`missing group ${id}`);
  return section;
}

function rowIds(id: string) {
  return Array.from(
    group(id).querySelectorAll<HTMLElement>("[data-sub-agent-row]"),
    (row) => row.dataset.subAgentRow,
  );
}

function buttonByText(scope: ParentNode, text: string) {
  return Array.from(scope.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

beforeEach(() => {
  orgState.value = {
    orgId: "org-1",
    orgName: "Acme",
    role: "member",
    a2aSecretSet: undefined,
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/settings/sub-agents");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe("Sub-agents page", () => {
  it("lists each first-party app once with its status and URL", async () => {
    await renderPage();

    expect(group("workspace-apps").querySelector("h2")?.textContent).toBe(
      "Acme apps",
    );
    expect(rowIds("workspace-apps")).toEqual(["calendar", "mail"]);
    const mail = group("workspace-apps").querySelector(
      '[data-sub-agent-row="mail"]',
    );
    expect(mail?.textContent).toContain("Reachable");
    expect(mail?.textContent).toContain("https://mail.example.test");
    expect(
      group("workspace-apps").querySelector('[data-sub-agent-row="calendar"]')
        ?.textContent,
    ).toContain("Unreachable");
    expect(rowIds("external-agents")).toEqual(["foundry-support"]);
    expect(group("external-agents").textContent).toContain("Auth rejected");
  });

  it("keeps members read only and still lets them add custom agents", async () => {
    await renderPage();

    expect(header?.action).toBeFalsy();
    expect(group("workspace-apps").querySelector("header")?.textContent).toBe(
      "Acme appsManaged by admins",
    );
    expect(container.querySelector('[aria-label="More actions"]')).toBeNull();
    const custom = group("custom-agents");
    expect(custom.textContent).toContain(
      "Define a focused agent the main agent can delegate to.",
    );
    expect(buttonByText(custom, "Add agent")).toBeTruthy();
  });

  it("gives admins Connect agent, the directory, and a row menu", async () => {
    orgState.value = { ...orgState.value, role: "admin" };
    await renderPage();

    expect(header?.action).toBeTruthy();
    expect(
      group("workspace-apps").querySelector("header")?.textContent,
    ).not.toContain("Managed by admins");
    expect(
      group("external-agents").querySelectorAll('[aria-label="More actions"]'),
    ).toHaveLength(1);

    const headerHost = document.createElement("div");
    document.body.appendChild(headerHost);
    const headerRoot = createRoot(headerHost);
    await act(async () => headerRoot.render(<>{header?.action}</>));
    const connect = buttonByText(headerHost, "Connect agent");
    await act(async () => connect!.click());
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Connect an agent");
    expect(dialog?.textContent).toContain("Microsoft Foundry");
    expect(dialog?.textContent).toContain("Gemini Enterprise");
    expect(dialog?.textContent).toContain("Anthropic Managed Agents");
    expect(dialog?.textContent).toContain("Any A2A agent");
    expect(
      dialog?.querySelector<HTMLAnchorElement>("a[target=_blank]")?.href,
    ).toContain("a2a-registry.org");

    await act(async () => buttonByText(dialog!, "Add by URL")!.click());
    const form = document.body.querySelector('[role="dialog"]');
    expect(form?.querySelector("h2")?.textContent).toBe("Any A2A agent");
    const urlField = Array.from(form?.querySelectorAll("label") ?? []).find(
      (label) => label.textContent?.startsWith("URL"),
    );
    expect(urlField?.querySelector("input")).toBeTruthy();
    const add = buttonByText(form!, "Add") as HTMLButtonElement | undefined;
    expect(add?.type).toBe("submit");
    expect(add?.disabled).toBe(true);
    act(() => headerRoot.unmount());
  });

  it("opens the connect form from a ?connect= deep link for admins", async () => {
    orgState.value = { ...orgState.value, role: "owner" };
    window.history.replaceState(
      null,
      "",
      "/settings/sub-agents?connect=anthropic-managed-agents&tab=x",
    );
    await renderPage();

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.querySelector("h2")?.textContent).toBe(
      "Anthropic Managed Agents",
    );
    // The params stay until the form closes, so the shell's legacy rewrite
    // cannot put them back after the page stripped them.
    expect(window.location.search).toContain("connect=");
    await act(async () => buttonByText(dialog!, "Cancel")!.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(window.location.search).toBe("?tab=x");
  });

  it("shows the empty External agents state with Connect agent for admins", async () => {
    orgState.value = { ...orgState.value, role: "admin" };
    const saved = resources.splice(3, 1);
    try {
      await renderPage();
    } finally {
      resources.splice(3, 0, ...saved);
    }

    const external = group("external-agents");
    expect(external.textContent).toContain(
      "Connect Foundry, Gemini Enterprise, Anthropic, or any A2A agent.",
    );
    expect(external.textContent).toContain("No external agents yet");
    expect(buttonByText(external, "Connect agent")).toBeTruthy();
  });
});

describe("groupSubAgents", () => {
  const agent = (id: string, name: string): RemoteAgentInfo => ({
    id,
    path: `remote-agents/${id}.json`,
    name,
    url: `https://${id}.example.test`,
  });

  it("drops hidden first-party manifests and adds discovery-only apps", () => {
    const { apps, external } = groupSubAgents(
      [agent("mail", "Mail"), agent("issues", "Issues"), agent("acme", "Acme")],
      new Map([
        ["mail", { url: "https://mail.example.test", reachable: true }],
        ["slides", { url: "http://localhost:8083", reachable: true }],
      ]),
    );

    expect(
      apps.map((row) => [row.agentId, row.url, Boolean(row.agent)]),
    ).toEqual([
      ["mail", "https://mail.example.test", true],
      ["slides", "http://localhost:8083", false],
    ]);
    expect(external.map((row) => row.agentId)).toEqual(["acme"]);
  });
});
