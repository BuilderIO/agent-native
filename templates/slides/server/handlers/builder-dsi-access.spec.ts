import { ActionContractError } from "@agent-native/core/action";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertBuilder: vi.fn(),
  session: vi.fn(),
  upload: vi.fn(),
  decode: vi.fn(),
  index: vi.fn(),
  store: vi.fn(),
  persist: vi.fn(),
  body: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@agent-native/core/server/builder-dsi-access", () => ({
  assertBuilderDsiAccess: mocks.assertBuilder,
}));
vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.session,
  getMcpOAuthBearerSession: async () => null,
  runWithRequestContext,
  startBuilderDesignSystemUpload: mocks.upload,
  fetchBuilderDesignSystemDecodeJobStatus: mocks.decode,
  indexBuilderDesignSystem: mocks.index,
  FeatureNotConfiguredError: class extends Error {},
}));
vi.mock("@agent-native/core/org", () => ({
  getOrgContext: async () => ({ orgId: "example-org" }),
}));
vi.mock("@agent-native/core/server/design-system-authoring", () => ({
  DESIGN_SYSTEM_SOURCE_MAX_BYTES: 20 * 1024 * 1024,
  storeDesignSystemSourceUpload: mocks.store,
}));
vi.mock("../lib/builder-design-system-proxy.js", () => ({
  upsertBuilderProxyDesignSystem: mocks.persist,
}));
vi.mock("h3", async (original) => ({
  ...(await original<typeof import("h3")>()),
  defineEventHandler: (handler: unknown) => handler,
  readBody: mocks.body,
  setResponseStatus: mocks.status,
  getQuery: () => ({ jobId: "example-job" }),
  getRequestHeader: () => "100",
  readMultipartFormData: async () => [
    { name: "file", filename: "guide.md", data: Buffer.from("Example") },
  ],
}));

import { designSystemDecodeJobStatus } from "./design-system-decode-job-status.js";
import sourceUpload from "./design-system-source-upload.js";
import { designSystemUploadStart } from "./design-system-upload-start.js";
import { indexDesignSystemSources } from "./index-design-system-sources.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    email: "caller@example.test",
    orgId: "example-org",
  });
  mocks.body.mockResolvedValue({
    attachments: [{ name: "example.fig", declaredSize: 8 }],
    uploadTokens: ["<EXAMPLE_UPLOAD_TOKEN>"],
  });
});

describe("DSI upload and legacy route enforcement", () => {
  it.each([
    designSystemUploadStart,
    designSystemDecodeJobStatus,
    indexDesignSystemSources,
    sourceUpload,
  ])(
    "denies unlinked callers before provider or blob writes",
    async (handler) => {
      mocks.assertBuilder.mockRejectedValue(
        new ActionContractError("Connect your own Builder account", {
          statusCode: 403,
          errorCode: "builder_dsi_missing",
        }),
      );
      await expect(handler({} as never)).resolves.toMatchObject({
        errorCode: "builder_dsi_missing",
      });
      expect(mocks.status).toHaveBeenCalledWith({}, 403);
      for (const call of [
        mocks.upload,
        mocks.decode,
        mocks.index,
        mocks.store,
        mocks.persist,
      ])
        expect(call).not.toHaveBeenCalled();
    },
  );

  it("keeps missing session handling distinct from a missing Builder account", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(designSystemUploadStart({} as never)).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(mocks.status).toHaveBeenCalledWith({}, 401);
    expect(mocks.assertBuilder).not.toHaveBeenCalled();
  });

  it("forwards only the session identity and allows a verified caller's upload", async () => {
    const { getRequestContext } =
      await import("@agent-native/core/server/request-context");
    mocks.assertBuilder.mockImplementation(async () => {
      expect(getRequestContext()).toMatchObject({
        userEmail: "caller@example.test",
        orgId: "example-org",
      });
      return { status: "ready", eligible: true };
    });
    mocks.upload.mockResolvedValue([{ uploadToken: "<EXAMPLE_UPLOAD_TOKEN>" }]);
    await expect(designSystemUploadStart({} as never)).resolves.toEqual({
      uploads: [{ uploadToken: "<EXAMPLE_UPLOAD_TOKEN>" }],
    });
    expect(mocks.upload).toHaveBeenCalledOnce();
  });
});
