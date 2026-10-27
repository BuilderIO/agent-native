import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAnalysis: vi.fn(),
  getAnalysisForReview: vi.fn(),
  currentRequestUserIsOrgAdmin: vi.fn(),
  superOrgId: undefined as string | undefined,
}));

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return { ...actual, embedApp: (value: unknown) => value };
});

vi.mock("@agent-native/core/server", () => ({
  currentRequestUserIsOrgAdmin: mocks.currentRequestUserIsOrgAdmin,
  getAppConfig: () => ({ observability: { superOrgId: mocks.superOrgId } }),
  getRequestOrgId: () => "org-a",
  getRequestUserEmail: () => "alice@example.com",
  buildDeepLink: () => "/analytics/analyses/analysis-1",
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getAnalysis: mocks.getAnalysis,
  getAnalysisForReview: mocks.getAnalysisForReview,
}));

const { default: getAnalysis } = await import("./get-analysis");

describe("get-analysis Human Review access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.superOrgId = undefined;
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(false);
    mocks.getAnalysis.mockResolvedValue({
      id: "analysis-1",
      name: "Analysis",
      resultMarkdown: "Result",
      resultData: null,
      orgId: "org-a",
    });
    mocks.getAnalysisForReview.mockResolvedValue({
      id: "analysis-1",
      name: "Customer analysis",
      resultMarkdown: "Customer result",
      resultData: null,
      orgId: "org-b",
    });
  });

  it("rejects non-admin previews before reading the artifact", async () => {
    await expect(
      getAnalysis.run({ id: "analysis-1", reviewPreview: true }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.getAnalysisForReview).not.toHaveBeenCalled();
    expect(mocks.getAnalysis).not.toHaveBeenCalled();
  });

  it("keeps ordinary org admins within their active organization", async () => {
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);

    await getAnalysis.run({ id: "analysis-1", reviewPreview: true });

    expect(mocks.getAnalysisForReview).toHaveBeenCalledWith("analysis-1", {
      kind: "organization",
      orgId: "org-a",
    });
  });

  it("allows a configured super-org admin to read a customer artifact", async () => {
    mocks.superOrgId = "org-a";
    mocks.currentRequestUserIsOrgAdmin.mockResolvedValue(true);

    const result = await getAnalysis.run({
      id: "analysis-1",
      reviewPreview: true,
      reviewOrgId: "org-b",
    });

    expect(mocks.getAnalysisForReview).toHaveBeenCalledWith("analysis-1", {
      kind: "super-organization",
      orgId: "org-b",
    });
    expect(result).toMatchObject({ id: "analysis-1", orgId: "org-b" });
    expect(mocks.getAnalysis).not.toHaveBeenCalled();
  });

  it("uses normal resource access outside Human Review", async () => {
    await getAnalysis.run({ id: "analysis-1" });

    expect(mocks.getAnalysis).toHaveBeenCalledWith("analysis-1", {
      email: "alice@example.com",
      orgId: "org-a",
    });
    expect(mocks.getAnalysisForReview).not.toHaveBeenCalled();
  });
});
