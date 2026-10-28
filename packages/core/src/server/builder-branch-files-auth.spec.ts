import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBuilderOAuthSession: vi.fn(),
  hasBuilderOAuthSession: vi.fn(),
  resolveBuilderCredential: vi.fn(),
  resolveBuilderCredentials: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestBuilderStorageCredentialOrgId: vi.fn(),
}));

vi.mock("./builder-oauth.js", () => ({
  getBuilderOAuthSession: mocks.getBuilderOAuthSession,
  hasBuilderOAuthSession: mocks.hasBuilderOAuthSession,
}));
vi.mock("./credential-provider.js", () => ({
  CredentialStoreUnavailableError: class CredentialStoreUnavailableError extends Error {},
  resolveBuilderCredential: mocks.resolveBuilderCredential,
  resolveBuilderCredentials: mocks.resolveBuilderCredentials,
}));
vi.mock("./request-context.js", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestBuilderStorageCredentialOrgId:
    mocks.getRequestBuilderStorageCredentialOrgId,
}));
vi.mock("../mcp-client/remote-store.js", () => ({
  listRemoteServers: vi.fn(),
  toHttpServerConfigAsync: vi.fn(),
}));
vi.mock("../mcp-client/oauth-client.js", () => ({
  readMcpOAuthCredentials: vi.fn(),
}));
vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: vi.fn(),
}));
vi.mock("./builder-browser.js", () => ({
  getBuilderApiHost: () => "https://api.builder.example",
}));
vi.mock("./builder-branch-git.js", () => ({
  BuilderGitBundleError: class BuilderGitBundleError extends Error {},
  readBuilderGitBundle: vi.fn(),
}));

import { resolveBuilderRequestAuthorization } from "./builder-api-auth.js";
import {
  BuilderBranchFilesError,
  readBuilderBranchFiles,
} from "./builder-branch-files.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue("user@example.invalid");
  mocks.getRequestOrgId.mockReturnValue(undefined);
  mocks.getRequestBuilderStorageCredentialOrgId.mockReturnValue(undefined);
  mocks.hasBuilderOAuthSession.mockResolvedValue(false);
  mocks.getBuilderOAuthSession.mockResolvedValue(null);
  mocks.resolveBuilderCredential.mockImplementation(async (key: string) =>
    key === "BUILDER_PRIVATE_KEY" ? "bpk-example-only" : null,
  );
  mocks.resolveBuilderCredentials.mockResolvedValue({
    privateKey: "bpk-example-only",
    publicKey: "public-key-example-only",
    userId: "builder-user-example-only",
  });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readBuilderBranchFiles authorization", () => {
  it("does not use an available legacy deploy key without OAuth custody", async () => {
    await expect(
      resolveBuilderRequestAuthorization({
        requiredScope: "builder:projects:read",
      }),
    ).resolves.toMatchObject({
      source: "legacy",
      token: "bpk-example-only",
      legacyPublicKey: "public-key-example-only",
    });
    mocks.resolveBuilderCredential.mockClear();
    mocks.resolveBuilderCredentials.mockClear();

    await expect(
      readBuilderBranchFiles({
        projectId: "project-123",
        branchName: "feature/example",
        appPath: "apps/example-app",
      }),
    ).rejects.toMatchObject({
      code: "not_connected",
    } satisfies Partial<BuilderBranchFilesError>);

    expect(mocks.resolveBuilderCredential).not.toHaveBeenCalled();
    expect(mocks.resolveBuilderCredentials).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
