import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  enabled: vi.fn(),
  status: vi.fn(),
  upload: vi.fn(),
  index: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@agent-native/core/server", async () => {
  const context = await import("@agent-native/core/server/request-context");
  return {
    runWithRequestContext: context.runWithRequestContext,
    getSession: mocks.session,
    getMcpOAuthBearerSession: async () => null,
    cdnSafeOriginStatus: (status: number) =>
      status === 502 || status === 504 ? 503 : status,
    startBuilderDesignSystemUpload: mocks.upload,
    indexBuilderDesignSystem: mocks.index,
    FeatureNotConfiguredError: class extends Error {},
  };
});
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: mocks.enabled,
}));
vi.mock("@agent-native/core/org", () => ({
  getOrgContext: async () => ({ orgId: "org-example" }),
}));
vi.mock("../lib/builder-design-system-proxy.js", () => ({
  upsertBuilderProxyDesignSystem: mocks.upsert,
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  readBody: async () => ({
    attachments: [{ name: "fixture.fig", declaredSize: 10 }],
    uploadTokens: ["fixture-upload"],
    projectName: "Example",
  }),
  setResponseStatus: mocks.status,
}));

import { DESIGN_SYSTEM_WORKFLOWS } from "../../shared/design-flags.js";
import { assertDesignSystemWorkflowsEnabled } from "../lib/design-system-workflows.js";
import { designSystemUploadStart } from "./design-system-upload-start.js";
import { indexDesignSystemSources } from "./index-design-system-sources.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(false);
  mocks.session.mockResolvedValue({
    email: "member@example.com",
    orgId: "org-example",
  });
  mocks.upload.mockResolvedValue([{ uploadToken: "fixture-upload" }]);
  mocks.index.mockResolvedValue({ jobId: "fixture-job" });
  mocks.upsert.mockResolvedValue({ localDesignSystemId: "fixture-system" });
});

describe("design system setup gates", () => {
  it("declares a default-off app flag", () => {
    expect(DESIGN_SYSTEM_WORKFLOWS).toMatchObject({
      key: "design-system-workflows",
      defaultValue: false,
    });
  });
  it("passes authenticated identity to flag evaluation", async () => {
    mocks.enabled.mockResolvedValue(true);
    await runWithRequestContext(
      { userEmail: "member@example.com", orgId: "org-example" },
      assertDesignSystemWorkflowsEnabled,
    );
    expect(mocks.enabled).toHaveBeenCalledWith(DESIGN_SYSTEM_WORKFLOWS, {
      userEmail: "member@example.com",
      orgId: "org-example",
    });
  });
  it.each([
    ["upload", designSystemUploadStart],
    ["index", indexDesignSystemSources],
  ] as const)(
    "%s authenticates before evaluating a flag",
    async (_name, handler) => {
      mocks.session.mockResolvedValue(null);
      await handler({} as any);
      expect(mocks.status).toHaveBeenCalledWith(expect.anything(), 401);
      expect(mocks.enabled).not.toHaveBeenCalled();
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.index).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["upload", designSystemUploadStart],
    ["index", indexDesignSystemSources],
  ] as const)(
    "%s fails off before provider or persistence work",
    async (_name, handler) => {
      const result = await handler({} as any);
      expect(result).toMatchObject({
        errorCode: "design_system_workflows_disabled",
        error: "New design system workflows are not enabled.",
      });
      expect(mocks.status).toHaveBeenCalledWith(expect.anything(), 403);
      expect(mocks.enabled).toHaveBeenCalledWith(DESIGN_SYSTEM_WORKFLOWS, {
        userEmail: "member@example.com",
        orgId: "org-example",
      });
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.index).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
    },
  );
  it("retains upload and index behavior when explicitly enabled", async () => {
    mocks.enabled.mockResolvedValue(true);
    expect(await designSystemUploadStart({} as any)).toMatchObject({
      uploads: [{ uploadToken: "fixture-upload" }],
    });
    expect(await indexDesignSystemSources({} as any)).toMatchObject({
      jobId: "fixture-job",
      localDesignSystemId: "fixture-system",
      uploadedFileCount: 1,
    });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.index).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
});
