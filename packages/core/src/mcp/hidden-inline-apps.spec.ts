import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  LOAD_TIMEOUT_MS,
  listAdvertised,
  loadAppCatalogs,
  type AppCatalog,
} from "./advertised-catalog.harness.js";
import { createMCPServerForRequest } from "./build-server.js";

vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  getAuthSecret: () => "fake-test-only-inline-app-approval-secret",
}));
vi.mock("./approval-store.js", () => ({
  createMcpApprovalGrant: vi.fn(async () => {}),
  consumeMcpApprovalGrant: vi.fn(async () => true),
}));

const INLINE_ACTIONS: Record<string, string[]> = {
  analytics: ["open-traffic-dashboard"],
  calendar: ["manage-event-draft"],
  content: ["share-local-file-document"],
  design: ["generate-screens", "export-coding-handoff"],
  slides: ["clone-context-slide"],
  "slides-2": ["clone-context-slide"],
};

let apps: AppCatalog[];
beforeAll(async () => {
  apps = await loadAppCatalogs(Object.keys(INLINE_ACTIONS));
}, LOAD_TIMEOUT_MS);

describe("explicit connector inline apps", () => {
  it(
    "advertises each inline tool and its UI resource on the default production catalog",
    async () => {
      vi.stubEnv("AGENT_MODE", "production");
      vi.stubEnv("AGENT_PROD_CODE_EXECUTION", "off");
      try {
        const catalogs: Record<string, unknown> = {};
        expect(apps.map((app) => app.appId).sort()).toEqual(
          Object.keys(INLINE_ACTIONS).sort(),
        );
        for (const app of apps) {
          const { tools } = await listAdvertised(app.surfaces[0]!.config, {
            fullCatalog: false,
            fullSurface: false,
            inlineMcpApps: true,
          });
          catalogs[app.appId] = INLINE_ACTIONS[app.appId]!.map((name) => {
            const tool = tools.find((candidate) => candidate.name === name);
            expect(tool, `${app.appId}/${name}`).toBeDefined();
            expect(tool?._meta?.ui, `${app.appId}/${name}`).toMatchObject({
              resourceUri: expect.stringMatching(/^ui:\/\//),
            });
            return tool;
          });
        }
        expect(catalogs).toMatchSnapshot();
      } finally {
        vi.unstubAllEnvs();
      }
    },
    LOAD_TIMEOUT_MS,
  );

  it.each([
    ["content", "share-local-file-document", { id: "local-file-test" }],
    ["design", "export-coding-handoff", { id: "design-test" }],
  ] as const)(
    "refuses %s/%s without host approval before running it",
    async (appId, name, args) => {
      const app = apps.find((candidate) => candidate.appId === appId)!;
      const config = app.surfaces[0]!.config;
      const entry = config.actions[name]!;
      expect(entry.needsApproval).toBe(true);
      const run = vi.fn(async () => ({ id: "unexpected-write" }));
      const actions = { ...config.actions, [name]: { ...entry, run } };
      const server = await createMCPServerForRequest(
        { ...config, actions, productionActions: actions },
        {
          userEmail: "approval-contract@example.com",
          orgDomain: undefined,
          orgId: null,
          identityAssurance: "user",
          oauthScopes: ["mcp:read", "mcp:write"],
        },
        { transport: "http", inlineMcpApps: true },
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "no-approval-host", version: "1.0.0" });
      try {
        await Promise.all([
          client.connect(clientTransport),
          server.connect(serverTransport),
        ]);
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain("actionApproval");
        expect(JSON.stringify(result.content)).toContain(
          "did not declare the required capability",
        );
        expect(run).not.toHaveBeenCalled();
      } finally {
        await client.close();
        await server.close();
      }
    },
    LOAD_TIMEOUT_MS,
  );

  it("keeps Content form submission delegated", () => {
    const app = apps.find((candidate) => candidate.appId === "content")!;
    expect(
      app.surfaces[0]!.catalogs.default.map((tool) => tool.name),
    ).not.toContain("submit-content-database-form");
  });

  it("keeps Design's external export instructions within its advertised tools", () => {
    const app = apps.find((candidate) => candidate.appId === "design")!;
    const names = app.surfaces[0]!.catalogs.default.map((tool) => tool.name);
    const instructions = app.instructions;
    for (const name of ["export-png", "export-coding-handoff"]) {
      expect(instructions).toContain(name);
      expect(names).toContain(name);
    }
    for (const name of [
      "export-html",
      "export-zip",
      "export-design-as-figma-svg",
    ]) {
      expect(instructions).not.toContain(name);
    }
  });
});
