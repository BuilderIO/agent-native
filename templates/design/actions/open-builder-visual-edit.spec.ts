import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOrCreateBuilderHostDesign: vi.fn(),
  upsertFusionScreens: vi.fn(),
  writeAppState: vi.fn(),
  signEmbedSessionToken: vi.fn(),
  runWithRequestContext: vi.fn(),
  getRequestContext: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/server", () => ({
  signEmbedSessionToken: mocks.signEmbedSessionToken,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
  getRequestContext: mocks.getRequestContext,
}));

vi.mock("../server/lib/builder-host-design.js", () => ({
  findOrCreateBuilderHostDesign: mocks.findOrCreateBuilderHostDesign,
}));

vi.mock("../server/lib/fusion-screens.js", () => ({
  DEFAULT_FUSION_SCREEN_WIDTH: 1280,
  DEFAULT_FUSION_SCREEN_HEIGHT: 900,
  upsertFusionScreens: mocks.upsertFusionScreens,
}));

import {
  builderHostPrincipal,
  openBuilderVisualEdit,
} from "./open-builder-visual-edit.js";

const validArgs = {
  previewUrl: "https://branch-x.builderio.xyz/dashboard",
  builderOrgId: "org-1",
  projectId: "proj-1",
  branchName: "feature/x",
  contentId: "content-1",
};

describe("builderHostPrincipal", () => {
  it("is stable for the same branch and never a real address", () => {
    const key = {
      builderOrgId: "org-1",
      projectId: "proj-1",
      branchName: "feature/x",
    };
    expect(builderHostPrincipal(key)).toBe(builderHostPrincipal(key));
    expect(builderHostPrincipal(key)).toMatch(
      /^builder\+[0-9a-f]{24}@builder-host\.agent-native\.invalid$/,
    );
  });

  it("differs per branch, project, and org", () => {
    const base = {
      builderOrgId: "org-1",
      projectId: "proj-1",
      branchName: "feature/x",
    };
    const seen = new Set([
      builderHostPrincipal(base),
      builderHostPrincipal({ ...base, branchName: "main" }),
      builderHostPrincipal({ ...base, projectId: "proj-2" }),
      builderHostPrincipal({ ...base, builderOrgId: "org-2" }),
    ]);
    expect(seen.size).toBe(4);
  });

  it("does not collide when the parts are rearranged", () => {
    expect(
      builderHostPrincipal({
        builderOrgId: "a",
        projectId: "b",
        branchName: "c",
      }),
    ).not.toBe(
      builderHostPrincipal({
        builderOrgId: "a b",
        projectId: "",
        branchName: "c",
      }),
    );
  });
});

describe("open-builder-visual-edit", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();

    mocks.getRequestContext.mockReturnValue({});
    mocks.runWithRequestContext.mockImplementation(
      (_ctx: unknown, fn: () => unknown) => fn(),
    );
    mocks.findOrCreateBuilderHostDesign.mockResolvedValue({
      designId: "design-1",
      created: true,
      fusionApp: {},
    });
    mocks.upsertFusionScreens.mockResolvedValue({
      screens: [
        {
          fileId: "f1",
          filename: "fusion-dashboard.html",
          path: "/dashboard",
          url: "https://branch-x.builderio.xyz/dashboard",
          title: "Dashboard",
          width: 1280,
          height: 900,
        },
      ],
      placedFrames: [],
    });
    mocks.signEmbedSessionToken.mockReturnValue("embed-token-abc");
  });

  it("places a screen for the preview URL's own path by default", async () => {
    const result = await openBuilderVisualEdit(validArgs);
    expect(mocks.upsertFusionScreens.mock.calls[0]![0].paths).toEqual([
      "/dashboard",
    ]);
    expect(result.designId).toBe("design-1");
    expect(result.screenCount).toBe(1);
  });

  it("runs as the branch principal, not the caller", async () => {
    await openBuilderVisualEdit(validArgs);
    const [ctx] = mocks.runWithRequestContext.mock.calls[0]!;
    expect(ctx.userEmail).toBe(
      builderHostPrincipal({
        builderOrgId: "org-1",
        projectId: "proj-1",
        branchName: "feature/x",
      }),
    );
    expect(ctx.orgId).toBeUndefined();
  });

  it("stores the origin, dropping path and query", async () => {
    await openBuilderVisualEdit({
      ...validArgs,
      previewUrl: "https://branch-x.builderio.xyz/a/b?c=1#d",
    });
    expect(
      mocks.findOrCreateBuilderHostDesign.mock.calls[0]![0].previewUrl,
    ).toBe("https://branch-x.builderio.xyz");
  });

  it("bases screens on the container's own origin, never this app's", async () => {
    // Serving the container from this origin would run the user's application
    // code with this app's storage, cookies and DOM.
    await openBuilderVisualEdit(validArgs);
    const framed = mocks.upsertFusionScreens.mock.calls[0]![0].previewUrl;
    expect(framed).toBe("https://branch-x.builderio.xyz");
    expect(framed).not.toContain("/builder-preview/");
  });

  it("signs a session for the owning principal, bound to the visual-edit path", async () => {
    await openBuilderVisualEdit(validArgs);
    expect(mocks.signEmbedSessionToken).toHaveBeenCalledWith({
      ownerEmail: expect.stringMatching(/^builder\+/),
      targetPath: "/visual-edit/design-1?view=overview&embedChrome=1",
      scope: "builder-host:design:design-1",
      ttlSeconds: 3600,
    });
  });

  it("does not mint a capability scope, which would block design-doc writes", async () => {
    await openBuilderVisualEdit(validArgs);
    const { scope } = mocks.signEmbedSessionToken.mock.calls[0]![0];
    expect(scope.startsWith("capability:")).toBe(false);
  });

  it("targets the visual-edit surface, never the ordinary design link", async () => {
    await openBuilderVisualEdit(validArgs);
    const { targetPath } = mocks.signEmbedSessionToken.mock.calls[0]![0];
    expect(targetPath.startsWith("/visual-edit/")).toBe(true);
  });

  it("returns a replayable embed URL — an iframe src is re-requested on reload", async () => {
    const result = await openBuilderVisualEdit(validArgs);
    const url = new URL(result.embedUrl, "http://x.invalid");
    expect(url.pathname).toBe("/visual-edit/design-1");
    expect(url.searchParams.get("__an_embed_token")).toBe("embed-token-abc");
    expect(url.searchParams.get("embedded")).toBe("1");
    expect(url.searchParams.get("view")).toBe("overview");
  });

  it("keeps the embed URL non-enumerable so it cannot be serialized out", async () => {
    const result = await openBuilderVisualEdit(validArgs);
    expect(Object.keys(result)).not.toContain("embedUrl");
    expect(JSON.stringify(result)).not.toContain("embed-token-abc");
  });

  it("dedupes repeated route paths", async () => {
    await openBuilderVisualEdit({
      ...validArgs,
      routes: [{ path: "/" }, { path: "/settings" }, { path: "/" }],
    });
    expect(mocks.upsertFusionScreens.mock.calls[0]![0].paths).toEqual([
      "/",
      "/settings",
    ]);
  });

  it("rejects a route that would place a screen off the container origin", async () => {
    await expect(
      openBuilderVisualEdit({
        ...validArgs,
        routes: [{ path: "https://evil.example/" }],
      }),
    ).rejects.toThrow(/root-relative/);
    expect(mocks.upsertFusionScreens).not.toHaveBeenCalled();
  });

  it("rejects a dynamic route, which has no single URL to render", async () => {
    await expect(
      openBuilderVisualEdit({
        ...validArgs,
        routes: [{ path: "/blog/[slug]" }],
      }),
    ).rejects.toThrow(/dynamic segment/);
  });

  it("rejects a preview URL outside the allowlist before any write", async () => {
    await expect(
      openBuilderVisualEdit({ ...validArgs, previewUrl: "https://evil.com/" }),
    ).rejects.toThrow(/not a recognized Builder preview host/);
    expect(mocks.runWithRequestContext).not.toHaveBeenCalled();
    expect(mocks.findOrCreateBuilderHostDesign).not.toHaveBeenCalled();
    expect(mocks.signEmbedSessionToken).not.toHaveBeenCalled();
  });

  it("rejects a non-https preview URL before any write", async () => {
    await expect(
      openBuilderVisualEdit({
        ...validArgs,
        previewUrl: "http://branch-x.builderio.xyz/",
      }),
    ).rejects.toThrow(/must use https/);
    expect(mocks.findOrCreateBuilderHostDesign).not.toHaveBeenCalled();
  });

  it("reports reuse of an existing design", async () => {
    mocks.findOrCreateBuilderHostDesign.mockResolvedValue({
      designId: "design-existing",
      created: false,
      fusionApp: {},
    });
    const result = await openBuilderVisualEdit(validArgs);
    expect(result.created).toBe(false);
  });

  it("records the visual-edit context for the agent", async () => {
    await openBuilderVisualEdit(validArgs);
    const [stateKey, payload] = mocks.writeAppState.mock.calls[0]!;
    expect(stateKey).toBe("visual-edit");
    expect(payload).toMatchObject({
      designId: "design-1",
      source: "builder-host",
      builderOrgId: "org-1",
      branchName: "feature/x",
      urlPath: "/visual-edit/design-1?view=overview&embedChrome=1",
    });
  });
});
