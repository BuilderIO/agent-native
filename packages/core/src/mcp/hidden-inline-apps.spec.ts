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
vi.mock("./approval-store.js", async () => ({
  ...(await vi.importActual<typeof import("./approval-store.js")>(
    "./approval-store.js",
  )),
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
    "advertises each inline tool on the default production catalog, with a UI resource only for a scoped widget target",
    async () => {
      vi.stubEnv("AGENT_MODE", "production");
      vi.stubEnv("AGENT_PROD_CODE_EXECUTION", "off");
      try {
        const catalogs: Record<string, unknown> = {};
        expect(apps.map((app) => app.appId).sort()).toEqual(
          Object.keys(INLINE_ACTIONS).sort(),
        );
        for (const app of apps) {
          const config = app.surfaces[0]!.config;
          const { tools } = await listAdvertised(config, {
            fullCatalog: false,
            fullSurface: false,
            inlineMcpApps: true,
          });
          // An embedApp card needs an embed session scoped to one target, so
          // it is offered only when the app declares a widget target for it.
          const widgetTargets = config.directoryProfile?.widgetTargets ?? {};
          catalogs[app.appId] = INLINE_ACTIONS[app.appId]!.map((name) => {
            const tool = tools.find((candidate) => candidate.name === name);
            expect(tool, `${app.appId}/${name}`).toBeDefined();
            if (Object.hasOwn(widgetTargets, name)) {
              expect(tool?._meta?.ui, `${app.appId}/${name}`).toMatchObject({
                resourceUri: expect.stringMatching(/^ui:\/\//),
              });
            } else {
              expect(
                (tool?._meta?.ui as { resourceUri?: unknown } | undefined)
                  ?.resourceUri,
                `${app.appId}/${name}`,
              ).toBeUndefined();
            }
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
    "sends %s/%s to the review page without host approval before running it",
    async (appId, name, args) => {
      const app = apps.find((candidate) => candidate.appId === appId)!;
      const config = app.surfaces[0]!.config;
      const entry = config.actions[name]!;
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
        expect(JSON.stringify(result.content)).toContain(
          `${name} needs the user's approval before it runs`,
        );
        expect(JSON.stringify(result.content)).toContain(
          "/_agent-native/mcp/approvals/",
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
