import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => vi.fn());
vi.mock("./builder-dsi-access.js", () => ({
  assertBuilderDsiAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./builder-api-auth.js", () => ({
  resolveBuilderRequestAuthorization: authorization,
  resolveBuilderLegacyRequestAuthorization: vi.fn(),
}));
import {
  buildBuilderDesignSystemIndexFiles,
  startBuilderDesignSystemIndex,
} from "./builder-design-systems.js";

describe("batched Builder design-system sources", () => {
  const fetchMock = vi.fn();
  const uploadedFiles = [
    { name: "brand.fig", uploadToken: "<COMPLETED_UPLOAD_EXAMPLE>" },
  ];
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv(
      "BUILDER_DESIGN_SYSTEMS_BASE_URL",
      "https://builder.example.test/design-systems/v1",
    );
    authorization.mockResolvedValue({
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
    });
    fetchMock.mockImplementation(
      async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://api.github.com/"))
          return new Response("[]");
        if (url.endsWith("/upload/start")) {
          const { attachments } = JSON.parse(String(init?.body));
          return Response.json({
            uploads: attachments.map((_: unknown, idx: number) => ({
              idx,
              uploadUrl: `https://storage.example.test/start/${idx}`,
              uploadToken: `<INLINE_UPLOAD_${idx}>`,
            })),
          });
        }
        if (url.includes("storage.example.test/start/")) {
          return new Response(null, {
            headers: { Location: url.replace("/start/", "/session/") },
          });
        }
        if (url.includes("storage.example.test/session/"))
          return new Response(null, { status: 200 });
        if (url.endsWith("/index"))
          return Response.json({
            designSystemId: "example-dsi",
            jobId: "example-job",
          });
        throw new Error("Unexpected mock request");
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("merges completed tokens, every inline file, markdown, guidance, repo and project in one index call", async () => {
    const files = buildBuilderDesignSystemIndexFiles({
      codeFiles: [{ filename: "theme.css", content: ":root {}" }],
      designMd: "Brand guidance",
      overflowBehavior: "throw",
    });
    await startBuilderDesignSystemIndex({
      uploadedFiles,
      files,
      description: "Prefer dense layouts",
      githubRepos: [{ repoUrl: "https://github.com/example/ui" }],
      connectedProjectId: "example-project",
      selection: { "brand.fig": ["example-frame"] },
    });
    const indexCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/index"),
    );
    expect(indexCalls).toHaveLength(1);
    expect(JSON.parse(String(indexCalls[0][1]?.body)).sources).toEqual([
      { kind: "file", uploadToken: "<INLINE_UPLOAD_0>" },
      { kind: "file", uploadToken: "<INLINE_UPLOAD_1>" },
      { kind: "file", uploadToken: "<INLINE_UPLOAD_2>" },
      {
        kind: "file",
        uploadToken: "<COMPLETED_UPLOAD_EXAMPLE>",
        selection: { "brand.fig": ["example-frame"] },
      },
      { kind: "public-repo", repoUrl: "https://github.com/example/ui" },
      { kind: "connected-repo", fusionProjectId: "example-project" },
    ]);
    const uploads = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/upload/start"),
    );
    expect(uploads).toHaveLength(1);
    expect(
      JSON.parse(String(uploads[0][1]?.body)).attachments.map(
        (file: { name: string }) => file.name,
      ),
    ).toEqual(["additional-context.txt", "design.md", "theme.css"]);
    expect(authorization).toHaveBeenCalledWith({
      requiredScope: "builder:designsystem:write",
    });
  });
  it("accepts completed uploads alone without uploading them again", async () => {
    await startBuilderDesignSystemIndex({ uploadedFiles });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/index");
  });
  it("refuses missing Builder credentials before any provider request", async () => {
    authorization.mockResolvedValue(null);
    await expect(
      startBuilderDesignSystemIndex({ uploadedFiles }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { uploadedFiles: [] },
    { uploadedFiles: [{ name: "brand.fig", uploadToken: "" }] },
    { uploadedFiles: [{ name: "", uploadToken: "<UPLOAD_TOKEN_EXAMPLE>" }] },
    { files: [{ name: "empty.fig", data: new Uint8Array() }] },
  ])(
    "refuses missing or invalid sources before any provider request: %j",
    async (options) => {
      await expect(
        startBuilderDesignSystemIndex(options),
      ).rejects.toMatchObject({ actionContractError: true, statusCode: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("does not silently drop empty inline files from an otherwise valid batch", () => {
    expect(() =>
      buildBuilderDesignSystemIndexFiles({
        codeFiles: [
          { filename: "empty.css", content: "" },
          { filename: "theme.css", content: ":root {}" },
        ],
        overflowBehavior: "throw",
      }),
    ).toThrow("must not be empty");
  });
  it.each([400, 401, 403, 410, 422])(
    "fails a rejected/expired upload batch without retry at provider status %s",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ error: "Upload rejected" }, { status }),
      );
      await expect(
        startBuilderDesignSystemIndex({ uploadedFiles }),
      ).rejects.toMatchObject({
        actionContractError: true,
        errorCode: "builder_design_system_sources_rejected",
        statusCode: status === 401 ? 412 : status,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("does not index when upload slots are incomplete", async () => {
    fetchMock.mockResolvedValue(Response.json({ uploads: [] }));
    await expect(
      startBuilderDesignSystemIndex({
        uploadedFiles,
        files: [{ name: "theme.css", data: new Uint8Array([1]) }],
      }),
    ).rejects.toThrow("all files");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not index when inline upload cannot be finalized", async () => {
    vi.useFakeTimers();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).includes("/session/")) {
        return new Response(null, {
          status: 308,
          headers: { Range: "bytes=0-0" },
        });
      }
      return original(input, init);
    });
    const result = startBuilderDesignSystemIndex({
      uploadedFiles,
      files: [{ name: "theme.css", data: new Uint8Array([1]) }],
    });
    const check = expect(result).rejects.toThrow("upload failed (308)");
    await vi.runAllTimersAsync();
    await check;
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/index")),
    ).toBe(false);
  });
});
