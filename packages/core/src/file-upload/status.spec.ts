import { createApp, defineEventHandler } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionContractError } from "../action.js";
import { readFileUploadStatus } from "../client/uploads/use-file-upload-status.js";
import { AppSecretDecryptionError } from "../secrets/errors.js";
import { CredentialStoreUnavailableError } from "../server/credential-provider.js";
import {
  getActiveFileUploadProviderForRequest,
  listFileUploadProviders,
  registerFileUploadProvider,
  unregisterFileUploadProvider,
} from "./registry.js";
import { getFileUploadStatusForRequest } from "./status.js";

const auth = vi.hoisted(() => ({ custody: vi.fn(), authorize: vi.fn() }));
vi.mock("../client/client-status-requests.js", () => ({
  fetchFileUploadStatus: async () => ({
    state: "available",
    value: await getFileUploadStatusForRequest(),
  }),
  invalidateClientStatusRequest: vi.fn(),
}));
vi.mock("../server/builder-api-auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/builder-api-auth.js")>()),
  hasBuilderApiCredentialCustody: auth.custody,
  canAuthorizeBuilderApiRequest: auth.authorize,
}));

function clearProviders() {
  for (const provider of listFileUploadProviders())
    unregisterFileUploadProvider(provider.id);
}

beforeEach(() => {
  clearProviders();
  auth.custody.mockReset().mockResolvedValue(false);
  auth.authorize.mockReset().mockResolvedValue(false);
});
afterEach(clearProviders);

describe("file upload status", () => {
  it.each([
    [false, "custom"],
    [true, "builder"],
  ] as const)(
    "preserves registry priority when a registered Builder provider is configured=%s",
    async (builderRegisteredConfigured, expectedId) => {
      auth.custody.mockResolvedValue(true);
      auth.authorize.mockResolvedValue(true);
      registerFileUploadProvider({
        id: "builder",
        name: "Builder.io",
        isConfigured: () => builderRegisteredConfigured,
        upload: vi.fn(),
      });
      registerFileUploadProvider({
        id: "custom",
        name: "Custom",
        isConfigured: () => true,
        upload: vi.fn(),
      });

      await expect(
        getActiveFileUploadProviderForRequest(),
      ).resolves.toMatchObject({ id: expectedId });
      await expect(getFileUploadStatusForRequest()).resolves.toMatchObject({
        configured: true,
        activeProvider: { id: expectedId },
        providers: [
          { id: "builder", configured: builderRegisteredConfigured },
          { id: "custom", configured: true },
        ],
      });
    },
  );

  it("keeps an earlier provider failure indeterminate instead of advertising a fallback that dispatch cannot reach", async () => {
    auth.custody.mockResolvedValue(true);
    auth.authorize.mockResolvedValue(true);
    registerFileUploadProvider({
      id: "s3",
      name: "S3",
      isConfigured: () => false,
      isConfiguredForRequest: async () => {
        throw new CredentialStoreUnavailableError();
      },
      upload: vi.fn(),
    });

    await expect(getFileUploadStatusForRequest()).resolves.toMatchObject({
      configured: null,
      activeProvider: null,
      unavailable: true,
      providers: [{ id: "s3", configured: false, unavailable: true }],
      builderUnavailable: false,
      builderReauthorizationRequired: false,
    });
    await expect(
      getActiveFileUploadProviderForRequest(),
    ).rejects.toBeInstanceOf(CredentialStoreUnavailableError);
    await expect(readFileUploadStatus()).rejects.toThrow(
      "File storage status is unavailable",
    );
  });

  it.each(["custody", "authorize"] as const)(
    "reports an unreadable Builder %s lookup as reauthorization, never missing or a rejected status",
    async (step) => {
      auth.custody.mockResolvedValue(true);
      auth[step].mockRejectedValue(
        new CredentialStoreUnavailableError(new AppSecretDecryptionError()),
      );

      const app = createApp();
      app.use(
        "/_agent-native/file-upload/status",
        defineEventHandler(getFileUploadStatusForRequest),
      );
      const response = await app.fetch(
        new Request("https://example.test/_agent-native/file-upload/status"),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        configured: null,
        activeProvider: null,
        builderUploadConfigured: false,
        builderUnavailable: true,
        builderReauthorizationRequired: true,
      });
      await expect(readFileUploadStatus()).rejects.toThrow(
        "File storage status is unavailable",
      );
    },
  );

  it("keeps custom storage available during a temporary Builder outage without prompting reauthorization", async () => {
    auth.custody.mockRejectedValue(
      new CredentialStoreUnavailableError(new Error("database unavailable")),
    );
    registerFileUploadProvider({
      id: "custom",
      name: "Custom",
      isConfigured: () => true,
      upload: vi.fn(),
    });

    await expect(getFileUploadStatusForRequest()).resolves.toMatchObject({
      configured: true,
      activeProvider: { id: "custom", name: "Custom" },
      builderUnavailable: true,
      builderReauthorizationRequired: false,
    });
  });

  it("keeps an earlier configured provider usable when a later provider check fails", async () => {
    registerFileUploadProvider({
      id: "custom",
      name: "Custom",
      isConfigured: () => true,
      upload: vi.fn(),
    });
    registerFileUploadProvider({
      id: "later",
      name: "Later",
      isConfigured: () => {
        throw new Error("unreadable configuration");
      },
      upload: vi.fn(),
    });
    await expect(
      getActiveFileUploadProviderForRequest(),
    ).resolves.toMatchObject({ id: "custom" });
    await expect(getFileUploadStatusForRequest()).resolves.toMatchObject({
      configured: true,
      unavailable: false,
      activeProvider: { id: "custom" },
      providers: [
        { id: "custom", configured: true },
        { id: "later", configured: false, unavailable: true },
      ],
    });
  });

  it("preserves the client retry state during a temporary Builder outage without custom storage", async () => {
    auth.custody.mockRejectedValue(
      new CredentialStoreUnavailableError(new Error("database unavailable")),
    );
    await expect(getFileUploadStatusForRequest()).resolves.toMatchObject({
      configured: null,
      unavailable: true,
      activeProvider: null,
      builderUnavailable: true,
      builderReauthorizationRequired: false,
    });
    await expect(readFileUploadStatus()).rejects.toThrow(
      "File storage status is unavailable",
    );
  });

  it("does not select a registered Builder provider using deployment configuration when the request cannot authorize", async () => {
    registerFileUploadProvider({
      id: "builder",
      name: "Builder.io",
      isConfigured: () => true,
      upload: vi.fn(),
    });
    registerFileUploadProvider({
      id: "custom",
      name: "Custom",
      isConfigured: () => true,
      upload: vi.fn(),
    });
    auth.custody.mockResolvedValue(true);
    auth.authorize.mockRejectedValue(
      new ActionContractError("Example expired grant", {
        errorCode: "builder_oauth_reauthorization_required",
        statusCode: 400,
      }),
    );

    await expect(getFileUploadStatusForRequest()).resolves.toMatchObject({
      configured: null,
      activeProvider: null,
      providers: [
        { id: "builder", configured: false, unavailable: true },
        { id: "custom", configured: true },
      ],
      builderReauthorizationRequired: true,
    });
  });

  it("distinguishes absent credentials from unavailable credentials", async () => {
    await expect(getFileUploadStatusForRequest()).resolves.toMatchObject({
      configured: false,
      activeProvider: null,
      builderConfigured: false,
      builderUploadConfigured: false,
      builderUnavailable: false,
      builderReauthorizationRequired: false,
    });
  });
});
