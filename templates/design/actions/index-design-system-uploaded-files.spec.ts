vi.mock("@agent-native/core/server/builder-dsi-access", () => ({
  assertBuilderDsiAccess: vi.fn(async () => ({
    status: "ready",
    eligible: true,
  })),
  getBuilderDsiAccess: vi.fn(async () => ({ status: "ready", eligible: true })),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isBuilderEditorUrl } from "../../../packages/core/src/shared/builder-editor-url.js";
const mocks = vi.hoisted(() => ({
  email: vi.fn(),
  build: vi.fn(),
  start: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@agent-native/core/server", () => ({
  buildBuilderDesignSystemIndexFiles: mocks.build,
  startBuilderDesignSystemIndex: mocks.start,
  FeatureNotConfiguredError: class extends Error {},
  isBuilderEditorUrl,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.email,
  getRequestOrgId: () => "example-org",
}));
vi.mock("../server/lib/builder-design-system-proxy.js", () => ({
  upsertBuilderProxyDesignSystem: mocks.upsert,
}));
import action from "./index-design-system-with-builder.js";
describe("batched Builder index action", () => {
  const uploadedFiles = [
    { name: "brand.fig", uploadToken: "<UPLOAD_TOKEN_EXAMPLE>" },
  ];
  const githubSources = [
    {
      repoUrl: "https://github.com/example/ui",
      ref: "main",
      include: ["src/styles"],
    },
  ];
  const editorUrl =
    "https://builder.io/app/projects/example-project/example-branch";
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.email.mockReturnValue("owner@example.test");
    mocks.build.mockReturnValue([
      { name: "design.md", data: new Uint8Array([1]) },
    ]);
    mocks.start.mockResolvedValue({
      designSystemId: "provider-dsi",
      editorUrl,
    });
    mocks.upsert.mockResolvedValue({ localDesignSystemId: "local-dsi" });
  });
  it("passes uploaded, GitHub, code and markdown sources to one job and scoped proxy", async () => {
    const codeFiles = [{ filename: "theme.css", content: ":root {}" }];
    const result = await action.run({
      uploadedFiles,
      githubSources,
      codeFiles,
      designMd: "Brand guide",
    });
    expect(mocks.build).toHaveBeenCalledWith({
      codeFiles,
      designMd: "Brand guide",
      overflowBehavior: "throw",
    });
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        uploadedFiles,
        githubRepos: githubSources,
        files: mocks.build.mock.results[0].value,
      }),
    );
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ownerEmail: "owner@example.test",
        orgId: "example-org",
        sourceKind: "mixed",
        githubSources,
      }),
    );
    expect(result).toMatchObject({
      uploadedFileCount: 2,
      localDesignSystemId: "local-dsi",
      editorUrl,
    });
  });
  it("rejects unauthenticated calls before uploads, provider work, or persistence", async () => {
    mocks.email.mockReturnValue(undefined);
    await expect(action.run({ uploadedFiles })).rejects.toMatchObject({
      statusCode: 401,
      errorCode: "authentication_required",
    });
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it.each([
    [],
    [{ name: "", uploadToken: "<UPLOAD_TOKEN_EXAMPLE>" }],
    [{ name: "brand.fig", uploadToken: " " }],
    [{ name: "brand.fig" }],
  ])("rejects invalid upload references in the schema: %j", (...input) => {
    expect(action.schema.safeParse({ uploadedFiles: input }).success).toBe(
      false,
    );
  });
  it("does not persist a successful proxy or retry after provider token rejection", async () => {
    const error = Object.assign(new Error("Upload reference expired"), {
      statusCode: 410,
    });
    mocks.start.mockRejectedValue(error);
    await expect(action.run({ uploadedFiles })).rejects.toBe(error);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("links only an actual ready editor, never a docs fallback", () => {
    const context = { args: {} };
    expect(action.link?.({ ...context, result: { editorUrl } })).toMatchObject({
      url: editorUrl,
    });
    expect(
      action.link?.({
        ...context,
        result: {
          builderUrl:
            "https://builder.io/app/design-system-intelligence/example-dsi",
        },
      }),
    ).toBeNull();
    expect(
      action.link?.({
        ...context,
        result: { editorUrl: "https://example.test/app/projects/x/y" },
      }),
    ).toBeNull();
  });
  it.each([403, 409, 503])(
    "stops a denied Builder account (%s) before provider work",
    async (statusCode) => {
      const { assertBuilderDsiAccess } =
        await import("@agent-native/core/server/builder-dsi-access");
      const denied = Object.assign(new Error("Builder account denied"), {
        statusCode,
      });
      vi.mocked(assertBuilderDsiAccess).mockRejectedValueOnce(denied);
      await expect(
        action.run({
          uploadedFiles: [
            { name: "example.fig", uploadToken: "<EXAMPLE_UPLOAD_TOKEN>" },
          ],
        }),
      ).rejects.toBe(denied);
      expect(mocks.build).not.toHaveBeenCalled();
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
    },
  );
});
