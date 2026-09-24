import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionContractError } from "../action.js";

const authorization = vi.hoisted(() => vi.fn());
vi.mock("./builder-dsi-access.js", () => ({
  assertBuilderDsiAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./builder-api-auth.js", () => ({
  resolveBuilderRequestAuthorization: authorization,
  resolveBuilderLegacyRequestAuthorization: vi.fn(),
}));

import {
  builderProjectBranchUrl,
  fetchBuilderDesignSystemRecord,
  indexBuilderDesignSystem,
  resolveBuilderDesignSystemEditor,
} from "./builder-design-systems.js";

describe("Builder design-system editor resolution", () => {
  const fetchMock = vi.fn();
  const reference = {
    source: "builder",
    builderDesignSystemId: "example-dsi",
    builderJobId: "example-job",
    builderUrl: "https://builder.io/app/design-system-intelligence/example-dsi",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv(
      "BUILDER_DESIGN_SYSTEMS_BASE_URL",
      "https://builder.example.test/design-systems/v1",
    );
    vi.stubEnv("BUILDER_APP_HOST", "https://builder.io");
    authorization.mockResolvedValue({
      authorization: "Bearer <OAUTH_TOKEN_EXAMPLE>",
      source: "oauth",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function respond(body: unknown, status = 200) {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
  }

  it("reuses an initial project URL without a provider read", async () => {
    const editorUrl =
      "https://builder.io/app/projects/example-project/example-branch";
    await expect(
      resolveBuilderDesignSystemEditor(
        JSON.stringify({ ...reference, builderUrl: editorUrl }),
      ),
    ).resolves.toEqual({ status: "ready", editorUrl });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the actual project and encoded branch instead of the docs fallback", async () => {
    respond({ projectId: "example-project", branchName: "feature/example" });
    await expect(resolveBuilderDesignSystemEditor(reference)).resolves.toEqual({
      status: "ready",
      editorUrl: builderProjectBranchUrl("example-project", "feature/example"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://builder.example.test/design-systems/v1/example-dsi",
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("combines a persisted project identity with the provider's branch", async () => {
    respond({ branchName: "example-branch" });
    await expect(
      resolveBuilderDesignSystemEditor({
        ...reference,
        builderProjectId: "example-project",
      }),
    ).resolves.toEqual({
      status: "ready",
      editorUrl: builderProjectBranchUrl("example-project", "example-branch"),
    });
  });

  it.each([
    {},
    { projectId: "example-project" },
    { projectId: "example-project", branchName: null },
  ])(
    "reports preparing for an existing record without a branch: %j",
    async (record) => {
      respond(record);
      await expect(
        resolveBuilderDesignSystemEditor(reference),
      ).resolves.toEqual({ status: "preparing", editorUrl: null });
    },
  );

  it("does not trust a stored non-Builder project link", async () => {
    respond({ projectId: "example-project" });
    await expect(
      resolveBuilderDesignSystemEditor({
        ...reference,
        builderUrl:
          "https://example.com/app/projects/example-project/example-branch",
      }),
    ).resolves.toEqual({ status: "preparing", editorUrl: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    "invalid JSON",
    {},
    { source: "local" },
    { ...reference, builderDesignSystemId: " " },
  ])(
    "rejects invalid stored identity before any provider request: %j",
    async (data) => {
      await expect(
        resolveBuilderDesignSystemEditor(data),
      ).rejects.toMatchObject({
        actionContractError: true,
        errorCode: "invalid_builder_design_system",
        statusCode: 400,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("distinguishes provider not-found from preparing", async () => {
    respond({ error: "not found" }, 404);
    await expect(
      resolveBuilderDesignSystemEditor(reference),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "builder_design_system_not_found",
      statusCode: 404,
    });
  });

  it.each([
    [
      401,
      412,
      "builder_connection_required",
      "Reconnect Builder before opening this design system.",
    ],
    [
      403,
      403,
      "builder_design_system_access_denied",
      "Builder denied access to this design system.",
    ],
  ] as const)(
    "refuses provider HTTP %i without a retryable server error",
    async (providerStatus, statusCode, errorCode, message) => {
      respond({ error: "Example internal provider message" }, providerStatus);
      await expect(
        resolveBuilderDesignSystemEditor(reference),
      ).rejects.toMatchObject({
        actionContractError: true,
        errorCode,
        statusCode,
        message,
        details: { providerStatus },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([429, 500])(
    "rejects provider HTTP %i without exposing its body",
    async (status) => {
      respond({ error: "Example internal provider message" }, status);
      await expect(
        resolveBuilderDesignSystemEditor(reference),
      ).rejects.toMatchObject({
        actionContractError: true,
        errorCode: "builder_design_system_lookup_failed",
        statusCode: 502,
        message: "Builder design-system lookup failed.",
        details: { providerStatus: status },
      });
    },
  );

  it.each([
    null,
    [],
    { projectId: 123 },
    { branchName: {} },
    { error: "Example error" },
  ])("rejects malformed provider records: %j", async (record) => {
    respond(record);
    await expect(
      resolveBuilderDesignSystemEditor(reference),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "builder_design_system_invalid_response",
      statusCode: 502,
    });
  });

  it("rejects invalid JSON as a typed provider failure", async () => {
    fetchMock.mockResolvedValue(new Response("invalid JSON"));
    await expect(
      resolveBuilderDesignSystemEditor(reference),
    ).rejects.toMatchObject({ actionContractError: true, statusCode: 502 });
  });

  it("rejects network failures without presenting a preparing state", async () => {
    fetchMock.mockRejectedValue(new Error("Example network failure"));
    await expect(
      resolveBuilderDesignSystemEditor(reference),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "builder_design_system_lookup_failed",
      statusCode: 502,
    });
  });

  it("preserves typed authorization failures", async () => {
    const error = new ActionContractError("Example authorization failure", {
      errorCode: "example_scope_missing",
      statusCode: 403,
    });
    authorization.mockRejectedValue(error);
    await expect(resolveBuilderDesignSystemEditor(reference)).rejects.toBe(
      error,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the existing record lookup's null-on-404 contract", async () => {
    respond({}, 404);
    await expect(
      fetchBuilderDesignSystemRecord("example-dsi"),
    ).resolves.toBeNull();
  });

  it("adds editorUrl when indexing already returns a direct branch URL", async () => {
    const editorUrl =
      "https://builder.io/app/projects/example-project/example-branch";
    respond({ designSystemId: "example-dsi", branchUrl: editorUrl });
    await expect(
      indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "example-upload-token" }],
      }),
    ).resolves.toMatchObject({ builderUrl: editorUrl, editorUrl });
  });

  it("adds editorUrl from the index response project and branch", async () => {
    respond({
      designSystemId: "example-dsi",
      projectId: "example-project",
      branchName: "feature/example",
    });
    await expect(
      indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "example-upload-token" }],
      }),
    ).resolves.toMatchObject({
      editorUrl: builderProjectBranchUrl("example-project", "feature/example"),
    });
  });

  it.each([
    undefined,
    "https://example.com/app/projects/example-project/example-branch",
    "https://builder.io/app/design-system-intelligence/example-dsi",
  ])(
    "does not advertise a docs or invalid link as an editor: %s",
    async (branchUrl) => {
      respond({ designSystemId: "example-dsi", branchUrl });
      const result = await indexBuilderDesignSystem({
        sources: [{ kind: "file", uploadToken: "example-upload-token" }],
      });
      expect(result.editorUrl).toBeUndefined();
      expect(result.builderUrl).toBeTruthy();
    },
  );
});
