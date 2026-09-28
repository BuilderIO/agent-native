import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addLocalhostScreensRun: vi.fn(),
  createEmbedSessionTicket: vi.fn(),
  connectLocalhostRun: vi.fn(),
  createDesignRun: vi.fn(),
  getRequestContext: vi.fn(),
  getRequestAuthCapability: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  navigateRun: vi.fn(),
  runWithRequestContext: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
  embedApp: (config: unknown) => config,
  fail: (message: string) => {
    throw new Error(message);
  },
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/server", () => ({
  buildEmbedStartPath: (ticket: string) =>
    `/_agent-native/embed/start?ticket=${ticket}`,
  buildDeepLink: ({
    to,
  }: {
    app: string;
    view: string;
    params: Record<string, unknown>;
    to: string;
  }) => `agent-native://open${to}`,
  createEmbedSessionTicket: mocks.createEmbedSessionTicket,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: mocks.getRequestContext,
  getRequestAuthCapability: mocks.getRequestAuthCapability,
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
  runWithRequestContext: mocks.runWithRequestContext,
}));

vi.mock("./connect-localhost.js", () => ({
  default: {
    run: mocks.connectLocalhostRun,
  },
  DEFAULT_BRIDGE_URL: "http://127.0.0.1:7331",
  derivePreviewToken: (token: string) => `preview:${token}`,
  normalizeBridgeUrl: (value: string) => value,
}));

vi.mock("./add-localhost-screens.js", () => ({
  default: {
    run: mocks.addLocalhostScreensRun,
  },
  pathFromUrl: (_baseUrl: string, _url: string, fallback?: string) =>
    fallback ?? "/",
  routeUrl: (baseUrl: string, route: { path?: string; url?: string }) =>
    new URL(route.url ?? route.path ?? "/", `${baseUrl}/`).toString(),
}));

vi.mock("./create-design.js", () => ({
  default: {
    run: mocks.createDesignRun,
  },
}));

vi.mock("./navigate.js", () => ({
  default: {
    run: mocks.navigateRun,
  },
}));

import action, {
  localVisualEditBridgePrincipal,
  localVisualEditWorkspacePrincipal,
} from "./open-visual-edit.js";

function bridgeAttestationSignature(bridgeToken: string, challenge: string) {
  return crypto
    .createHmac("sha256", bridgeToken)
    .update("agent-native-design-preview-attestation-v1\0")
    .update(challenge)
    .digest("hex");
}

describe("open-visual-edit", () => {
  it("allows the public Design page to call the action without a session", () => {
    expect(action.requiresAuth).toBe(false);
  });

  beforeEach(() => {
    mocks.addLocalhostScreensRun.mockReset();
    mocks.createEmbedSessionTicket.mockReset();
    mocks.createEmbedSessionTicket.mockResolvedValue({
      ticket: "visual-edit-example-ticket",
      ticketHash: "visual-edit-example-ticket-hash",
      expiresAt: 123_456,
    });
    mocks.connectLocalhostRun.mockReset();
    mocks.createDesignRun.mockReset();
    mocks.createDesignRun.mockResolvedValue({ id: "design_created" });
    mocks.getRequestContext.mockReset();
    mocks.getRequestContext.mockReturnValue({
      userEmail: undefined,
      orgId: undefined,
      requestOrigin: "https://design.example.com",
    });
    mocks.getRequestOrgId.mockReset();
    mocks.getRequestOrgId.mockReturnValue("org_1");
    mocks.getRequestUserEmail.mockReset();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getRequestAuthCapability.mockReset();
    mocks.getRequestAuthCapability.mockReturnValue(undefined);
    mocks.navigateRun.mockReset();
    mocks.runWithRequestContext.mockReset();
    mocks.runWithRequestContext.mockImplementation(
      async (
        requestContext: { userEmail?: string; orgId?: string },
        run: () => Promise<unknown>,
      ) => {
        const previousUserEmail = mocks.getRequestUserEmail();
        const previousOrgId = mocks.getRequestOrgId();
        mocks.getRequestUserEmail.mockReturnValue(requestContext.userEmail);
        mocks.getRequestOrgId.mockReturnValue(requestContext.orgId);
        try {
          return await run();
        } finally {
          mocks.getRequestUserEmail.mockReturnValue(previousUserEmail);
          mocks.getRequestOrgId.mockReturnValue(previousOrgId);
        }
      },
    );
    mocks.writeAppState.mockReset();

    mocks.connectLocalhostRun.mockResolvedValue({
      id: "localhost_canonical",
      bridgeUrl: "http://127.0.0.1:7331",
      rootPath: "/tmp/app",
      bridgeToken: "stored-write-token",
      previewToken: "stored-preview-token",
      routes: [],
    });
    mocks.addLocalhostScreensRun.mockResolvedValue({
      screenCount: 1,
      screens: [{ id: "screen_1" }],
      placedFrames: [{ fileId: "screen_1" }],
    });
  });

  it("advertises the host coding-agent handoff on its MCP App resource", () => {
    expect(action.mcpApp.resource.description).toContain("host coding agent");
  });

  it("uses the connection id returned by connect-localhost when no id is supplied", async () => {
    const result = await action.run({
      designId: "design_1",
      devServerUrl: "http://localhost:5173/",
      bridgeUrl: "http://127.0.0.1:7331",
      rootPath: "/tmp/app",
      routeManifest: {
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:5173",
        rootPath: "/tmp/app",
        routes: [{ path: "/", title: "Home" }],
      },
      navigate: false,
    });

    expect(mocks.connectLocalhostRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: undefined,
        bridgeToken: undefined,
        previewToken: undefined,
        devServerUrl: "http://localhost:5173",
        rootPath: "/tmp/app",
      }),
    );
    expect(mocks.addLocalhostScreensRun).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design_1",
        connectionId: "localhost_canonical",
      }),
      undefined,
    );
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "visual-edit",
      expect.objectContaining({
        designId: "design_1",
        connectionId: "localhost_canonical",
        bridgeUrl: "http://127.0.0.1:7331",
      }),
    );
    expect(result.connectionId).toBe("localhost_canonical");
    expect(result.bridgeToken).toBe("stored-write-token");
    expect(result.previewToken).toBe("stored-preview-token");
  });

  it("passes an explicit connection id through for follow-up visual-edit calls", async () => {
    await action.run({
      designId: "design_1",
      connectionId: "localhost_existing",
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7331",
      rootPath: "/tmp/app",
      paths: ["/settings"],
      navigate: false,
    });

    expect(mocks.connectLocalhostRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "localhost_existing",
      }),
    );
  });

  it("preserves secondary localhost route identity in the connection manifest", async () => {
    await action.run({
      designId: "design_1",
      devServerUrl: "http://localhost:5173",
      routes: [
        {
          connectionId: "localhost_secondary",
          path: "/settings",
          url: "http://127.0.0.2:5173/settings",
        },
      ],
      navigate: false,
    });

    expect(mocks.connectLocalhostRun).toHaveBeenCalledWith(
      expect.objectContaining({
        routeManifest: expect.objectContaining({
          routes: [
            expect.objectContaining({
              connectionId: "localhost_secondary",
              path: "/settings",
              url: "http://127.0.0.2:5173/settings",
            }),
          ],
        }),
      }),
    );
  });

  it("expands each path across viewports as a row-per-route, column-per-viewport grid", async () => {
    await action.run({
      designId: "design_1",
      connectionId: "localhost_existing",
      devServerUrl: "http://localhost:5173",
      paths: ["/tasks", "/inbox"],
      viewports: ["desktop", "mobile"],
      navigate: false,
    });

    const routes = mocks.addLocalhostScreensRun.mock.calls[0]![0].routes;
    expect(routes).toEqual([
      expect.objectContaining({
        path: "/tasks",
        width: 1280,
        height: 900,
        x: 0,
        y: 0,
        title: "Tasks — Desktop",
      }),
      expect.objectContaining({
        path: "/tasks",
        width: 390,
        height: 844,
        x: 1440,
        y: 0,
        title: "Tasks — Mobile",
      }),
      expect.objectContaining({
        path: "/inbox",
        width: 1280,
        height: 900,
        x: 0,
        y: 1060,
        title: "Inbox — Desktop",
      }),
      expect.objectContaining({
        path: "/inbox",
        width: 390,
        height: 844,
        x: 1440,
        y: 1060,
      }),
    ]);
    expect(
      mocks.addLocalhostScreensRun.mock.calls[0]![0].paths,
    ).toBeUndefined();
  });

  it("accepts explicit viewport sizes and leaves a single viewport's titles alone", async () => {
    await action.run({
      designId: "design_1",
      connectionId: "localhost_existing",
      devServerUrl: "http://localhost:5173",
      routes: [{ path: "/pricing", title: "Pricing" }],
      viewports: [{ label: "Wide", width: 1920, height: 1080 }],
      navigate: false,
    });

    expect(mocks.addLocalhostScreensRun.mock.calls[0]![0].routes).toEqual([
      expect.objectContaining({
        path: "/pricing",
        title: "Pricing",
        width: 1920,
        height: 1080,
      }),
    ]);
  });

  it("falls back to the manifest routes when viewports are requested without paths", async () => {
    mocks.connectLocalhostRun.mockResolvedValueOnce({
      id: "localhost_canonical",
      bridgeUrl: "http://127.0.0.1:7331",
      rootPath: "/tmp/app",
      bridgeToken: "stored-write-token",
      previewToken: "stored-preview-token",
      routes: [{ id: "route-home", path: "/", title: "Home" }],
    });

    await action.run({
      designId: "design_1",
      connectionId: "localhost_existing",
      devServerUrl: "http://localhost:5173",
      routeManifest: {
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:5173",
        routes: [{ path: "/", title: "Home" }],
      },
      viewports: ["mobile"],
      navigate: false,
    });

    expect(mocks.addLocalhostScreensRun.mock.calls[0]![0].routes).toEqual([
      expect.objectContaining({
        routeId: "route-home",
        path: "/",
        width: 390,
        height: 844,
      }),
    ]);
  });

  it("expands normalized connection routes across viewports", async () => {
    mocks.connectLocalhostRun.mockResolvedValueOnce({
      id: "localhost_canonical",
      bridgeUrl: "http://127.0.0.1:7331",
      rootPath: "/tmp/app",
      bridgeToken: "stored-write-token",
      previewToken: "stored-preview-token",
      routes: [
        {
          id: "normalized-secondary-settings",
          connectionId: "localhost_secondary",
          path: "/settings",
          url: "http://localhost:5173/settings",
          title: "Secondary settings",
          sourceKind: "manual",
        },
      ],
    });

    await action.run({
      designId: "design_1",
      connectionId: "localhost_existing",
      devServerUrl: "http://localhost:5173",
      routeManifest: {
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:5173",
        routes: [
          {
            connectionId: "localhost_secondary",
            path: "/settings",
            url: "http://localhost:5173/settings",
          },
        ],
      },
      viewports: ["mobile"],
      navigate: false,
    });

    expect(mocks.addLocalhostScreensRun.mock.calls[0]![0].routes).toEqual([
      expect.objectContaining({
        routeId: "normalized-secondary-settings",
        connectionId: "localhost_secondary",
        path: "/settings",
        width: 390,
        height: 844,
      }),
    ]);
  });

  it("preserves secondary route identity when expanding manifest routes across viewports", async () => {
    mocks.connectLocalhostRun.mockResolvedValueOnce({
      id: "localhost_canonical",
      bridgeUrl: "http://127.0.0.1:7331",
      rootPath: "/tmp/app",
      bridgeToken: "stored-write-token",
      previewToken: "stored-preview-token",
      routes: [
        {
          id: "secondary-settings",
          connectionId: "localhost_secondary",
          path: "/settings",
          url: "http://127.0.0.2:5173/settings",
          title: "Secondary settings",
        },
      ],
    });

    await action.run({
      designId: "design_1",
      connectionId: "localhost_existing",
      devServerUrl: "http://localhost:5173",
      routeManifest: {
        version: 1,
        sourceType: "localhost",
        devServerUrl: "http://localhost:5173",
        routes: [
          {
            id: "secondary-settings",
            connectionId: "localhost_secondary",
            path: "/settings",
            url: "http://127.0.0.2:5173/settings",
            title: "Secondary settings",
          },
        ],
      },
      viewports: ["mobile"],
      navigate: false,
    });

    expect(mocks.addLocalhostScreensRun.mock.calls[0]![0].routes).toEqual([
      expect.objectContaining({
        connectionId: "localhost_secondary",
        path: "/settings",
        url: "http://127.0.0.2:5173/settings",
        width: 390,
        height: 844,
      }),
    ]);
  });

  it("fails loudly when viewports are requested but no route can be resolved", async () => {
    await expect(
      action.run({
        designId: "design_1",
        connectionId: "localhost_existing",
        devServerUrl: "http://localhost:5173",
        viewports: ["desktop", "mobile"],
        navigate: false,
      }),
    ).rejects.toThrow(/viewports needs at least one route/);
  });

  it("accepts the complete capability list emitted by design connect route discovery", () => {
    const parsed = action.schema.safeParse({
      designId: "design_1",
      devServerUrl: "http://localhost:5173",
      capabilities: [
        { operation: "select", status: "available" },
        { operation: "resolveNodeToFile", status: "available" },
        { operation: "readFile", status: "available" },
        { operation: "applyEdit", status: "available" },
        { operation: "writeFile", status: "available" },
        { operation: "captureSnapshot", status: "available" },
        { operation: "captureState", status: "available" },
        { operation: "listFiles", status: "available" },
      ],
      paths: ["/"],
    });

    expect(parsed.success).toBe(true);
  });

  it("returns a single-use, resource-scoped handoff for an account caller", async () => {
    const result = await action.run({
      designId: "design_1",
      devServerUrl: "http://localhost:5173",
      paths: ["/"],
      navigate: false,
    });

    expect(mocks.createEmbedSessionTicket).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      orgId: "org_1",
      targetPath: "/visual-edit/design_1?editorView=overview&embedChrome=1",
      scope: "capability:visual-edit:design:design_1",
      ttlSeconds: 300,
    });

    expect(result.openUrl).toBe(
      "agent-native://open/visual-edit/design_1?editorView=overview&embedChrome=1",
    );
    expect(result.embedStartUrl).toBe(
      "/_agent-native/embed/start?ticket=visual-edit-example-ticket",
    );
    expect(Object.keys(result)).not.toContain("embedStartUrl");
    expect(JSON.stringify(result)).not.toContain("visual-edit-example-ticket");
    expect(result.openUrl).not.toContain("ticket");
    expect(result.openUrl).not.toContain("_session");
    expect(action.link!({ args: {}, result }).url).toBe(
      "agent-native://open/visual-edit/design_1?editorView=overview&embedChrome=1",
    );
  });

  it("exposes the handoff only to the same-origin frontend transport", async () => {
    const result = await action.run(
      {
        designId: "design_1",
        devServerUrl: "http://localhost:5173",
        paths: ["/"],
        navigate: false,
      },
      {
        actionName: "open-visual-edit",
        caller: "frontend",
        userEmail: "owner@example.com",
        orgId: "org_1",
      },
    );

    expect(Object.keys(result)).toContain("embedStartUrl");
    expect(result.embedStartUrl).toBe(
      "/_agent-native/embed/start?ticket=visual-edit-example-ticket",
    );
  });

  it("uses a non-account workspace principal for the signed-out local skill entry", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    const result = await action.run(
      {
        devServerUrl: "http://localhost:5173",
        rootPath: "/Users/example/project",
        paths: ["/"],
        navigate: false,
      },
      {
        actionName: "open-visual-edit",
        caller: "cli",
        userEmail: undefined,
        orgId: null,
      },
    );

    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: localVisualEditWorkspacePrincipal("/Users/example/project"),
        orgId: undefined,
      }),
      expect.any(Function),
    );
    expect(mocks.createDesignRun).toHaveBeenCalledOnce();
    expect(mocks.createEmbedSessionTicket).toHaveBeenCalledWith({
      ownerEmail: expect.stringMatching(
        /^workspace\+[a-f0-9]{24}@local\.visual-edit\.agent-native\.invalid$/,
      ),
      orgId: undefined,
      targetPath:
        "/visual-edit/design_created?editorView=overview&embedChrome=1",
      scope: "capability:visual-edit:design:design_created",
      ttlSeconds: 300,
    });
    expect(result.openUrl).toBe(
      "agent-native://open/visual-edit/design_created?editorView=overview&embedChrome=1",
    );
    expect(result.embedStartUrl).toBe(
      "/_agent-native/embed/start?ticket=visual-edit-example-ticket",
    );
    expect(mocks.getRequestUserEmail()).toBeUndefined();
  });

  it("rejects a signed-out non-CLI caller before touching local Design data", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(
      action.run(
        {
          devServerUrl: "http://localhost:5173",
          paths: ["/"],
          navigate: false,
        },
        {
          actionName: "open-visual-edit",
          caller: "frontend",
          userEmail: undefined,
          orgId: null,
        },
      ),
    ).rejects.toThrow(/only through the local CLI/);

    expect(mocks.connectLocalhostRun).not.toHaveBeenCalled();
    expect(mocks.createDesignRun).not.toHaveBeenCalled();
    expect(mocks.createEmbedSessionTicket).not.toHaveBeenCalled();
  });

  it("allows signed-out page WebMCP bootstrap for loopback apps", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    const capability = `capability:visual-edit-bootstrap:${"b".repeat(32)}`;
    mocks.getRequestAuthCapability.mockReturnValue(capability);
    const result = await action.run(
      {
        devServerUrl: "http://localhost:5173",
        bridgeUrl: "http://127.0.0.1:7331",
        rootPath: "/tmp/app",
        bridgeToken: "bridge-token",
        bridgeAttestation: {
          challenge: "b".repeat(32),
          signature: bridgeAttestationSignature("bridge-token", "b".repeat(32)),
          previewToken: "preview:bridge-token",
          manifest: {
            source: "agent-native-design-connect",
            sourceType: "localhost",
            localOnly: true,
            devServerUrl: "http://localhost:5173",
            bridgeUrl: "http://127.0.0.1:7331",
            rootPath: "/tmp/app",
          },
        },
        paths: ["/"],
        navigate: false,
      },
      {
        actionName: "open-visual-edit",
        caller: "frontend",
        userEmail: undefined,
        orgId: null,
        requestHeaders: new Headers({
          origin: "https://design.example.com",
          "sec-fetch-site": "same-origin",
        }),
      },
    );

    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: localVisualEditBridgePrincipal("bridge-token"),
      }),
      expect.any(Function),
    );
    expect(result.designId).toBe("design_created");
  });

  it("rejects a page bootstrap when the browser-observed bridge does not match", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    mocks.getRequestAuthCapability.mockReturnValue(
      `capability:visual-edit-bootstrap:${"c".repeat(32)}`,
    );

    await expect(
      action.run(
        {
          devServerUrl: "http://localhost:5173",
          bridgeUrl: "http://127.0.0.1:7331",
          bridgeToken: "bridge-token",
          bridgeAttestation: {
            challenge: "c".repeat(32),
            signature: bridgeAttestationSignature(
              "bridge-token",
              "c".repeat(32),
            ),
            previewToken: "preview:bridge-token",
            manifest: {
              source: "agent-native-design-connect",
              sourceType: "localhost",
              localOnly: true,
              devServerUrl: "http://localhost:4173",
              bridgeUrl: "http://127.0.0.1:7331",
              rootPath: "/tmp/app",
            },
          },
          paths: ["/"],
          navigate: false,
        },
        {
          actionName: "open-visual-edit",
          caller: "webmcp",
          userEmail: undefined,
          orgId: null,
          requestHeaders: new Headers({
            origin: "https://design.example.com",
            "sec-fetch-site": "same-origin",
          }),
        },
      ),
    ).rejects.toThrow(/does not match the visual-edit target/);

    expect(mocks.connectLocalhostRun).not.toHaveBeenCalled();
  });

  it("rejects a forged signed-out bridge attestation", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    const challenge = "d".repeat(32);
    mocks.getRequestAuthCapability.mockReturnValue(
      `capability:visual-edit-bootstrap:${challenge}`,
    );

    await expect(
      action.run(
        {
          devServerUrl: "http://localhost:5173",
          bridgeUrl: "http://127.0.0.1:7331",
          bridgeToken: "bridge-token",
          bridgeAttestation: {
            challenge,
            signature: "0".repeat(64),
            previewToken: "preview:bridge-token",
            manifest: {
              source: "agent-native-design-connect",
              sourceType: "localhost",
              localOnly: true,
              devServerUrl: "http://localhost:5173",
              bridgeUrl: "http://127.0.0.1:7331",
              rootPath: "/tmp/app",
            },
          },
          paths: ["/"],
          navigate: false,
        },
        {
          actionName: "open-visual-edit",
          caller: "frontend",
          userEmail: undefined,
          orgId: null,
          requestHeaders: new Headers({
            origin: "https://design.example.com",
            "sec-fetch-site": "same-origin",
          }),
        },
      ),
    ).rejects.toThrow(/could not prove the local bridge/);

    expect(mocks.connectLocalhostRun).not.toHaveBeenCalled();
  });

  it("rejects a signed-out CLI caller for a non-loopback target", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(
      action.run(
        {
          devServerUrl: "https://preview.example.com",
          paths: ["/"],
          navigate: false,
        },
        {
          actionName: "open-visual-edit",
          caller: "cli",
          userEmail: undefined,
          orgId: null,
        },
      ),
    ).rejects.toThrow(/only through the local CLI for a loopback app or/);

    expect(mocks.connectLocalhostRun).not.toHaveBeenCalled();
    expect(mocks.createEmbedSessionTicket).not.toHaveBeenCalled();
  });

  it("rejects signed-out private mode before creating Design data or a ticket", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(
      action.run(
        {
          devServerUrl: "http://localhost:5173",
          paths: ["/"],
          navigate: false,
          publicReadOnly: false,
        },
        {
          actionName: "open-visual-edit",
          caller: "cli",
          userEmail: undefined,
          orgId: null,
        },
      ),
    ).rejects.toThrow(/requires publicReadOnly/);

    expect(mocks.connectLocalhostRun).not.toHaveBeenCalled();
    expect(mocks.createDesignRun).not.toHaveBeenCalled();
    expect(mocks.addLocalhostScreensRun).not.toHaveBeenCalled();
    expect(mocks.createEmbedSessionTicket).not.toHaveBeenCalled();
  });

  it("does not mint a local-editor capability for a non-loopback target", async () => {
    const result = await action.run({
      designId: "design_1",
      devServerUrl: "https://preview.example.com",
      paths: ["/"],
      navigate: false,
    });

    expect(mocks.createEmbedSessionTicket).not.toHaveBeenCalled();
    expect(result.openUrl).toBe(
      "agent-native://open/visual-edit/design_1?editorView=overview&embedChrome=1",
    );
    expect(result).not.toHaveProperty("embedStartUrl");
  });
});
