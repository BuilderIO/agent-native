import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildBuilderDesignSystemIndexFiles,
  collectBuilderDesignSystemGitHubFiles,
  createBuilderDesignSystemProxyFields,
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

  it("requires an explicit Builder completion signal when hydrating docs", async () => {
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              docs: [{ tokenValues: { "--brand-primary": "#123456" } }],
              status: "complete",
            }),
            { status: 200 },
          ),
      ),
    );

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
  });

  it("hydrates every Builder docs page and preserves terminal failure status", async () => {
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return new Response(
            JSON.stringify(
              Array.from({ length: 40 }, (_, index) => ({
                id: `doc-${index}`,
              })),
            ),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            docs: [{ id: "doc-40" }],
            status: "complete",
          }),
          { status: 200 },
        );
      }),
    );

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
    expect(requestCount).toBe(2);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ docs: [], status: "failed" }), {
            status: 200,
          }),
      ),
    );
    await expect(
      hydrateBuilderDesignSystemReference({
        source: "builder",
        builderDesignSystemId: "ds-1",
        builderJobId: "job-1",
        builderStatus: "in-progress",
      }),
    ).resolves.toMatchObject({
      builderStatus: "failed",
      completionConfirmed: false,
    });
  });

  it("bounds minimal hydration to the first page", async () => {
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            docs: [{ id: "doc-1" }],
            status: "in-progress",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

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
      completionConfirmed: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves failed status over completion flags and normalizes cancellation variants", async () => {
    process.env.BUILDER_PRIVATE_KEY = "builder-private";
    process.env.BUILDER_PUBLIC_KEY = "builder-public";
    process.env.BUILDER_DESIGN_SYSTEMS_BASE_URL =
      "https://builder.example.test/design-systems/v1";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          docs: [],
          status: "error",
          complete: true,
          completed: true,
        }),
        { status: 200 },
      ),
    );
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

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ docs: [], status: "canceled" }), {
        status: 200,
      }),
    );
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
});
