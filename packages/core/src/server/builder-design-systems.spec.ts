import { afterEach, describe, expect, it, vi } from "vitest";

const resolveBuilderRequestAuthorizationMock = vi.hoisted(() => vi.fn());
const resolveBuilderLegacyRequestAuthorizationMock = vi.hoisted(() => vi.fn());

vi.mock("./builder-api-auth.js", () => ({
  resolveBuilderRequestAuthorization: resolveBuilderRequestAuthorizationMock,
  resolveBuilderLegacyRequestAuthorization:
    resolveBuilderLegacyRequestAuthorizationMock,
}));

function legacyBuilderAuthorization() {
  const privateKey = process.env.BUILDER_PRIVATE_KEY;
  if (!privateKey) return null;
  const publicKey = process.env.BUILDER_PUBLIC_KEY;
  return {
    token: privateKey,
    authorization: `Bearer ${privateKey}`,
    source: "legacy",
    ...(publicKey ? { legacyPublicKey: publicKey } : {}),
  };
}

function useLegacyBuilderAuthorizationMock() {
  resolveBuilderRequestAuthorizationMock.mockImplementation(async () =>
    legacyBuilderAuthorization(),
  );
  resolveBuilderLegacyRequestAuthorizationMock.mockImplementation(async () =>
    legacyBuilderAuthorization(),
  );
}

useLegacyBuilderAuthorizationMock();

import {
  assertBuilderDesignSystemCodeIndexingAllowed,
  buildBuilderDesignSystemIndexFiles,
  collectBuilderDesignSystemGitHubFiles,
  createBuilderDesignSystemProxyFields,
  fetchBuilderDesignSystemDocs,
  fetchBuilderDesignSystemTierLimit,
  hydrateBuilderDesignSystemReference,
  indexBuilderDesignSystem,
  localBuilderDesignSystemId,
  mimeTypeForBuilderDesignSystemFilename,
  parseBuilderDesignSystemProxyReference,
  startBuilderDesignSystemIndex,
} from "./builder-design-systems.js";

describe("Builder design-system helpers", () => {
  const originalGitHubToken = process.env.GITHUB_TOKEN;
  const originalBuilderPrivateKey = process.env.BUILDER_PRIVATE_KEY;
  const originalBuilderPublicKey = process.env.BUILDER_PUBLIC_KEY;
  const originalBuilderBaseUrl = process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL;

  afterEach(() => {
    for (const [key, value] of [
      ["GITHUB_TOKEN", originalGitHubToken],
      ["BUILDER_PRIVATE_KEY", originalBuilderPrivateKey],
      ["BUILDER_PUBLIC_KEY", originalBuilderPublicKey],
      ["BUILDER_DESIGN_SYSTEMS_BASE_URL", originalBuilderBaseUrl],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    resolveBuilderRequestAuthorizationMock.mockReset();
    resolveBuilderLegacyRequestAuthorizationMock.mockReset();
    useLegacyBuilderAuthorizationMock();
  });

  function useBuilderTestCredentials() {
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
  }

  /**
   * Hydration now reads the detail endpoint for `docCount` before paging
   * docs, so a stub has to answer both routes. Responses are single-use, so
   * every entry is a factory.
   */
  function stubBuilderDesignSystemFetch({
    count,
    docs,
  }: {
    count: () => Response;
    docs: Array<() => Response>;
  }) {
    let docsCall = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/docs")) return count();
      const index = Math.min(docsCall, docs.length - 1);
      docsCall += 1;
      return docs[index]();
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function countResponse(docCount: unknown, status = 200) {
    return () => new Response(JSON.stringify({ docCount }), { status });
  }

  it("uses OAuth for design-system reads without legacy API key fields", async () => {
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      oauthScope: "user",
    });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchBuilderDesignSystemDocs("ds-1")).resolves.toEqual([]);

    expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith({
      requiredScope: "builder:designsystem:read",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://builder.example.test/design-systems/v1/ds-1/docs",
    );
    const headers = new Headers(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
    );
    expect(headers.get("Authorization")).toBe("Bearer <OAUTH_TOKEN_EXAMPLE>");
    expect(headers.has("x-builder-api-key")).toBe(false);
    expect(headers.has("x-builder-user-id")).toBe(false);
  });

  it("uses OAuth for design-system writes without legacy API key fields", async () => {
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      oauthScope: "user",
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ designSystemId: "ds-1" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "upload-token" }],
      }),
    ).resolves.toMatchObject({ designSystemId: "ds-1" });

    expect(resolveBuilderRequestAuthorizationMock).toHaveBeenCalledWith({
      requiredScope: "builder:designsystem:write",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://builder.example.test/design-systems/v1/index",
    );
    const headers = new Headers(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
    );
    expect(headers.get("Authorization")).toBe("Bearer <OAUTH_TOKEN_EXAMPLE>");
    expect(headers.has("x-builder-api-key")).toBe(false);
    expect(headers.has("x-builder-user-id")).toBe(false);
  });

  it("retries indexing with the legacy key when Builder closes the route to OAuth", async () => {
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    process.env.BUILDER_PRIVATE_KEY = "bpk-test-private-key";
    process.env.BUILDER_PUBLIC_KEY = "test-public-key";
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      oauthScope: "user",
    });
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization");
      if (authorization !== "Bearer bpk-test-private-key") {
        return new Response(JSON.stringify({ error: "route_not_enabled" }), {
          status: 403,
        });
      }
      return new Response(JSON.stringify({ designSystemId: "ds-1" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "upload-token" }],
      }),
    ).resolves.toMatchObject({ designSystemId: "ds-1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://builder.example.test/design-systems/v1/index?apiKey=test-public-key",
    );
    const retryHeaders = new Headers(
      (fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers,
    );
    expect(retryHeaders.get("x-builder-api-key")).toBe("test-public-key");
  });

  it("reports an actionable failure when OAuth is the only Builder credential", async () => {
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    delete process.env.BUILDER_PRIVATE_KEY;
    delete process.env.BUILDER_PUBLIC_KEY;
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      oauthScope: "user",
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "route_not_enabled" }), {
          status: 403,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "upload-token" }],
      }),
    ).rejects.toMatchObject({
      errorCode: "builder_design_system_oauth_unsupported",
      message: expect.stringContaining("create-design-system"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a private-key-only fallback the primary path would also reject", async () => {
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    process.env.BUILDER_PRIVATE_KEY = "bpk-test-private-key";
    delete process.env.BUILDER_PUBLIC_KEY;
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      oauthScope: "user",
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "route_not_enabled" }), {
          status: 403,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "upload-token" }],
      }),
    ).rejects.toMatchObject({
      errorCode: "builder_design_system_oauth_unsupported",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a genuine permission failure as itself instead of downgrading", async () => {
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    process.env.BUILDER_PRIVATE_KEY = "bpk-test-private-key";
    process.env.BUILDER_PUBLIC_KEY = "test-public-key";
    resolveBuilderRequestAuthorizationMock.mockResolvedValue({
      token: "<OAUTH_TOKEN_EXAMPLE>",
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
      oauthScope: "user",
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "upload-token" }],
      }),
    ).rejects.toThrow(/Builder design-system indexing failed \(403\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resolveBuilderLegacyRequestAuthorizationMock).not.toHaveBeenCalled();
  });

  it("builds Builder DSI upload files from design.md and code inputs", () => {
    const files = buildBuilderDesignSystemIndexFiles({
      designMd: "# Brand\nUse confident layouts.",
      codeFiles: [
        {
          filename: "src/tokens.css",
          content: ":root { --brand: #123456; }",
        },
        {
          filename: "theme.json",
          content: '{"color":"#123456"}',
        },
      ],
    });

    expect(files.map((file) => file.name)).toEqual([
      "design.md",
      "src/tokens.css",
      "theme.json",
    ]);
    expect(files.map((file) => file.mimeType)).toEqual([
      "text/markdown",
      "text/css",
      "application/json",
    ]);
    expect(new TextDecoder().decode(files[0].data)).toContain(
      "Use confident layouts",
    );
  });

  it("skips empty and over-budget code files before indexing", () => {
    const files = buildBuilderDesignSystemIndexFiles({
      maxTotalCodeBytes: 8,
      codeFiles: [
        { filename: "empty.css", content: "" },
        { filename: "ok.css", content: "1234" },
        { filename: "too-large.css", content: "123456789" },
        { filename: "also-ok.css", content: "5678" },
      ],
    });

    expect(files.map((file) => file.name)).toEqual(["ok.css", "also-ok.css"]);
  });

  it("can fail loudly instead of silently dropping an over-budget binary file", () => {
    expect(() =>
      buildBuilderDesignSystemIndexFiles({
        maxTotalCodeBytes: 8,
        overflowBehavior: "throw",
        codeFiles: [
          {
            filename: "brand.fig",
            content: Buffer.from("larger than eight bytes").toString("base64"),
            encoding: "base64",
          },
        ],
      }),
    ).toThrow(/brand\.fig.*inline upload budget/i);
  });

  it("fails loudly when a strict caller exceeds the file-count cap", () => {
    expect(() =>
      buildBuilderDesignSystemIndexFiles({
        maxCodeFiles: 1,
        overflowBehavior: "throw",
        codeFiles: [
          { filename: "one.css", content: "a" },
          { filename: "two.css", content: "b" },
        ],
      }),
    ).toThrow(/too many design-system files/i);
  });

  it("base64-decodes a binary .fig file instead of UTF-8-mangling it (regression: .fig upload silently corrupted binary bytes)", () => {
    // A real .fig is a zip container -- PK\x03\x04 magic, per the fig-writer
    // spike's own README -- and its bytes are NOT valid UTF-8 (many bytes
    // are >= 0x80 with no valid continuation sequence). Round-tripping
    // arbitrary binary through TextEncoder().encode() (the old
    // default-and-only path) corrupts it; through base64 + Buffer.from it
    // must come back byte-identical.
    const binaryBytes = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x81, 0xfe, 0x7f, 0x10, 0x20,
    ]);
    const base64Content = Buffer.from(binaryBytes).toString("base64");

    const files = buildBuilderDesignSystemIndexFiles({
      codeFiles: [
        {
          filename: "spike-output.fig",
          content: base64Content,
          encoding: "base64",
        },
      ],
    });

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("spike-output.fig");
    expect(files[0].mimeType).toBe("application/octet-stream");
    expect(Array.from(files[0].data)).toEqual(Array.from(binaryBytes));
  });

  it("still treats codeFiles as UTF-8 text by default when encoding is omitted (no behavior change for existing text callers)", () => {
    const files = buildBuilderDesignSystemIndexFiles({
      codeFiles: [{ filename: "tokens.css", content: ":root{--x:1}" }],
    });
    expect(new TextDecoder().decode(files[0].data)).toBe(":root{--x:1}");
  });

  it("creates a local proxy that preserves the Builder DSI reference", () => {
    const fields = createBuilderDesignSystemProxyFields({
      result: {
        ok: true,
        source: "builder",
        projectId: "project-1",
        jobId: "job-1",
        designSystemId: "ds-1",
        suggestedTitle: "Acme",
        builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
        status: "in-progress",
      },
      projectName: "Acme",
      description: "Marketing system",
      surface: "slides",
      sourceKind: "figma",
    });

    expect(fields.title).toBe("Acme");
    expect(fields.customInstructions).toContain(
      "Builder Design System Intelligence",
    );
    expect(fields.customInstructions).toContain("slides");
    expect(parseBuilderDesignSystemProxyReference(fields.data)).toEqual({
      source: "builder",
      sourceKind: "figma",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderProjectId: "project-1",
      builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
      builderStatus: "in-progress",
    });
  });

  it("derives hydrated readiness from the Builder document count, not its status", async () => {
    useBuilderTestCredentials();
    const fetchMock = stubBuilderDesignSystemFetch({
      count: countResponse(1),
      docs: [
        () =>
          new Response(
            JSON.stringify({
              docs: [{ tokenValues: { "--brand-primary": "#123456" } }],
              status: "in-progress",
            }),
            { status: 200 },
          ),
      ],
    });

    await expect(
      hydrateBuilderDesignSystemReference({
        source: "builder",
        builderDesignSystemId: "ds-1",
        builderJobId: "job-1",
        builderStatus: "in-progress",
      }),
    ).resolves.toMatchObject({
      docCount: 1,
      tokenValues: { "--brand-primary": "#123456" },
      completionConfirmed: true,
    });
    const countUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(countUrl.pathname).toBe("/design-systems/v1/ds-1");
    expect(countUrl.searchParams.get("includeDocumentCount")).toBe("true");
  });

  it("hydrates every Builder docs page and preserves terminal failure status", async () => {
    useBuilderTestCredentials();
    const fetchMock = stubBuilderDesignSystemFetch({
      count: countResponse(41),
      docs: [
        () =>
          new Response(
            JSON.stringify(
              Array.from({ length: 40 }, (_, index) => ({
                id: `doc-${index}`,
              })),
            ),
            { status: 200 },
          ),
        () =>
          new Response(
            JSON.stringify({ docs: [{ id: "doc-40" }], status: "complete" }),
            { status: 200 },
          ),
      ],
    });

    await expect(
      hydrateBuilderDesignSystemReference({
        source: "builder",
        builderDesignSystemId: "ds-1",
        builderJobId: "job-1",
        builderStatus: "in-progress",
      }),
    ).resolves.toMatchObject({
      docCount: 41,
      completionConfirmed: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    stubBuilderDesignSystemFetch({
      count: countResponse(0),
      docs: [
        () =>
          new Response(JSON.stringify({ docs: [], status: "failed" }), {
            status: 200,
          }),
      ],
    });
    await expect(
      hydrateBuilderDesignSystemReference({
        source: "builder",
        builderDesignSystemId: "ds-1",
        builderJobId: "job-1",
        builderStatus: "in-progress",
      }),
    ).resolves.toMatchObject({
      builderStatus: "failed",
      docCount: 0,
      completionConfirmed: false,
    });
  });

  it("bounds minimal hydration to the first docs page", async () => {
    useBuilderTestCredentials();
    const fetchMock = stubBuilderDesignSystemFetch({
      count: countResponse(1),
      docs: [
        () =>
          new Response(
            JSON.stringify({ docs: [{ id: "doc-1" }], status: "in-progress" }),
            { status: 200 },
          ),
      ],
    });

    await expect(
      hydrateBuilderDesignSystemReference(
        {
          source: "builder",
          builderDesignSystemId: "ds-1",
          builderJobId: "job-1",
          builderStatus: "in-progress",
        },
        { page: 0, pageSize: 1, minimal: true },
      ),
    ).resolves.toMatchObject({
      builderStatus: "in-progress",
      docCount: 1,
      completionConfirmed: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports Builder's own status while the count decides readiness", async () => {
    useBuilderTestCredentials();
    stubBuilderDesignSystemFetch({
      count: countResponse(0),
      docs: [
        () =>
          new Response(
            JSON.stringify({
              docs: [],
              status: "error",
              complete: true,
              completed: true,
            }),
            { status: 200 },
          ),
      ],
    });
    await expect(
      hydrateBuilderDesignSystemReference({
        source: "builder",
        builderDesignSystemId: "ds-1",
        builderJobId: "job-1",
        builderStatus: "in-progress",
      }),
    ).resolves.toMatchObject({
      builderStatus: "error",
      completionConfirmed: false,
    });

    stubBuilderDesignSystemFetch({
      count: countResponse(0),
      docs: [
        () =>
          new Response(JSON.stringify({ docs: [], status: "canceled" }), {
            status: 200,
          }),
      ],
    });
    await expect(
      hydrateBuilderDesignSystemReference({
        source: "builder",
        builderDesignSystemId: "ds-1",
        builderJobId: "job-1",
        builderStatus: "in-progress",
      }),
    ).resolves.toMatchObject({
      builderStatus: "cancelled",
      completionConfirmed: false,
    });
  });

  it("persists replayable GitHub source scope in the local proxy", () => {
    const fields = createBuilderDesignSystemProxyFields({
      result: {
        ok: true,
        source: "builder",
        projectId: "project-1",
        jobId: "job-1",
        designSystemId: "ds-1",
        suggestedTitle: "Acme",
        builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
        status: "in-progress",
      },
      surface: "design",
      sourceKind: "github",
      githubSources: [
        {
          repoUrl: "https://github.com/acme/ui",
          ref: "main",
          include: ["src/styles"],
        },
      ],
      syncedAt: "2026-08-13T12:00:00.000Z",
    });

    expect(parseBuilderDesignSystemProxyReference(fields.data)).toMatchObject({
      sourceKind: "github",
      githubSources: [
        {
          repoUrl: "https://github.com/acme/ui",
          ref: "main",
          include: ["src/styles"],
        },
      ],
      syncedAt: "2026-08-13T12:00:00.000Z",
    });
  });

  it("rejects malformed persisted GitHub source metadata instead of dropping it", () => {
    expect(
      parseBuilderDesignSystemProxyReference({
        source: "builder",
        builderDesignSystemId: "ds-1",
        builderJobId: "job-1",
        githubSources: [{ repoUrl: "not a GitHub reference" }],
      }),
    ).toBeNull();
  });

  it("reads a private scoped GitHub source with the server-side token", async () => {
    process.env.GITHUB_TOKEN = "github-secret";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("ref=feature%2Fbrand");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer github-secret",
      });
      if (url.includes("/contents/src/styles/tokens.css")) {
        return new Response(":root { --brand: #123456; }", { status: 200 });
      }
      if (url.includes("/contents/src/styles?")) {
        return new Response(
          JSON.stringify([
            { path: "src/styles/tokens.css", type: "file", size: 24 },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      collectBuilderDesignSystemGitHubFiles({
        repoUrl: "https://github.com/acme/ui",
        ref: "feature/brand",
        include: ["src/styles"],
      }),
    ).resolves.toMatchObject({
      owner: "acme",
      repo: "ui",
      ref: "feature/brand",
      files: [
        {
          path: "src/styles/tokens.css",
          content: ":root { --brand: #123456; }",
        },
      ],
    });
  });

  it("runs a scoped GitHub source through upload and Builder indexing", async () => {
    process.env.GITHUB_TOKEN = "github-secret";
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";

    const fetchSpy = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.github.com/")) {
        if (url.includes("/contents/src/styles/tokens.css")) {
          return new Response(":root { --brand: #123456; }", { status: 200 });
        }
        return new Response(
          JSON.stringify([
            { path: "src/styles/tokens.css", type: "file", size: 24 },
          ]),
          { status: 200 },
        );
      }
      if (url.endsWith("/upload/start?apiKey=builder-public")) {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            uploads: [
              {
                idx: 0,
                uploadUrl: "https://upload.example.test/session",
                uploadToken: "upload-token",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "https://upload.example.test/session") {
        return new Response(null, {
          status: 200,
          headers: { Location: "https://upload.example.test/chunk" },
        });
      }
      if (url === "https://upload.example.test/chunk") {
        expect(init?.method).toBe("PUT");
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/index?apiKey=builder-public")) {
        const body = JSON.parse(String(init?.body)) as {
          sources?: Array<{ kind?: string; uploadToken?: string }>;
        };
        expect(body.sources).toEqual([
          { kind: "file", uploadToken: "upload-token" },
        ]);
        return new Response(
          JSON.stringify({
            designSystemId: "ds-1",
            jobId: "job-1",
            projectId: "project-1",
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected mocked request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      startBuilderDesignSystemIndex({
        projectName: "Acme",
        githubRepos: [
          {
            repoUrl: "https://github.com/acme/ui",
            ref: "main",
            include: ["src/styles"],
          },
        ],
      }),
    ).resolves.toMatchObject({
      designSystemId: "ds-1",
      jobId: "job-1",
      status: "in-progress",
    });
  });

  it("retries transient Builder indexing gateway failures", async () => {
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html><title>Bad gateway</title></html>", {
          status: 502,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            designSystemId: "ds-1",
            jobId: "job-1",
            projectId: "project-1",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    try {
      const result = indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "upload-token" }],
      });
      await vi.advanceTimersByTimeAsync(600);
      await expect(result).resolves.toMatchObject({
        designSystemId: "ds-1",
        jobId: "job-1",
      });
    } finally {
      vi.useRealTimers();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const idempotencyKeys = fetchMock.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("Idempotency-Key"),
    );
    expect(idempotencyKeys[0]).toMatch(/^agent-native-dsi-/);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  });

  it("retries transient Builder indexing transport failures", async () => {
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            designSystemId: "ds-1",
            jobId: "job-1",
            projectId: "project-1",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    try {
      const result = indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "upload-token" }],
      });
      await vi.advanceTimersByTimeAsync(600);
      await expect(result).resolves.toMatchObject({
        designSystemId: "ds-1",
        jobId: "job-1",
      });
    } finally {
      vi.useRealTimers();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent Builder indexing failures", async () => {
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid source" }), {
        status: 422,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "upload-token" }],
      }),
    ).rejects.toThrow("422");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a safe conflict when Builder rejects a duplicate design-system name", async () => {
    delete process.env.GITHUB_TOKEN;
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.github.com/")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith("/index?apiKey=builder-public")) {
        return new Response(
          JSON.stringify({
            type: "error",
            message:
              "Design system name already exists in this scope, please use a different name",
            severity: "medium",
            id: "fixture-builder-error-id",
          }),
          { status: 409 },
        );
      }
      throw new Error(`Unexpected mocked request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startBuilderDesignSystemIndex({
        githubRepos: [{ repoUrl: "https://github.com/ant-design/ant-design" }],
      }),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "design_system_name_conflict",
      statusCode: 409,
      message:
        "A design system with this name already exists. Choose a different name and try again.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a 402 design-system tier limit as a structured, actionable failure", async () => {
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Design system limit reached for this plan",
            plan: "Pro",
            current: 3,
            max: 3,
            upgradeUrl: "https://builder.io/account/subscription?plan=pro",
          },
        }),
        { status: 402 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "upload-token" }],
      }),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "design_system_tier_limit_exceeded",
      statusCode: 402,
      details: {
        plan: "pro",
        current: 3,
        max: 3,
        upgradeUrl: "https://builder.io/account/subscription?plan=pro",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to a default upgrade link when the 402 body carries no upgradeUrl", async () => {
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ plan: "free", current: 1, max: 1 }), {
        status: 402,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const rejection = await indexBuilderDesignSystem({
      sources: [{ kind: "file", uploadToken: "upload-token" }],
    }).catch((error) => error);

    expect(rejection).toMatchObject({
      errorCode: "design_system_tier_limit_exceeded",
      statusCode: 402,
      details: { plan: "free", current: 1, max: 1 },
    });
    expect(
      typeof rejection.details.upgradeUrl === "string" &&
        rejection.details.upgradeUrl.includes("builder.io"),
    ).toBe(true);
  });

  it("keeps an unscoped public repository as a native Builder source", async () => {
    delete process.env.GITHUB_TOKEN;
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";

    const fetchSpy = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.github.com/")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith("/index?apiKey=builder-public")) {
        const body = JSON.parse(String(init?.body)) as {
          sources?: Array<{ kind?: string; repoUrl?: string }>;
        };
        expect(body.sources).toEqual([
          { kind: "public-repo", repoUrl: "https://github.com/acme/ui" },
        ]);
        return new Response(
          JSON.stringify({
            designSystemId: "ds-public",
            jobId: "job-public",
            projectId: "project-public",
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected mocked request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      startBuilderDesignSystemIndex({
        githubRepos: [{ repoUrl: "https://github.com/acme/ui" }],
      }),
    ).resolves.toMatchObject({
      designSystemId: "ds-public",
      jobId: "job-public",
    });
  });

  it("normalizes Builder filenames and local proxy ids", () => {
    expect(mimeTypeForBuilderDesignSystemFilename("design.mdx")).toBe(
      "text/markdown",
    );
    expect(mimeTypeForBuilderDesignSystemFilename("logo.svg")).toBe(
      "image/svg+xml",
    );
    expect(localBuilderDesignSystemId("ds:/Brand Kit 2026")).toBe(
      "builder-ds-Brand-Kit-2026",
    );
  });

  describe("fetchBuilderDesignSystemTierLimit", () => {
    it("reads plan, current count, and max from the tier-limit endpoint", async () => {
      process.env.BUILDER_PRIVATE_KEY = "builder-private";
      process.env.BUILDER_PUBLIC_KEY = "builder-public";
      process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
        "https://builder.example.test/design-systems/v1";
      const fetchMock = vi.fn(async (input: string | URL) => {
        expect(String(input)).toBe(
          "https://builder.example.test/design-systems/v1/tier-limit?apiKey=builder-public",
        );
        return new Response(
          JSON.stringify({ plan: "Team", current: 3, max: 3 }),
          { status: 200 },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(fetchBuilderDesignSystemTierLimit()).resolves.toEqual({
        status: "ok",
        plan: "team",
        current: 3,
        max: 3,
        atMax: true,
        codeIndexingAllowed: false,
        upgradeUrl: expect.stringContaining("builder.io"),
      });
    });

    it("treats a null max as unlimited and allows code indexing on Enterprise", async () => {
      process.env.BUILDER_PRIVATE_KEY = "builder-private";
      process.env.BUILDER_PUBLIC_KEY = "builder-public";
      process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
        "https://builder.example.test/design-systems/v1";
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ plan: "enterprise", current: 42, max: null }),
            { status: 200 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      const limit = await fetchBuilderDesignSystemTierLimit();
      expect(limit.plan).toBe("enterprise");
      expect(limit.max).toBeNull();
      expect(limit.atMax).toBe(false);
      expect(limit.codeIndexingAllowed).toBe(true);
    });

    it("fails closed on code indexing for an unknown or newly named non-Enterprise plan", async () => {
      process.env.BUILDER_PRIVATE_KEY = "builder-private";
      process.env.BUILDER_PUBLIC_KEY = "builder-public";
      process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
        "https://builder.example.test/design-systems/v1";
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ plan: "startup", current: 1, max: 3 }),
            { status: 200 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);

      const limit = await fetchBuilderDesignSystemTierLimit();
      expect(limit.plan).toBe("startup");
      expect(limit.codeIndexingAllowed).toBe(false);
    });

    it("fails closed on code indexing when the tier-limit response omits a plan entirely", async () => {
      process.env.BUILDER_PRIVATE_KEY = "builder-private";
      process.env.BUILDER_PUBLIC_KEY = "builder-public";
      process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
        "https://builder.example.test/design-systems/v1";
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ current: 1, max: 3 }), {
          status: 200,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const limit = await fetchBuilderDesignSystemTierLimit();
      expect(limit.plan).toBeNull();
      expect(limit.codeIndexingAllowed).toBe(false);
    });

    it("fails open on the count cap but closed on code indexing when the tier-limit endpoint is unreachable", async () => {
      process.env.BUILDER_PRIVATE_KEY = "builder-private";
      process.env.BUILDER_PUBLIC_KEY = "builder-public";
      process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
        "https://builder.example.test/design-systems/v1";

      const expectUnavailable = () =>
        expect(fetchBuilderDesignSystemTierLimit()).resolves.toEqual({
          status: "unavailable",
          plan: null,
          current: null,
          max: null,
          atMax: false,
          codeIndexingAllowed: false,
          upgradeUrl: null,
        });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("network down")),
      );
      await expectUnavailable();

      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(new Response("Internal error", { status: 500 })),
      );
      await expectUnavailable();
    });
  });

  describe("assertBuilderDesignSystemCodeIndexingAllowed", () => {
    it("resolves silently when the plan allows code indexing", async () => {
      process.env.BUILDER_PRIVATE_KEY = "builder-private";
      process.env.BUILDER_PUBLIC_KEY = "builder-public";
      process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
        "https://builder.example.test/design-systems/v1";
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ plan: "enterprise", current: 1, max: null }),
              { status: 200 },
            ),
          ),
      );

      await expect(
        assertBuilderDesignSystemCodeIndexingAllowed(),
      ).resolves.toBeUndefined();
    });

    it("throws a structured 403 when the plan does not allow code indexing", async () => {
      process.env.BUILDER_PRIVATE_KEY = "builder-private";
      process.env.BUILDER_PUBLIC_KEY = "builder-public";
      process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
        "https://builder.example.test/design-systems/v1";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ plan: "pro", current: 1, max: 3 }), {
            status: 200,
          }),
        ),
      );

      await expect(
        assertBuilderDesignSystemCodeIndexingAllowed(),
      ).rejects.toMatchObject({
        actionContractError: true,
        errorCode: "design_system_code_indexing_forbidden",
        statusCode: 403,
      });
    });

    it("throws when the tier-limit endpoint is unreachable (fails closed)", async () => {
      process.env.BUILDER_PRIVATE_KEY = "builder-private";
      process.env.BUILDER_PUBLIC_KEY = "builder-public";
      process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
        "https://builder.example.test/design-systems/v1";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("network down")),
      );

      await expect(
        assertBuilderDesignSystemCodeIndexingAllowed(),
      ).rejects.toMatchObject({
        errorCode: "design_system_code_indexing_forbidden",
        statusCode: 403,
      });
    });
  });
});
