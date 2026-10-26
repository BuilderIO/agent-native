import { createApp, defineEventHandler } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionContractError } from "../action.js";
import { AppSecretDecryptionError } from "../secrets/errors.js";
import { CredentialStoreUnavailableError } from "../server/credential-provider.js";
import {
  listFileUploadProviders,
  registerFileUploadProvider,
  unregisterFileUploadProvider,
} from "./registry.js";
import { getFileUploadStatusForRequest } from "./status.js";

const auth = vi.hoisted(() => ({ custody: vi.fn(), authorize: vi.fn() }));
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
  it("keeps Builder available when an unrelated provider cannot read its configuration", async () => {
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
      configured: true,
      activeProvider: { id: "builder", name: "Builder.io" },
      providers: [{ id: "s3", configured: false, unavailable: true }],
      builderUnavailable: false,
      builderReauthorizationRequired: false,
    });
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
        configured: false,
        activeProvider: null,
        builderUploadConfigured: false,
        builderUnavailable: true,
        builderReauthorizationRequired: true,
      });
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

  it("does not select a registered Builder provider using deployment configuration when the request cannot authorize", async () => {
    registerFileUploadProvider({
      id: "builder",
      name: "Builder.io",
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
      configured: false,
      activeProvider: null,
      providers: [{ id: "builder", configured: false, unavailable: true }],
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
