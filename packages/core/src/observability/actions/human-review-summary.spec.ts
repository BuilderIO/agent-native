import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsOrgAdmin = vi.hoisted(() => vi.fn());
const mockGetTraceSummary = vi.hoisted(() => vi.fn());
const mockUpsertHumanReviewSummary = vi.hoisted(() => vi.fn());
const mockGetOutputReviewSummarySource = vi.hoisted(() => vi.fn());

vi.mock("../../server/org-admin.js", () => ({
  currentRequestUserIsOrgAdmin: (...args: unknown[]) => mockIsOrgAdmin(...args),
}));

vi.mock("../store.js", () => ({
  getTraceSummary: (...args: unknown[]) => mockGetTraceSummary(...args),
  upsertHumanReviewSummary: (...args: unknown[]) =>
    mockUpsertHumanReviewSummary(...args),
}));

vi.mock("../reviews.js", () => ({
  getOutputReviewSummarySource: (...args: unknown[]) =>
    mockGetOutputReviewSummarySource(...args),
}));

import getReviewSummarySource from "./get-observability-review-summary-source.js";
import saveReviewSummary from "./save-observability-review-summary.js";

const admin = { userEmail: "admin@example.com", orgId: "org-a" } as any;
const source = {
  found: true,
  runId: "run-a",
  threadTitle: "A thread",
  attachedArtifacts: [],
  threadEvidenceAvailable: true,
  messages: [],
  toolEvidence: [
    {
      name: "create_dashboard",
      status: "success",
      output: { dashboardId: "dash-a" },
    },
  ],
  toolEvidenceAvailable: true,
};

describe("human-review summary actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOrgAdmin.mockResolvedValue(true);
    mockGetTraceSummary.mockResolvedValue({ runId: "run-a", orgId: "org-a" });
    mockGetOutputReviewSummarySource.mockResolvedValue(source);
    mockUpsertHumanReviewSummary.mockResolvedValue(true);
  });

  it("denies non-admin source and save calls before reading or writing", async () => {
    mockIsOrgAdmin.mockResolvedValue(false);
    await expect(
      getReviewSummarySource.run({ runId: "run-a" }, admin),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      saveReviewSummary.run(
        { runId: "run-a", ask: "Ask", outcome: "Done", artifacts: [] },
        admin,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockGetTraceSummary).not.toHaveBeenCalled();
    expect(mockGetOutputReviewSummarySource).not.toHaveBeenCalled();
    expect(mockUpsertHumanReviewSummary).not.toHaveBeenCalled();
  });

  it("keeps source reads agent-callable and bounded to the active org", async () => {
    await expect(
      getReviewSummarySource.run({ runId: "run-a" }, admin),
    ).resolves.toEqual(source);
    expect(mockGetOutputReviewSummarySource).toHaveBeenCalledWith({
      runId: "run-a",
      orgId: "org-a",
    });
    expect(getReviewSummarySource.agentTool).not.toBe(false);
  });

  it("hides another-org target runs and never writes a summary for them", async () => {
    mockGetTraceSummary.mockResolvedValue(null);
    await expect(
      saveReviewSummary.run(
        { runId: "run-b", ask: "Ask", outcome: "Done", artifacts: [] },
        admin,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockGetTraceSummary).toHaveBeenCalledWith("run-b", {
      orgId: "org-a",
    });
    expect(mockGetOutputReviewSummarySource).not.toHaveBeenCalled();
    expect(mockUpsertHumanReviewSummary).not.toHaveBeenCalled();
  });

  it("rejects artifact IDs absent from captured evidence", async () => {
    await expect(
      saveReviewSummary.run(
        {
          runId: "run-a",
          ask: "Ask",
          outcome: "Done",
          artifacts: [
            { appId: "analytics", artifactId: "guessed", title: "Made up" },
          ],
        },
        admin,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockUpsertHumanReviewSummary).not.toHaveBeenCalled();
  });

  it("rejects an evidence ID when its app does not match the captured tool", async () => {
    await expect(
      saveReviewSummary.run(
        {
          runId: "run-a",
          ask: "Ask",
          outcome: "Done",
          artifacts: [
            { appId: "design", artifactId: "dash-a", title: "Misattributed" },
          ],
        },
        admin,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockUpsertHumanReviewSummary).not.toHaveBeenCalled();
  });

  it.each([
    [
      "input-only IDs",
      {
        name: "create_dashboard",
        status: "success",
        input: { dashboardId: "dash-a" },
        output: { dashboardId: "other" },
      },
    ],
    [
      "failed tool output",
      {
        name: "create_dashboard",
        status: "error",
        output: { dashboardId: "dash-a" },
      },
    ],
  ])("rejects artifact IDs from %s", async (_label, evidence) => {
    mockGetOutputReviewSummarySource.mockResolvedValueOnce({
      ...source,
      toolEvidence: [evidence],
    });
    await expect(
      saveReviewSummary.run(
        {
          runId: "run-a",
          ask: "Ask",
          outcome: "Done",
          artifacts: [
            { appId: "analytics", artifactId: "dash-a", title: "Made up" },
          ],
        },
        admin,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockUpsertHumanReviewSummary).not.toHaveBeenCalled();
  });

  it("persists only bounded strings and drops paths that do not match the app", async () => {
    await saveReviewSummary.run(
      {
        runId: "run-a",
        ask: "Build the dashboard",
        outcome: "Created the weekly dashboard",
        artifacts: [
          {
            appId: "analytics",
            artifactId: "dash-a",
            title: "Weekly",
            path: "/design/dash-a",
          },
        ],
      },
      admin,
    );
    expect(mockUpsertHumanReviewSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-a",
        orgId: "org-a",
        createdBy: "admin@example.com",
        artifacts: [
          { appId: "analytics", artifactId: "dash-a", title: "Weekly" },
        ],
      }),
    );
  });
});
